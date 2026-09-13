export type PrincipalKind = "owner" | "agent" | "worker";
export type IdentityStatus = "active" | "revoked";

export interface Principal {
  id: string;
  kind: PrincipalKind;
  status: IdentityStatus;
}

export type CredentialKind = "owner_session" | "agent_token" | "worker_token";

export interface PrincipalCredential {
  id: string;
  principalId: string;
  kind: CredentialKind;
  label: string;
  tokenPrefix: string;
  status: IdentityStatus;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** Server-only authentication material. Never return this shape from a transport. */
export interface CredentialAuthenticationRecord extends PrincipalCredential {
  verifierHash: string;
}

export interface AuthenticatedPrincipal {
  principalId: string;
  principalKind: PrincipalKind;
  credentialId: string;
  authenticationMethod: CredentialKind;
}

export type KnowledgePermission =
  | "knowledge:read"
  | "knowledge:write"
  | "knowledge:approve"
  | "knowledge:export"
  | "knowledge:import"
  | "attachments:read"
  | "attachments:write";

export interface KnowledgeProject {
  id: string;
  name: string;
  status: "active" | "archived";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeProjectGrant {
  principalId: string;
  projectId: string;
  permissions: KnowledgePermission[];
  revokedAt: string | null;
}

export interface KnowledgeProjectRuntimeLink {
  projectId: string;
  runtimeProjectId: string | null;
  linkedAt: string;
  unlinkedAt: string | null;
}

export interface IdentityStore {
  getPrincipal(id: string): Principal | null;
  savePrincipal(principal: Principal, actor: string): void;
  getCredentialForAuthentication(id: string): CredentialAuthenticationRecord | null;
  saveCredential(credential: CredentialAuthenticationRecord, actor: string): void;
  listPrincipalCredentials(principalId: string): PrincipalCredential[];
  revokeCredential(id: string, revokedAt: string, actor: string): boolean;
  recordCredentialUsed(id: string, usedAt: string): void;
  getKnowledgeProject(id: string): KnowledgeProject | null;
  saveKnowledgeProject(project: KnowledgeProject, actor: string): void;
  getKnowledgeProjectGrant(principalId: string, projectId: string): KnowledgeProjectGrant | null;
  saveKnowledgeProjectGrant(grant: KnowledgeProjectGrant, actor: string): void;
  getKnowledgeProjectRuntimeLink(projectId: string): KnowledgeProjectRuntimeLink | null;
  saveKnowledgeProjectRuntimeLink(link: KnowledgeProjectRuntimeLink, actor: string): void;
}
