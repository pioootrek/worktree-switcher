import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  CredentialAuthenticationRecord,
  IdentityStore,
  KnowledgeProject,
  KnowledgeProjectGrant,
  KnowledgeProjectRuntimeLink,
  Principal,
} from "./contracts";
import { IdentityError, IdentityService } from "./identity-service";

const NOW = "2026-09-13T12:00:00.000Z";
const OWNER_CREDENTIAL_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_CREDENTIAL_ID = "00000000-0000-4000-8000-000000000002";
const OWNER_TOKEN = `wts_${OWNER_CREDENTIAL_ID}_${"a".repeat(64)}`;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function fixture() {
  const principals = new Map<string, Principal>([
    ["owner-1", { id: "owner-1", kind: "owner", status: "active" }],
    ["agent-1", { id: "agent-1", kind: "agent", status: "active" }],
  ]);
  const credentials = new Map<string, CredentialAuthenticationRecord>([[OWNER_CREDENTIAL_ID, {
    id: OWNER_CREDENTIAL_ID,
    principalId: "owner-1",
    kind: "owner_session",
    label: "Owner session",
    tokenPrefix: "wts_owner",
    verifierHash: hash(OWNER_TOKEN),
    status: "active",
    expiresAt: null,
    createdAt: NOW,
    revokedAt: null,
    lastUsedAt: null,
  }]]);
  const projects = new Map<string, KnowledgeProject>([
    ["project-a", { id: "project-a", name: "A", status: "active", revision: 1, createdAt: NOW, updatedAt: NOW }],
    ["project-b", { id: "project-b", name: "B", status: "active", revision: 1, createdAt: NOW, updatedAt: NOW }],
  ]);
  const grants = new Map<string, KnowledgeProjectGrant>();
  const links = new Map<string, KnowledgeProjectRuntimeLink>();
  const store: IdentityStore = {
    getPrincipal: (id) => principals.get(id) ?? null,
    savePrincipal: (principal) => { principals.set(principal.id, principal); },
    getCredentialForAuthentication: (id) => credentials.get(id) ?? null,
    saveCredential: (credential) => { credentials.set(credential.id, credential); },
    listPrincipalCredentials: (principalId) => [...credentials.values()]
      .filter((credential) => credential.principalId === principalId)
      .map((credential) => ({
        id: credential.id,
        principalId: credential.principalId,
        kind: credential.kind,
        label: credential.label,
        tokenPrefix: credential.tokenPrefix,
        status: credential.status,
        expiresAt: credential.expiresAt,
        createdAt: credential.createdAt,
        revokedAt: credential.revokedAt,
        lastUsedAt: credential.lastUsedAt,
      })),
    revokeCredential: (id, revokedAt) => {
      const credential = credentials.get(id);
      if (!credential || credential.status === "revoked") return false;
      credentials.set(id, { ...credential, status: "revoked", revokedAt });
      return true;
    },
    recordCredentialUsed: (id, usedAt) => {
      credentials.set(id, { ...credentials.get(id)!, lastUsedAt: usedAt });
    },
    getKnowledgeProject: (id) => projects.get(id) ?? null,
    saveKnowledgeProject: (project) => { projects.set(project.id, project); },
    getKnowledgeProjectGrant: (principalId, projectId) => grants.get(`${principalId}:${projectId}`) ?? null,
    saveKnowledgeProjectGrant: (grant) => { grants.set(`${grant.principalId}:${grant.projectId}`, grant); },
    getKnowledgeProjectRuntimeLink: (projectId) => links.get(projectId) ?? null,
    saveKnowledgeProjectRuntimeLink: (link) => { links.set(link.projectId, link); },
  };
  const service = new IdentityService(store, () => NOW, () => AGENT_CREDENTIAL_ID, () => "b".repeat(64));
  return { service, credentials, grants };
}

function expectCode(operation: () => unknown, code: IdentityError["code"]): void {
  expect(operation).toThrowError(expect.objectContaining<Partial<IdentityError>>({ code }));
}

describe("IdentityService", () => {
  it("authenticates a bearer and gives malformed or unknown values one error", () => {
    const { service, credentials } = fixture();
    expect(service.authenticateBearer(OWNER_TOKEN)).toEqual({
      principalId: "owner-1",
      principalKind: "owner",
      credentialId: OWNER_CREDENTIAL_ID,
      authenticationMethod: "owner_session",
    });
    expect(credentials.get(OWNER_CREDENTIAL_ID)?.lastUsedAt).toBe(NOW);
    expectCode(() => service.authenticateBearer(`${OWNER_TOKEN}0`), "invalid_credential");
    expectCode(() => service.authenticateBearer("not-a-token"), "invalid_credential");
    credentials.set(OWNER_CREDENTIAL_ID, { ...credentials.get(OWNER_CREDENTIAL_ID)!, kind: "agent_token" });
    expectCode(() => service.authenticateBearer(OWNER_TOKEN), "invalid_credential");
  });

  it("issues a 256-bit agent token once and persists only its verifier", () => {
    const { service, credentials } = fixture();
    const owner = service.authenticateBearer(OWNER_TOKEN);
    const issued = service.issueAgentToken({ principalId: "agent-1", label: "Codex" }, owner);
    expect(issued.token).toBe(`wts_${AGENT_CREDENTIAL_ID}_${"b".repeat(64)}`);
    expect(issued.credential).not.toHaveProperty("verifierHash");
    expect(credentials.get(AGENT_CREDENTIAL_ID)).toMatchObject({
      principalId: "agent-1",
      kind: "agent_token",
      verifierHash: hash(issued.token),
    });
  });

  it("rechecks credential and grant revocation for every knowledge operation", () => {
    const { service, credentials, grants } = fixture();
    const owner = service.authenticateBearer(OWNER_TOKEN);
    const issued = service.issueAgentToken({ principalId: "agent-1", label: "Codex" }, owner);
    grants.set("agent-1:project-a", {
      principalId: "agent-1", projectId: "project-a", permissions: ["knowledge:read"], revokedAt: null,
    });
    const agent = service.authenticateBearer(issued.token);
    expect(() => service.authorizeKnowledge(agent, "project-a", "knowledge:read")).not.toThrow();
    expectCode(() => service.authorizeKnowledge(agent, "project-b", "knowledge:read"), "knowledge_forbidden");
    expectCode(() => service.authorizeKnowledge(agent, "project-a", "knowledge:write"), "knowledge_forbidden");
    grants.set(`agent-1:project-a`, { ...grants.get(`agent-1:project-a`)!, revokedAt: NOW });
    expectCode(() => service.authorizeKnowledge(agent, "project-a", "knowledge:read"), "knowledge_forbidden");
    grants.set(`agent-1:project-a`, { ...grants.get(`agent-1:project-a`)!, revokedAt: null });
    credentials.set(AGENT_CREDENTIAL_ID, { ...credentials.get(AGENT_CREDENTIAL_ID)!, status: "revoked", revokedAt: NOW });
    expectCode(() => service.authorizeKnowledge(agent, "project-a", "knowledge:read"), "invalid_credential");
  });

  it("does not treat a human-looking agent label as owner approval", () => {
    const { service, grants } = fixture();
    const owner = service.authenticateBearer(OWNER_TOKEN);
    const issued = service.issueAgentToken({ principalId: "agent-1", label: "human:owner" }, owner);
    grants.set("agent-1:project-a", {
      principalId: "agent-1", projectId: "project-a", permissions: ["knowledge:approve"], revokedAt: null,
    });
    const agent = service.authenticateBearer(issued.token);
    expectCode(() => service.authorizeKnowledge(agent, "project-a", "knowledge:approve"), "knowledge_forbidden");
  });
});
