export type RemotePrincipalKind = "owner" | "agent" | "worker";
export type RemoteIdentityStatus = "active" | "revoked";

export interface RemotePrincipal {
  id: string;
  kind: RemotePrincipalKind;
  status: RemoteIdentityStatus;
}

export interface RemoteProjectIdentity {
  id: string;
  name: string;
  sourceRemote: string;
  status: RemoteIdentityStatus;
}

export interface RemoteWorkerRegistration {
  id: string;
  principalId: string;
  name: string;
  status: RemoteIdentityStatus;
  lastContactAt: string | null;
}

export interface RemotePrincipalProjectGrant {
  principalId: string;
  projectId: string;
  permissions: Array<"submit" | "read">;
  revokedAt: string | null;
}

export interface RemoteWorkerProjectGrant {
  workerId: string;
  projectId: string;
  localProjectId: string;
  presetIds: string[];
  revokedAt: string | null;
}

export type RemoteVerificationRequestPhase = "pending" | "assigned" | "completed" | "cancelled";
export type RemoteVerificationAttemptPhase =
  | "assigned"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "uncertain";

export interface RemoteVerificationRequest {
  id: string;
  projectId: string;
  workerId: string;
  requestedBy: string;
  commitSha: string;
  presetId: string;
  idempotencyKey: string;
  phase: RemoteVerificationRequestPhase;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteVerificationAttempt {
  id: string;
  requestId: string;
  workerId: string;
  sequence: number;
  phase: RemoteVerificationAttemptPhase;
  acceptedAt: string;
  lastReportedAt: string;
}

export interface SubmitRemoteVerificationInput {
  projectId: string;
  workerId: string;
  commitSha: string;
  presetId: string;
  idempotencyKey: string;
}

/** The transport authenticates the caller and supplies this trusted identity. */
export interface RemoteVerificationActor {
  principalId: string;
}

export interface RemoteVerificationStore {
  getRemotePrincipal(id: string): RemotePrincipal | null;
  getRemoteProjectIdentity(id: string): RemoteProjectIdentity | null;
  getRemoteWorker(id: string): RemoteWorkerRegistration | null;
  getRemotePrincipalProjectGrant(principalId: string, projectId: string): RemotePrincipalProjectGrant | null;
  getRemoteWorkerProjectGrant(workerId: string, projectId: string): RemoteWorkerProjectGrant | null;
  findRemoteVerificationRequestByIdempotency(principalId: string, idempotencyKey: string): RemoteVerificationRequest | null;
  /** Atomically creates the request or returns the request that already owns its principal/key pair. */
  createOrReplayRemoteVerificationRequest(request: RemoteVerificationRequest): RemoteVerificationRequest;
}
