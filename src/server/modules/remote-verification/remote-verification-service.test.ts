import { describe, expect, it, vi } from "vitest";

import {
  RemoteVerificationError,
  RemoteVerificationService,
  type RemotePrincipal,
  type RemotePrincipalProjectGrant,
  type RemoteProjectIdentity,
  type RemoteVerificationRequest,
  type RemoteVerificationStore,
  type RemoteWorkerProjectGrant,
  type RemoteWorkerRegistration,
} from "./index";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function fixture() {
  const principals = new Map<string, RemotePrincipal>([
    ["owner-1", { id: "owner-1", kind: "owner", status: "active" }],
    ["worker-principal-1", { id: "worker-principal-1", kind: "worker", status: "active" }],
  ]);
  const projects = new Map<string, RemoteProjectIdentity>([
    ["project-1", { id: "project-1", name: "Project", sourceRemote: "origin", status: "active" }],
  ]);
  const workers = new Map<string, RemoteWorkerRegistration>([
    ["worker-1", { id: "worker-1", principalId: "worker-principal-1", name: "Worker", status: "active", lastContactAt: null }],
  ]);
  const principalGrants = new Map<string, RemotePrincipalProjectGrant>([
    ["owner-1:project-1", { principalId: "owner-1", projectId: "project-1", permissions: ["submit", "read"], revokedAt: null }],
  ]);
  const workerGrants = new Map<string, RemoteWorkerProjectGrant>([
    ["worker-1:project-1", { workerId: "worker-1", projectId: "project-1", localProjectId: "local-project-1", presetIds: ["node:test"], revokedAt: null }],
  ]);
  const requests = new Map<string, RemoteVerificationRequest>();
  const save = vi.fn((request: RemoteVerificationRequest) => requests.set(`${request.requestedBy}:${request.idempotencyKey}`, request));
  const store: RemoteVerificationStore = {
    getRemotePrincipal: (id) => principals.get(id) ?? null,
    getRemoteProjectIdentity: (id) => projects.get(id) ?? null,
    getRemoteWorker: (id) => workers.get(id) ?? null,
    getRemotePrincipalProjectGrant: (principalId, projectId) => principalGrants.get(`${principalId}:${projectId}`) ?? null,
    getRemoteWorkerProjectGrant: (workerId, projectId) => workerGrants.get(`${workerId}:${projectId}`) ?? null,
    findRemoteVerificationRequestByIdempotency: (principalId, key) => requests.get(`${principalId}:${key}`) ?? null,
    saveRemoteVerificationRequest: save,
  };
  const service = new RemoteVerificationService(store, () => "2026-09-10T12:00:00.000Z", () => "request-1");
  const input = { projectId: "project-1", workerId: "worker-1", commitSha: SHA, presetId: "node:test", idempotencyKey: "submission-1" };
  return { service, input, principals, projects, workers, principalGrants, workerGrants, save };
}

function expectCode(operation: () => unknown, code: RemoteVerificationError["code"]): void {
  try {
    operation();
    throw new Error("Expected remote verification request to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(RemoteVerificationError);
    expect((error as RemoteVerificationError).code).toBe(code);
  }
}

describe("remote verification submission", () => {
  it("persists one exact-SHA request after checking both principal and worker grants", () => {
    const { service, input, save } = fixture();
    expect(service.submit(input, { principalId: "owner-1" })).toEqual({
      id: "request-1",
      projectId: "project-1",
      workerId: "worker-1",
      requestedBy: "owner-1",
      commitSha: SHA,
      presetId: "node:test",
      idempotencyKey: "submission-1",
      phase: "pending",
      createdAt: "2026-09-10T12:00:00.000Z",
      updatedAt: "2026-09-10T12:00:00.000Z",
    });
    expect(save).toHaveBeenCalledOnce();
  });

  it("replays the same authorized submission and rejects reuse for different request fields", () => {
    const { service, input, principals, projects, workers, principalGrants, workerGrants, save } = fixture();
    const first = service.submit(input, { principalId: "owner-1" });
    expect(service.submit(input, { principalId: "owner-1" })).toBe(first);
    expect(save).toHaveBeenCalledOnce();

    projects.set("project-2", { id: "project-2", name: "Other project", sourceRemote: "origin", status: "active" });
    principalGrants.set("owner-1:project-2", {
      principalId: "owner-1", projectId: "project-2", permissions: ["submit"], revokedAt: null,
    });
    workerGrants.set("worker-1:project-2", {
      workerId: "worker-1", projectId: "project-2", localProjectId: "local-project-2", presetIds: ["node:test"], revokedAt: null,
    });
    principals.set("worker-principal-2", { id: "worker-principal-2", kind: "worker", status: "active" });
    workers.set("worker-2", {
      id: "worker-2", principalId: "worker-principal-2", name: "Other worker", status: "active", lastContactAt: null,
    });
    workerGrants.set("worker-2:project-1", {
      workerId: "worker-2", projectId: "project-1", localProjectId: "local-project-1", presetIds: ["node:test"], revokedAt: null,
    });
    workerGrants.set("worker-1:project-1", {
      ...workerGrants.get("worker-1:project-1")!, presetIds: ["node:test", "node:check"],
    });

    for (const conflicting of [
      { ...input, projectId: "project-2" },
      { ...input, workerId: "worker-2" },
      { ...input, presetId: "node:check" },
      { ...input, commitSha: "a".repeat(40) },
    ]) {
      expectCode(() => service.submit(conflicting, { principalId: "owner-1" }), "idempotency_conflict");
    }
  });

  it("rejects abbreviated commits before reading authorization state", () => {
    const { service, input, save } = fixture();
    expectCode(() => service.submit({ ...input, commitSha: "01234567" }, { principalId: "owner-1" }), "invalid_request");
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects revoked principals and principals without a submit grant", () => {
    const { service, input, principals, principalGrants, save } = fixture();
    principals.set("owner-1", { id: "owner-1", kind: "owner", status: "revoked" });
    expectCode(() => service.submit(input, { principalId: "owner-1" }), "principal_forbidden");
    principals.set("owner-1", { id: "owner-1", kind: "owner", status: "active" });
    principalGrants.delete("owner-1:project-1");
    expectCode(() => service.submit(input, { principalId: "owner-1" }), "project_forbidden");
    expect(save).not.toHaveBeenCalled();
  });

  it("does not let a worker principal submit verification requests", () => {
    const { service, input, save } = fixture();
    expectCode(() => service.submit(input, { principalId: "worker-principal-1" }), "principal_forbidden");
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a worker whose owning principal is revoked or has the wrong kind", () => {
    const { service, input, principals, save } = fixture();
    principals.set("worker-principal-1", { id: "worker-principal-1", kind: "worker", status: "revoked" });
    expectCode(() => service.submit(input, { principalId: "owner-1" }), "worker_unavailable");
    principals.set("worker-principal-1", { id: "worker-principal-1", kind: "agent", status: "active" });
    expectCode(() => service.submit(input, { principalId: "owner-1" }), "worker_unavailable");
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a revoked worker, a foreign worker and a disallowed preset", () => {
    const { service, input, workers, workerGrants, save } = fixture();
    workers.set("worker-1", { ...workers.get("worker-1")!, status: "revoked" });
    expectCode(() => service.submit(input, { principalId: "owner-1" }), "worker_unavailable");
    workers.set("worker-1", { ...workers.get("worker-1")!, status: "active" });
    workerGrants.delete("worker-1:project-1");
    expectCode(() => service.submit(input, { principalId: "owner-1" }), "worker_forbidden");
    workerGrants.set("worker-1:project-1", {
      workerId: "worker-1", projectId: "project-1", localProjectId: "local-project-1", presetIds: ["node:check"], revokedAt: null,
    });
    expectCode(() => service.submit(input, { principalId: "owner-1" }), "preset_forbidden");
    expect(save).not.toHaveBeenCalled();
  });
});
