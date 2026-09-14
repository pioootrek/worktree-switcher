import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteStateStore } from "./sqlite-state-store";
import { IdentityService } from "@/server/modules/identity";
import { KnowledgeService } from "@/server/modules/knowledge";
import type { KnowledgeInput, KnowledgeOperation, KnowledgeMutationResult, KnowledgePage, KnowledgeTask } from "@/shared/contracts/knowledge";
import type { KnowledgeMemory, KnowledgeSearchHit, KnowledgeTaskContext, KnowledgeExport } from "@/shared/contracts/knowledge-memory";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "knowledge-k4-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.sqlite3");
  const store = new SqliteStateStore(path); cleanups.push(() => store.close());
  const identity = new IdentityService(store);
  const owner = identity.authenticateBearer(identity.bootstrapOwnerSession().token);
  const project = identity.createKnowledgeProject({ name: "Synthetic project" }, owner);
  const privateProject = identity.createKnowledgeProject({ name: "Private" }, owner);
  identity.setKnowledgeGrant({ principalId: owner.principalId, projectId: privateProject.id, permissions: ["knowledge:read", "knowledge:write"] }, owner);
  identity.setKnowledgeGrant({ principalId: owner.principalId, projectId: project.id, permissions: ["knowledge:read", "knowledge:write", "knowledge:approve", "knowledge:export"] }, owner);
  const agent = identity.createAgent(owner);
  identity.setKnowledgeGrant({ principalId: agent.id, projectId: project.id, permissions: ["knowledge:read", "knowledge:write", "knowledge:export"] }, owner);
  const actor = identity.authenticateBearer(identity.issueAgentToken({ principalId: agent.id, label: "test" }, owner).token);
  const changed = vi.fn();
  let next = 0;
  const service = new KnowledgeService(store, identity, undefined, () => `record-${++next}`, changed);
  const call = <T>(operation: KnowledgeOperation, input: Record<string, unknown> = {}, who = actor): T => service.execute({ operation, input: { projectId: project.id, ...input } }, who) as T;
  const task = call<KnowledgeMutationResult<KnowledgeTask>>("create_task", { title: "Task", description: "Deliver one verified change", idempotencyKey: "task" }).value;
  const input = { title: "Decision", body: "Use SQLite", category: "decision" as KnowledgeMemory["category"], tags: ["żółć"], legacyId: "NOTE-42", sources: [{ kind: "task" as const, id: task.id, revision: task.revision }], idempotencyKey: "memory" };
  const create = (patch: Partial<typeof input> = {}) => call<KnowledgeMutationResult<KnowledgeMemory>>("create_memory", { ...input, ...patch }).value;
  const change = (operation: KnowledgeOperation, memory: KnowledgeMemory, extra: Record<string, unknown> = {}, who = owner) => call<KnowledgeMutationResult<KnowledgeMemory>>(operation, { memoryId: memory.id, expectedRevision: memory.revision, idempotencyKey: `${operation}-${memory.id}-${memory.revision}`, ...extra }, who).value;
  return { path, store, identity, owner, actor, agent, project, privateProject, service, changed, call, task, input, create, change };
}

describe("K4 memory and session context", () => {
  it("pins approval to a revision, audits it, clears it on editing and persists after restart", () => {
    const f = setup(); const memory = f.create();
    expect(() => f.change("approve_memory", memory, {}, f.actor)).toThrowError(expect.objectContaining({ code: "knowledge_forbidden" }));
    const approved = f.change("approve_memory", memory);
    expect(approved.approval).toMatchObject({ revision: 2, principalId: f.owner.principalId });
    expect(f.call<KnowledgeTaskContext>("task_context", { taskId: f.task.id }).decisions[0].id).toBe(memory.id);
    const updated = f.change("update_memory", approved, { ...f.input, body: "Try PostgreSQL" });
    expect(updated).toMatchObject({ revision: 3, approval: null });
    expect(() => f.change("approve_memory", approved, { idempotencyKey: "stale-approval" })).toThrowError(expect.objectContaining({ code: "revision_conflict", currentRevision: 3 }));
    const history = f.store.listHistory(f.project.id, "memory", memory.id, 25, 0).items;
    expect(history.map(entry => entry.operation)).toEqual(["created", "approved", "updated"]);
    expect(JSON.parse(history[2].previousJson!).approval.revision).toBe(2);
    f.store.close();
    const reopened = new SqliteStateStore(f.path); cleanups.push(() => reopened.close());
    expect(reopened.getMemory(f.project.id, memory.id)).toEqual(updated);
    expect(reopened.listHistory(f.project.id, "memory", memory.id, 25, 0).items).toEqual(history);
  });

  it("replays before stale checks but reauthorizes each replay and emits one event", () => {
    const f = setup(); const memory = f.create(); const events = f.changed.mock.calls.length;
    const replay = f.call<KnowledgeMutationResult<KnowledgeMemory>>("create_memory", f.input);
    expect(replay).toEqual({ value: memory, replayed: true }); expect(f.changed).toHaveBeenCalledTimes(events);
    expect(() => f.create({ body: "Other" })).toThrowError(expect.objectContaining({ code: "idempotency_conflict" }));
    const approved = f.change("approve_memory", memory);
    f.change("update_memory", approved, { ...f.input, body: "Changed" });
    expect(f.change("approve_memory", memory)).toEqual(approved);
    f.identity.revokeKnowledgeGrant(f.agent.id, f.project.id, f.owner);
    expect(() => f.create()).toThrowError(expect.objectContaining({ code: "knowledge_forbidden" }));
    expect(() => f.call("search", { query: "SQLite" })).toThrowError(expect.objectContaining({ code: "knowledge_forbidden" }));
    expect(() => f.call("export_context", { taskId: f.task.id, format: "json" })).toThrowError(expect.objectContaining({ code: "knowledge_forbidden" }));
  });

  it("rejects cross-project, stale and self sources, spoofed approval and oversized writes", () => {
    const f = setup();
    const foreign = f.call<KnowledgeMutationResult<KnowledgeTask>>("create_task", { projectId: f.privateProject.id, title: "Private", description: "Secret", idempotencyKey: "private" }, f.owner).value;
    expect(() => f.create({ sources: [{ kind: "task", id: foreign.id, revision: 1 }] })).toThrowError(expect.objectContaining({ code: "not_found" }));
    expect(() => f.create({ sources: [{ kind: "task", id: f.task.id, revision: 9 }] })).toThrowError(expect.objectContaining({ code: "revision_conflict" }));
    expect(() => f.call("create_memory", { ...f.input, approval: { principalId: "human:owner" } })).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(() => f.create({ body: "ą".repeat(40000) })).toThrowError(expect.objectContaining({ code: "limit_exceeded" }));
    const memory = f.create();
    expect(() => f.change("update_memory", memory, { ...f.input, sources: [{ kind: "memory", id: memory.id, revision: 1 }] })).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(() => f.call("search", { projectId: f.privateProject.id })).toThrowError(expect.objectContaining({ code: "knowledge_forbidden" }));
    expect(f.store.listMemories(f.project.id, 100, 0, "", true).items).toHaveLength(1);
  });

  it("supersedes and archives explicitly; default search/context omit inactive records", () => {
    const f = setup(); const old = f.change("approve_memory", f.create());
    const replacement = f.change("approve_memory", f.create({ title: "New decision", idempotencyKey: "new" }));
    expect(() => f.change("supersede_memory", old, { replacementId: old.id, replacementRevision: old.revision })).toThrow();
    const superseded = f.change("supersede_memory", old, { replacementId: replacement.id, replacementRevision: replacement.revision });
    expect(superseded.supersededBy).toEqual({ id: replacement.id, revision: replacement.revision });
    expect(() => f.change("supersede_memory", replacement, { replacementId: old.id, replacementRevision: superseded.revision })).toThrow();
    const context = f.call<KnowledgeTaskContext>("task_context", { taskId: f.task.id });
    expect(context.decisions.map(item => item.id)).toEqual([replacement.id]);
    expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { kind: "memory" }).items.map(item => item.id)).toEqual([replacement.id]);
    expect(f.call<KnowledgeMemory>("memory", { memoryId: old.id })).toEqual(superseded);
    const archived = f.change("archive_memory", replacement);
    expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { kind: "memory" }).items).toEqual([]);
    expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { kind: "memory", includeInactive: true }).items).toHaveLength(2);
    expect(f.change("restore_memory", archived)).toMatchObject({ status: "active", approval: null });
  });

  it("searches Unicode body, tags and legacy IDs with literal syntax, filters and pagination", () => {
    const f = setup(); const memory = f.create({ body: "Zażółć gęślą jaźń, 100% _ ' OR 1=1" });
    for (const query of ["ZAŻÓŁĆ", "ŻÓŁĆ", "NOTE-42", "100% _ ' OR 1=1"]) {
      expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { query }).items[0].id).toBe(memory.id);
    }
    expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { tag: "ŻÓŁĆ", legacyId: "NOTE-42" }).items).toHaveLength(1);
    expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { tag: "no match" }).items).toEqual([]);
    expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { query: "[]" }).items).toEqual([]);
    const thread = f.call<KnowledgeMutationResult<{ id: string }>>("create_thread", { title: "Thread", body: "unique body needle", idempotencyKey: "thread" }).value;
    f.call("create_reply", { threadId: thread.id, body: "unique reply needle", idempotencyKey: "reply" });
    const found = f.call<KnowledgePage<KnowledgeSearchHit>>("search", { query: "needle", limit: 1 });
    expect(found.items).toHaveLength(1); expect(found.nextOffset).toBe(1);
    expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { query: "needle", limit: 1, offset: 1 }).items[0].id).not.toBe(found.items[0].id);
    expect(f.call<KnowledgePage<KnowledgeSearchHit>>("search", { kind: "task", status: "open", query: "verified" }).items[0].id).toBe(f.task.id);
  });

  it("gives a new session scope, current decisions and questions; exports disclose stale sources and revisions", () => {
    const f = setup(); f.change("approve_memory", f.create());
    f.create({ title: "Unresolved cost?", category: "question", idempotencyKey: "question" });
    const first = f.call<KnowledgeTaskContext>("task_context", { taskId: f.task.id });
    expect(first).toMatchObject({ scope: f.task.description, nextOffset: null, scopeTruncated: false });
    expect(first.decisions).toHaveLength(1); expect(first.openQuestions).toHaveLength(1);
    const exported = f.call<KnowledgeExport>("export_context", { taskId: f.task.id, format: "json" });
    expect(JSON.parse(exported.content)).toMatchObject({ fingerprint: first.fingerprint, formatVersion: 1 });
    f.call("update_task", { taskId: f.task.id, title: f.task.title, description: "New scope", priority: "now", status: "in_progress", expectedRevision: 1, idempotencyKey: "scope" });
    const next = new KnowledgeService(f.store, f.identity).execute({ operation: "task_context", input: { projectId: f.project.id, taskId: f.task.id } }, f.actor) as KnowledgeTaskContext;
    expect(next.fingerprint).not.toBe(exported.fingerprint);
    expect(next.decisions[0].sourceStates[0]).toMatchObject({ stale: true, currentRevision: 2 });
    const markdown = f.call<KnowledgeExport>("export_context", { taskId: f.task.id, format: "markdown" });
    expect(markdown.content).toContain("## Open questions"); expect(markdown.content).toContain("Unresolved cost?");
    expect(markdown.content).toContain('"stale":true');
  });

  it("bounds context, discloses excerpt truncation and requires separate export permission", () => {
    const f = setup();
    for (let i = 0; i < 27; i++) f.create({ body: "ą".repeat(3000), idempotencyKey: `large-${i}` });
    const context = f.call<KnowledgeTaskContext>("task_context", { taskId: f.task.id });
    expect(context.nextOffset).toBe(25); expect(context.proposals).toHaveLength(25);
    expect(context.proposals.every(item => item.bodyTruncated)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThanOrEqual(262144);
    f.identity.setKnowledgeGrant({ principalId: f.agent.id, projectId: f.project.id, permissions: ["knowledge:read"] }, f.owner);
    expect(() => f.call("export_context", { taskId: f.task.id, format: "json" })).toThrowError(expect.objectContaining({ code: "knowledge_forbidden" }));
    expect(f.call<KnowledgeTaskContext>("task_context", { taskId: f.task.id, offset: 25 }).proposals).toHaveLength(2);
  });

  it("keeps K3 history during migration and rolls back failed memory writes with history/idempotency", () => {
    const f = setup(); const before = f.store.listHistory(f.project.id, "task", f.task.id, 25, 0);
    f.store.close();
    const old = new Database(f.path);
    old.exec("DROP TABLE knowledge_memories; DELETE FROM schema_migrations WHERE version = 20;"); old.close();
    const migrated = new SqliteStateStore(f.path); cleanups.push(() => migrated.close());
    expect(migrated.listHistory(f.project.id, "task", f.task.id, 25, 0)).toEqual(before);
    const service = new KnowledgeService(migrated, new IdentityService(migrated), undefined, () => "collision");
    const input: KnowledgeInput<"create_memory"> = { ...f.input, projectId: f.project.id };
    service.execute({ operation: "create_memory", input }, f.actor);
    expect(() => service.execute({ operation: "create_memory", input: { ...input, idempotencyKey: "failed" } }, f.actor)).toThrow();
    expect(migrated.listHistory(f.project.id, "memory", "collision", 100, 0).items).toHaveLength(1);
    const recovered = new KnowledgeService(migrated, new IdentityService(migrated));
    expect(recovered.execute({ operation: "create_memory", input: { ...input, idempotencyKey: "failed" } }, f.actor)).toMatchObject({ replayed: false });
  });
  it("keeps Unicode source URLs bounded and never returns a non-advancing context cursor", () => {
    const f = setup();
    const url = `https://example.test/${"ą".repeat(1800)}`;
    f.call("create_memory", { ...f.input, sources: [...f.input.sources, ...Array.from({ length: 16 }, (_, index) => ({ kind: "external", label: `evidence-${index}`, url }))] });
    const context = f.call<KnowledgeTaskContext>("task_context", { taskId: f.task.id });
    expect(context.proposals).toHaveLength(1); expect(context.nextOffset).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(context), "utf8")).toBeLessThanOrEqual(262144);
    const exported = f.call<KnowledgeExport>("export_context", { taskId: f.task.id, format: "json" });
    expect(Buffer.byteLength(JSON.stringify(exported), "utf8")).toBeLessThanOrEqual(262144);
    expect(() => f.call("create_memory", { ...f.input, idempotencyKey: "unsafe", sources: [{ kind: "external", label: "Unsafe", url: "javascript:alert(1)" }] })).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });

});
