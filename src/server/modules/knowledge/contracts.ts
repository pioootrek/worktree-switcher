import type { AuthenticatedPrincipal, KnowledgeProject, KnowledgeProjectRuntimeLink } from "@/server/modules/identity";

export type KnowledgeRecordKind = "thread" | "reply" | "task";
export type KnowledgeTaskStatus = "open" | "in_progress" | "blocked" | "done" | "archived";
export type KnowledgeTaskPriority = "now" | "next" | "later";
export type KnowledgeRelationType = "derived_from" | "blocks" | "relates_to" | "supersedes";

export interface KnowledgeThread {
  id: string;
  projectId: string;
  title: string;
  body: string;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeReply {
  id: string;
  projectId: string;
  threadId: string;
  body: string;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: KnowledgeTaskStatus;
  priority: KnowledgeTaskPriority;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRelation {
  id: string;
  projectId: string;
  type: KnowledgeRelationType;
  sourceKind: KnowledgeRecordKind;
  sourceId: string;
  targetKind: KnowledgeRecordKind;
  targetId: string;
  revision: number;
  createdBy: string;
  createdAt: string;
}

export interface KnowledgeHistoryEntry {
  id: number;
  projectId: string;
  recordKind: KnowledgeRecordKind | "project" | "relation";
  recordId: string;
  operation: "created" | "updated" | "archived" | "linked" | "unlinked";
  previousJson: string | null;
  principalId: string;
  authenticationMethod: AuthenticatedPrincipal["authenticationMethod"];
  revision: number;
  createdAt: string;
}

export interface KnowledgeMutationContext {
  actor: AuthenticatedPrincipal;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface KnowledgeMutationResult<T> {
  value: T;
  replayed: boolean;
}

export interface KnowledgePage<T> {
  items: T[];
  nextOffset: number | null;
}

export interface KnowledgePageOptions {
  limit?: number;
  offset?: number;
}

export interface KnowledgeRuntimeLinkResult {
  link: KnowledgeProjectRuntimeLink;
  project: KnowledgeProject;
}

export interface KnowledgeStore {
  getKnowledgeProject(id: string): KnowledgeProject | null;
  hasRuntimeProject(id: string): boolean;
  getRuntimeLinkOwner(runtimeProjectId: string): string | null;
  findIdempotentResult<T>(operation: string, context: KnowledgeMutationContext): KnowledgeMutationResult<T> | null;
  listThreads(projectId: string, limit: number, offset: number): KnowledgePage<KnowledgeThread>;
  getThread(projectId: string, id: string): KnowledgeThread | null;
  listReplies(projectId: string, threadId: string, limit: number, offset: number): KnowledgePage<KnowledgeReply>;
  listRelations(projectId: string, recordKind: KnowledgeRecordKind, recordId: string, limit: number, offset: number): KnowledgePage<KnowledgeRelation>;
  getTask(projectId: string, id: string): KnowledgeTask | null;
  listTasks(projectId: string, limit: number, offset: number): KnowledgePage<KnowledgeTask>;
  listHistory(projectId: string, recordKind: KnowledgeHistoryEntry["recordKind"], recordId: string, limit: number, offset: number): KnowledgePage<KnowledgeHistoryEntry>;
  createThread(thread: KnowledgeThread, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeThread>;
  createReply(reply: KnowledgeReply, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeReply>;
  createTaskFromThread(task: KnowledgeTask, relation: KnowledgeRelation, context: KnowledgeMutationContext): KnowledgeMutationResult<{ task: KnowledgeTask; relation: KnowledgeRelation }>;
  updateTask(task: KnowledgeTask, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeTask>;
  updateKnowledgeProject(project: KnowledgeProject, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeProject>;
  setKnowledgeProjectRuntimeLink(link: KnowledgeProjectRuntimeLink, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeRuntimeLinkResult>;
}
