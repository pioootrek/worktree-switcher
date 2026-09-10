import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  RemoteVerificationError,
  RemoteVerificationService,
  type RemoteVerificationRequest,
} from "@/server/modules/remote-verification";
import { SqliteStateStore } from "./index";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-remote-verification-"));
  directories.push(directory);
  return join(directory, "state.sqlite3");
}

function provision(store: SqliteStateStore): string {
  const localProject = store.addProject({
    name: "Local checkout",
    repositoryPath: "/code/project",
    port: 3210,
    executable: "pnpm",
    args: ["run", "dev"],
  });
  store.saveRemotePrincipal({ id: "owner-1", kind: "owner", status: "active" }, "local-user");
  store.saveRemotePrincipal({ id: "worker-principal-1", kind: "worker", status: "active" }, "local-user");
  store.saveRemoteProjectIdentity(
    { id: "project-1", name: "Project", sourceRemote: "origin", status: "active" },
    "local-user",
  );
  store.saveRemoteWorker({
    id: "worker-1",
    principalId: "worker-principal-1",
    name: "Worker",
    status: "active",
    lastContactAt: null,
  }, "local-user");
  store.saveRemotePrincipalProjectGrant({
    principalId: "owner-1",
    projectId: "project-1",
    permissions: ["submit", "read"],
    revokedAt: null,
  }, "local-user");
  store.saveRemoteWorkerProjectGrant({
    workerId: "worker-1",
    projectId: "project-1",
    localProjectId: localProject.id,
    presetIds: ["node:test"],
    revokedAt: null,
  }, "local-user");
  return localProject.id;
}

function request(id: string, commitSha = SHA): RemoteVerificationRequest {
  return {
    id,
    projectId: "project-1",
    workerId: "worker-1",
    requestedBy: "owner-1",
    commitSha,
    presetId: "node:test",
    idempotencyKey: "submission-1",
    phase: "pending",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("remote verification SQLite persistence", () => {
  it("persists identities and grants, then replays a request after restart", () => {
    const path = databasePath();
    const first = new SqliteStateStore(path);
    provision(first);

    const service = new RemoteVerificationService(first, () => "2026-09-11T00:00:00.000Z", () => "request-1");
    const accepted = service.submit({
      projectId: "project-1",
      workerId: "worker-1",
      commitSha: SHA,
      presetId: "node:test",
      idempotencyKey: "submission-1",
    }, { principalId: "owner-1" });
    expect(accepted.id).toBe("request-1");
    first.close();

    const reopened = new SqliteStateStore(path);
    expect(reopened.getRemotePrincipal("owner-1")).toEqual({ id: "owner-1", kind: "owner", status: "active" });
    expect(reopened.getRemoteProjectIdentity("project-1")).toEqual({
      id: "project-1", name: "Project", sourceRemote: "origin", status: "active",
    });
    expect(reopened.getRemoteWorker("worker-1")).toMatchObject({
      principalId: "worker-principal-1", status: "active", lastContactAt: null,
    });
    expect(reopened.getRemotePrincipalProjectGrant("owner-1", "project-1")?.permissions).toEqual(["submit", "read"]);
    expect(reopened.getRemoteWorkerProjectGrant("worker-1", "project-1")).toMatchObject({
      presetIds: ["node:test"], revokedAt: null,
    });

    const replay = new RemoteVerificationService(reopened, () => "2026-09-11T00:01:00.000Z", () => "request-2")
      .submit({
        projectId: "project-1",
        workerId: "worker-1",
        commitSha: SHA,
        presetId: "node:test",
        idempotencyKey: "submission-1",
      }, { principalId: "owner-1" });
    expect(replay).toEqual(accepted);
    reopened.close();
  });

  it("returns one winner for the same principal and idempotency key across connections", () => {
    const path = databasePath();
    const first = new SqliteStateStore(path);
    provision(first);
    const second = new SqliteStateStore(path);

    expect(first.createOrReplayRemoteVerificationRequest(request("request-1"))).toEqual(request("request-1"));
    expect(second.createOrReplayRemoteVerificationRequest(request("request-2"))).toEqual(request("request-1"));
    expect(second.createOrReplayRemoteVerificationRequest(request("request-3", "a".repeat(40)))).toEqual(request("request-1"));

    first.close();
    second.close();
    const database = new Database(path, { readonly: true });
    expect(database.prepare("SELECT COUNT(*) AS count FROM remote_verification_requests").get()).toEqual({ count: 1 });
    database.close();
  });

  it("persists revocation and lets the service return a stable authorization error", () => {
    const path = databasePath();
    const store = new SqliteStateStore(path);
    provision(store);
    store.saveRemotePrincipalProjectGrant({
      principalId: "owner-1",
      projectId: "project-1",
      permissions: ["read"],
      revokedAt: "2026-09-11T00:02:00.000Z",
    }, "agent:admin");

    const service = new RemoteVerificationService(store);
    expect(() => service.submit({
      projectId: "project-1",
      workerId: "worker-1",
      commitSha: SHA,
      presetId: "node:test",
      idempotencyKey: "submission-1",
    }, { principalId: "owner-1" })).toThrowError(expect.objectContaining<Partial<RemoteVerificationError>>({
      code: "project_forbidden",
    }));
    expect(store.getRemotePrincipalProjectGrant("owner-1", "project-1")?.revokedAt).toBe("2026-09-11T00:02:00.000Z");
    store.close();

    const database = new Database(path, { readonly: true });
    const audit = database.prepare(`
      SELECT actor, details_json FROM controller_audit_events
      WHERE event_type = 'remote.principal_project_grant_saved'
      ORDER BY id DESC LIMIT 1
    `).get() as { actor: string; details_json: string };
    expect(audit.actor).toBe("agent:admin");
    expect(JSON.parse(audit.details_json)).toMatchObject({
      principalId: "owner-1",
      projectId: "project-1",
      revokedAt: "2026-09-11T00:02:00.000Z",
    });
    database.close();
  });

  it("keeps security-sensitive identity bindings immutable", () => {
    const path = databasePath();
    const store = new SqliteStateStore(path);
    provision(store);
    store.saveRemotePrincipal(
      { id: "other-worker-principal", kind: "worker", status: "active" },
      "local-user",
    );

    expect(() => store.saveRemotePrincipal({ id: "owner-1", kind: "agent", status: "active" }, "local-user"))
      .toThrow("Nie można zmienić rodzaju istniejącej tożsamości zdalnej.");
    expect(() => store.saveRemoteProjectIdentity({
      id: "project-1", name: "Project", sourceRemote: "upstream", status: "active",
    }, "local-user")).toThrow("Nie można zmienić źródłowego remote istniejącego projektu zdalnego.");
    expect(() => store.saveRemoteWorker({
      id: "worker-1",
      principalId: "other-worker-principal",
      name: "Worker",
      status: "active",
      lastContactAt: null,
    }, "local-user")).toThrow("Nie można zmienić tożsamości istniejącego workera zdalnego.");

    expect(store.getRemotePrincipal("owner-1")?.kind).toBe("owner");
    expect(store.getRemoteProjectIdentity("project-1")?.sourceRemote).toBe("origin");
    expect(store.getRemoteWorker("worker-1")?.principalId).toBe("worker-principal-1");
    store.close();
  });

  it("cancels admitted work before removing its local worker mapping", () => {
    const path = databasePath();
    const store = new SqliteStateStore(path);
    const localProjectId = provision(store);
    const accepted = new RemoteVerificationService(store, () => "2026-09-11T00:00:00.000Z", () => "request-1")
      .submit({
        projectId: "project-1",
        workerId: "worker-1",
        commitSha: SHA,
        presetId: "node:test",
        idempotencyKey: "submission-1",
      }, { principalId: "owner-1" });

    store.removeProject(localProjectId, "local-user");

    expect(store.getRemoteWorkerProjectGrant("worker-1", "project-1")).toBeNull();
    expect(store.getRemoteProjectIdentity("project-1")).not.toBeNull();
    expect(store.findRemoteVerificationRequestByIdempotency("owner-1", "submission-1")).toEqual({
      ...accepted,
      phase: "cancelled",
      updatedAt: expect.any(String),
    });
    store.close();
  });

  it("records and safely replays migration 13", () => {
    const path = databasePath();
    new SqliteStateStore(path).close();
    const first = new Database(path);
    expect(first.prepare("SELECT 1 FROM schema_migrations WHERE version = 13").get()).toBeTruthy();
    first.prepare("DELETE FROM schema_migrations WHERE version = 13").run();
    first.close();

    new SqliteStateStore(path).close();
    const replayed = new Database(path, { readonly: true });
    expect(replayed.prepare("SELECT 1 FROM schema_migrations WHERE version = 13").get()).toBeTruthy();
    expect(replayed.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'remote_verification_requests'").get())
      .toEqual({ name: "remote_verification_requests" });
    replayed.close();
  });
});
