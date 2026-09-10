import { randomUUID } from "node:crypto";

import type {
  RemoteVerificationActor,
  RemoteVerificationRequest,
  RemoteVerificationStore,
  SubmitRemoteVerificationInput,
} from "./contracts";

export type RemoteVerificationErrorCode =
  | "invalid_request"
  | "principal_forbidden"
  | "project_unavailable"
  | "project_forbidden"
  | "worker_unavailable"
  | "worker_forbidden"
  | "preset_forbidden"
  | "idempotency_conflict";

export class RemoteVerificationError extends Error {
  constructor(readonly code: RemoteVerificationErrorCode, message: string) {
    super(message);
    this.name = "RemoteVerificationError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function requireIdentifier(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new RemoteVerificationError("invalid_request", `${label} ma nieprawidłowy format.`);
  }
  const normalized = value.trim();
  if (!IDENTIFIER.test(normalized)) {
    throw new RemoteVerificationError("invalid_request", `${label} ma nieprawidłowy format.`);
  }
  return normalized;
}

function requireCommitSha(value: string): string {
  if (typeof value !== "string") {
    throw new RemoteVerificationError("invalid_request", "Wymagany jest pełny identyfikator commita Git.");
  }
  const normalized = value.trim().toLowerCase();
  if (!COMMIT_SHA.test(normalized)) {
    throw new RemoteVerificationError("invalid_request", "Wymagany jest pełny identyfikator commita Git.");
  }
  return normalized;
}

export class RemoteVerificationService {
  constructor(
    private readonly store: RemoteVerificationStore,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly id: () => string = randomUUID,
  ) {}

  submit(input: SubmitRemoteVerificationInput, actor: RemoteVerificationActor): RemoteVerificationRequest {
    const principalId = requireIdentifier(actor.principalId, "Identyfikator podmiotu");
    const projectId = requireIdentifier(input.projectId, "Identyfikator projektu");
    const workerId = requireIdentifier(input.workerId, "Identyfikator workera");
    const presetId = requireIdentifier(input.presetId, "Identyfikator presetu");
    const idempotencyKey = requireIdentifier(input.idempotencyKey, "Klucz idempotencji");
    const commitSha = requireCommitSha(input.commitSha);

    const principal = this.store.getRemotePrincipal(principalId);
    if (!principal || principal.status !== "active" || principal.kind === "worker") {
      throw new RemoteVerificationError("principal_forbidden", "Podmiot nie może zlecać zdalnej weryfikacji.");
    }
    const project = this.store.getRemoteProjectIdentity(projectId);
    if (!project || project.status !== "active") {
      throw new RemoteVerificationError("project_unavailable", "Projekt zdalnej weryfikacji nie jest dostępny.");
    }
    const principalGrant = this.store.getRemotePrincipalProjectGrant(principalId, projectId);
    if (!principalGrant || principalGrant.revokedAt || !principalGrant.permissions.includes("submit")) {
      throw new RemoteVerificationError("project_forbidden", "Podmiot nie może zlecać weryfikacji tego projektu.");
    }
    const worker = this.store.getRemoteWorker(workerId);
    const workerPrincipal = worker ? this.store.getRemotePrincipal(worker.principalId) : null;
    if (!worker || worker.status !== "active" || !workerPrincipal || workerPrincipal.status !== "active" || workerPrincipal.kind !== "worker") {
      throw new RemoteVerificationError("worker_unavailable", "Worker zdalnej weryfikacji nie jest dostępny.");
    }
    const workerGrant = this.store.getRemoteWorkerProjectGrant(workerId, projectId);
    if (!workerGrant || workerGrant.revokedAt) {
      throw new RemoteVerificationError("worker_forbidden", "Worker nie jest przypisany do tego projektu.");
    }
    if (!workerGrant.presetIds.includes(presetId)) {
      throw new RemoteVerificationError("preset_forbidden", "Worker nie udostępnia wybranego presetu dla tego projektu.");
    }

    const repeated = this.store.findRemoteVerificationRequestByIdempotency(principalId, idempotencyKey);
    if (repeated) {
      if (
        repeated.projectId !== projectId
        || repeated.workerId !== workerId
        || repeated.commitSha !== commitSha
        || repeated.presetId !== presetId
      ) {
        throw new RemoteVerificationError("idempotency_conflict", "Klucz idempotencji jest już używany przez inne zlecenie.");
      }
      return repeated;
    }

    const createdAt = this.now();
    const request: RemoteVerificationRequest = {
      id: this.id(),
      projectId,
      workerId,
      requestedBy: principalId,
      commitSha,
      presetId,
      idempotencyKey,
      phase: "pending",
      createdAt,
      updatedAt: createdAt,
    };
    this.store.saveRemoteVerificationRequest(request);
    return request;
  }
}
