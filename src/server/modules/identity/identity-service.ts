import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  AuthenticatedPrincipal,
  CredentialAuthenticationRecord,
  IdentityStore,
  KnowledgePermission,
  PrincipalCredential,
} from "./contracts";

export type IdentityErrorCode =
  | "invalid_credential"
  | "owner_authentication_required"
  | "principal_forbidden"
  | "knowledge_forbidden"
  | "invalid_request";

export class IdentityError extends Error {
  constructor(readonly code: IdentityErrorCode, message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

export interface IssueAgentTokenInput {
  principalId: string;
  label: string;
  expiresAt?: string;
}

export interface IssuedAgentToken {
  credential: PrincipalCredential;
  token: string;
}

const TOKEN_PREFIX = "wts";
const DUMMY_HASH = Buffer.alloc(32);

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function parseToken(token: string): { id: string; hash: Buffer } | null {
  const match = /^wts_([0-9a-f-]{36})_([0-9a-f]{64})$/.exec(token);
  return match ? { id: match[1]!, hash: hashToken(token) } : null;
}

function publicCredential(record: CredentialAuthenticationRecord): PrincipalCredential {
  return {
    id: record.id,
    principalId: record.principalId,
    kind: record.kind,
    label: record.label,
    tokenPrefix: record.tokenPrefix,
    status: record.status,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
    lastUsedAt: record.lastUsedAt,
  };
}

function credentialMatchesPrincipal(
  credential: CredentialAuthenticationRecord,
  principalKind: AuthenticatedPrincipal["principalKind"],
): boolean {
  return (credential.kind === "owner_session" && principalKind === "owner")
    || (credential.kind === "agent_token" && principalKind === "agent")
    || (credential.kind === "worker_token" && principalKind === "worker");
}

export class IdentityService {
  constructor(
    private readonly store: IdentityStore,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly id: () => string = randomUUID,
    private readonly secret: () => string = () => randomBytes(32).toString("hex"),
  ) {}

  authenticateBearer(token: string): AuthenticatedPrincipal {
    const parsed = parseToken(token);
    const record = parsed ? this.store.getCredentialForAuthentication(parsed.id) : null;
    const expected = record && /^[0-9a-f]{64}$/.test(record.verifierHash)
      ? Buffer.from(record.verifierHash, "hex")
      : DUMMY_HASH;
    const supplied = parsed?.hash ?? hashToken(token);
    const matches = timingSafeEqual(expected, supplied);
    const principal = record ? this.store.getPrincipal(record.principalId) : null;
    const now = this.clock();

    if (
      !matches
      || !record
      || record.status !== "active"
      || record.revokedAt !== null
      || (record.expiresAt !== null && record.expiresAt <= now)
      || !principal
      || principal.status !== "active"
      || !credentialMatchesPrincipal(record, principal.kind)
    ) {
      throw new IdentityError("invalid_credential", "Nieprawidłowe lub nieaktywne poświadczenie.");
    }

    this.store.recordCredentialUsed(record.id, now);
    return {
      principalId: principal.id,
      principalKind: principal.kind,
      credentialId: record.id,
      authenticationMethod: record.kind,
    };
  }

  issueAgentToken(input: IssueAgentTokenInput, actor: AuthenticatedPrincipal): IssuedAgentToken {
    this.requireOwnerSession(actor);
    const principal = this.store.getPrincipal(input.principalId);
    if (!principal || principal.kind !== "agent" || principal.status !== "active") {
      throw new IdentityError("principal_forbidden", "Token można wydać wyłącznie aktywnemu agentowi.");
    }
    const label = input.label.trim();
    if (!label || label.length > 120) {
      throw new IdentityError("invalid_request", "Etykieta tokenu musi mieć od 1 do 120 znaków.");
    }
    const now = this.clock();
    if (input.expiresAt && (
      !Number.isFinite(Date.parse(input.expiresAt))
      || new Date(input.expiresAt).toISOString() !== input.expiresAt
      || input.expiresAt <= now
    )) {
      throw new IdentityError("invalid_request", "Data wygaśnięcia musi być w przyszłości.");
    }

    const credentialId = this.id();
    const secret = this.secret();
    if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error("Generator tokenu nie zwrócił 256-bitowego sekretu.");
    const token = `${TOKEN_PREFIX}_${credentialId}_${secret}`;
    const record: CredentialAuthenticationRecord = {
      id: credentialId,
      principalId: principal.id,
      kind: "agent_token",
      label,
      tokenPrefix: `${TOKEN_PREFIX}_${credentialId}_${secret.slice(0, 8)}`,
      verifierHash: hashToken(token).toString("hex"),
      status: "active",
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      revokedAt: null,
      lastUsedAt: null,
    };
    this.store.saveCredential(record, actor.principalId);
    return { credential: publicCredential(record), token };
  }

  revokeCredential(credentialId: string, actor: AuthenticatedPrincipal): void {
    this.requireOwnerSession(actor);
    if (!this.store.revokeCredential(credentialId, this.clock(), actor.principalId)) {
      throw new IdentityError("invalid_request", "Nie znaleziono poświadczenia.");
    }
  }

  authorizeKnowledge(
    actor: AuthenticatedPrincipal,
    projectId: string,
    permission: KnowledgePermission,
  ): void {
    this.requireCurrentAuthentication(actor);
    const project = this.store.getKnowledgeProject(projectId);
    const grant = this.store.getKnowledgeProjectGrant(actor.principalId, projectId);
    if (
      !project
      || project.status !== "active"
      || !grant
      || grant.revokedAt !== null
      || !grant.permissions.includes(permission)
      || (permission === "knowledge:approve"
        && (actor.principalKind !== "owner" || actor.authenticationMethod !== "owner_session"))
    ) {
      throw new IdentityError("knowledge_forbidden", "Brak dostępu do projektu wiedzy.");
    }
  }

  private requireOwnerSession(actor: AuthenticatedPrincipal): void {
    this.requireCurrentAuthentication(actor);
    if (actor.principalKind !== "owner" || actor.authenticationMethod !== "owner_session") {
      throw new IdentityError("owner_authentication_required", "Ta operacja wymaga uwierzytelnionej sesji właściciela.");
    }
  }

  private requireCurrentAuthentication(actor: AuthenticatedPrincipal): void {
    const principal = this.store.getPrincipal(actor.principalId);
    const credential = this.store.getCredentialForAuthentication(actor.credentialId);
    const now = this.clock();
    if (
      !principal
      || principal.status !== "active"
      || principal.kind !== actor.principalKind
      || !credential
      || credential.principalId !== principal.id
      || credential.kind !== actor.authenticationMethod
      || !credentialMatchesPrincipal(credential, principal.kind)
      || credential.status !== "active"
      || credential.revokedAt !== null
      || (credential.expiresAt !== null && credential.expiresAt <= now)
    ) {
      throw new IdentityError("invalid_credential", "Nieprawidłowe lub nieaktywne poświadczenie.");
    }
  }
}
