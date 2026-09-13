import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteStateStore } from "./sqlite-state-store";
import { IdentityService, type AuthenticatedPrincipal, type CredentialAuthenticationRecord } from "@/server/modules/identity";
import { KnowledgeError, KnowledgeService } from "@/server/modules/knowledge";

const NOW = "2026-09-13T20:00:00.000Z";
const directories: string[] = [];

function setup(ids: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-knowledge-"));
  directories.push(directory);
  const path = join(directory, "state.sqlite3");
  const store = new SqliteStateStore(path);
  store.savePrincipal({ id: "agent-1", kind: "agent", status: "active" }, "test");
  const credential: CredentialAuthenticationRecord = {
    id: "credential-1", principalId: "agent-1", kind: "agent_token", label: "test",
    tokenPrefix: "wts_credential-1", verifierHash: "a".repeat(64), status: "active",
    expiresAt: null, createdAt: NOW, revokedAt: null, lastUsedAt: null,
  };
  store.saveCredential(credential, "test");
  store.saveKnowledgeProject({ id: "project-1", name: "Knowledge", status: "active", revision: 1, createdAt: NOW, updatedAt: NOW }, "test");
  store.saveKnowledgeProjectGrant({ principalId: "agent-1", projectId: "project-1", permissions: ["knowledge:read", "knowledge:write"], revokedAt: null }, "test");
  const actor: AuthenticatedPrincipal = { principalId: "agent-1", principalKind: "agent", credentialId: "credential-1", authenticationMethod: "agent_token" };
  let next = 0;
  const service = new KnowledgeService(store, new IdentityService(store, () => NOW), () => NOW, () => ids[next++] ?? `id-${next}`);
  return { directory, path, store, service, actor };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("knowledge service SQLite flow", () => {
  it("persists a thread, reply and atomically linked task across restart", () => {
    const { path, store, service, actor } = setup(["thread-1", "reply-1", "task-1", "relation-1"]);
    const thread = service.createThread("project-1", { title: "Finding", body: "Evidence" }, { idempotencyKey: "thread-key" }, actor).value;
    service.createReply("project-1", thread.id, { body: "Confirmed" }, { idempotencyKey: "reply-key" }, actor);
    const created = service.createTaskFromThread("project-1", thread.id, { title: "Act", description: "Do it", priority: "now" }, { idempotencyKey: "task-key" }, actor);
    expect(created.replayed).toBe(false);
    expect(service.relations("project-1", "thread", thread.id, actor)).toEqual([created.value.relation]);
    expect(store.listHistory("project-1", "task", created.value.task.id)).toHaveLength(1);
    store.close();

    const reopened = new SqliteStateStore(path);
    expect(reopened.listThreads("project-1", 25)).toEqual([thread]);
    expect(reopened.listReplies("project-1", thread.id, 25)).toHaveLength(1);
    expect(reopened.listTasks("project-1", 25)[0]).toMatchObject({ id: "task-1", revision: 1 });
    reopened.close();
  });

  it("replays identical requests and rejects an idempotency key with different content", () => {
    const { store, service, actor } = setup(["thread-1", "unused"]);
    const first = service.createThread("project-1", { title: "Finding", body: "Evidence" }, { idempotencyKey: "same" }, actor);
    const replay = service.createThread("project-1", { title: "Finding", body: "Evidence" }, { idempotencyKey: "same" }, actor);
    expect(replay).toEqual({ value: first.value, replayed: true });
    expect(store.listThreads("project-1", 25)).toHaveLength(1);
    expect(() => service.createThread("project-1", { title: "Changed", body: "Evidence" }, { idempotencyKey: "same" }, actor))
      .toThrowError(expect.objectContaining({ code: "idempotency_conflict" }));
    store.close();
  });

  it("detects a stale task revision without overwriting the current value", () => {
    const { store, service, actor } = setup(["thread-1", "task-1", "relation-1"]);
    service.createThread("project-1", { title: "Finding", body: "Evidence" }, { idempotencyKey: "thread" }, actor);
    const task = service.createTaskFromThread("project-1", "thread-1", { title: "Act", description: "First" }, { idempotencyKey: "task" }, actor).value.task;
    service.updateTask("project-1", task.id, { title: "Act", description: "Second", priority: "next", status: "in_progress", expectedRevision: 1 }, { idempotencyKey: "update-1" }, actor);
    expect(() => service.updateTask("project-1", task.id, { title: "Act", description: "Stale", priority: "later", status: "blocked", expectedRevision: 1 }, { idempotencyKey: "update-2" }, actor))
      .toThrowError(expect.objectContaining<Partial<KnowledgeError>>({ code: "revision_conflict", currentRevision: 2 }));
    expect(store.getTask("project-1", task.id)).toMatchObject({ description: "Second", revision: 2 });
    expect(store.listHistory("project-1", "task", task.id)).toHaveLength(2);
    store.close();
  });

  it("rolls back task creation when its relation cannot be inserted", () => {
    const { store, service, actor } = setup(["thread-1", "task-1", "relation-1", "task-1", "relation-2"]);
    service.createThread("project-1", { title: "Finding", body: "Evidence" }, { idempotencyKey: "thread" }, actor);
    service.createTaskFromThread("project-1", "thread-1", { title: "First", description: "First" }, { idempotencyKey: "task-1" }, actor);
    expect(() => service.createTaskFromThread("project-1", "thread-1", { title: "Second", description: "Second" }, { idempotencyKey: "task-2" }, actor)).toThrow();
    expect(store.listTasks("project-1", 25)).toHaveLength(1);
    store.close();
  });

  it("preserves knowledge when its linked runtime project is removed", () => {
    const { store, service, actor } = setup(["thread-1"]);
    const runtime = store.addProject({ name: "Runtime", repositoryPath: "/tmp/knowledge-runtime", port: 4321, executable: "pnpm", args: ["run", "dev"] });
    store.saveKnowledgeProjectRuntimeLink({ projectId: "project-1", runtimeProjectId: runtime.id, linkedAt: NOW, unlinkedAt: null }, "test");
    service.createThread("project-1", { title: "Durable", body: "Keep me" }, { idempotencyKey: "thread" }, actor);

    store.removeProject(runtime.id, "test");

    expect(store.getKnowledgeProjectRuntimeLink("project-1")).toMatchObject({ runtimeProjectId: null, unlinkedAt: expect.any(String) });
    expect(store.listThreads("project-1", 25)).toHaveLength(1);
    store.close();
  });

  it("archives by revision and can explicitly relink an existing knowledge project", () => {
    const { store, service, actor } = setup();
    const first = store.addProject({ name: "First", repositoryPath: "/tmp/knowledge-runtime-first", port: 4322, executable: "pnpm", args: ["run", "dev"] });
    const second = store.addProject({ name: "Second", repositoryPath: "/tmp/knowledge-runtime-second", port: 4323, executable: "pnpm", args: ["run", "dev"] });
    service.setRuntimeLink("project-1", first.id, { idempotencyKey: "link-first" }, actor);
    expect(service.setRuntimeLink("project-1", second.id, { idempotencyKey: "link-second" }, actor).value.runtimeProjectId).toBe(second.id);

    const archived = service.archiveProject("project-1", 1, { idempotencyKey: "archive" }, actor);
    expect(archived.value).toMatchObject({ status: "archived", revision: 2 });
    expect(service.archiveProject("project-1", 1, { idempotencyKey: "archive" }, actor)).toEqual({ ...archived, replayed: true });
    expect(service.listThreads("project-1", actor)).toEqual([]);
    expect(() => service.createThread("project-1", { title: "No", body: "No" }, { idempotencyKey: "blocked" }, actor))
      .toThrowError(expect.objectContaining({ code: "invalid_request" }));
    store.close();
  });
});
