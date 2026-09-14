import type { AuthenticatedPrincipal, KnowledgeProject, KnowledgeProjectRuntimeLink } from "@/server/modules/identity";

import type { KnowledgeRecordKind, KnowledgeThread, KnowledgeReply, KnowledgeTask, KnowledgeRelation, KnowledgeHistoryEntry, KnowledgeMutationResult, KnowledgePage, KnowledgeFilters, KnowledgeProjectSummary } from "@/shared/contracts/knowledge";
export type { KnowledgeRecordKind, KnowledgeTaskStatus, KnowledgeTaskPriority, KnowledgeRelationType, KnowledgeThread, KnowledgeReply, KnowledgeTask, KnowledgeRelation, KnowledgeHistoryEntry, KnowledgeMutationResult, KnowledgePage, KnowledgePageOptions, KnowledgeFilters, KnowledgeProjectSummary } from "@/shared/contracts/knowledge";

export interface KnowledgeMutationContext {
  actor: AuthenticatedPrincipal;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface KnowledgeRuntimeLinkResult {
  link: KnowledgeProjectRuntimeLink;
  project: KnowledgeProject;
}

export interface KnowledgeStore {
  listKnowledgeProjects(principalId: string, limit: number, offset: number): KnowledgePage<KnowledgeProjectSummary>;
  createTask(task: KnowledgeTask, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeTask>;
  getKnowledgeProject(id: string): KnowledgeProject | null;
  hasRuntimeProject(id: string): boolean;
  getRuntimeLinkOwner(runtimeProjectId: string): string | null;
  findIdempotentResult<T>(operation: string, context: KnowledgeMutationContext): KnowledgeMutationResult<T> | null;
  listThreads(projectId: string, limit: number, offset: number, filters?: KnowledgeFilters): KnowledgePage<KnowledgeThread>;
  getThread(projectId: string, id: string): KnowledgeThread | null;
  listReplies(projectId: string, threadId: string, limit: number, offset: number): KnowledgePage<KnowledgeReply>;
  listRelations(projectId: string, recordKind: KnowledgeRecordKind, recordId: string, limit: number, offset: number): KnowledgePage<KnowledgeRelation>;
  getTask(projectId: string, id: string): KnowledgeTask | null;
  listTasks(projectId: string, limit: number, offset: number, filters?: KnowledgeFilters): KnowledgePage<KnowledgeTask>;
  listHistory(projectId: string, recordKind: KnowledgeHistoryEntry["recordKind"], recordId: string, limit: number, offset: number): KnowledgePage<KnowledgeHistoryEntry>;
  createThread(thread: KnowledgeThread, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeThread>;
  createReply(reply: KnowledgeReply, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeReply>;
  createTaskFromThread(task: KnowledgeTask, relation: KnowledgeRelation, context: KnowledgeMutationContext): KnowledgeMutationResult<{ task: KnowledgeTask; relation: KnowledgeRelation }>;
  updateTask(task: KnowledgeTask, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeTask>;
  updateKnowledgeProject(project: KnowledgeProject, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeProject>;
  setKnowledgeProjectRuntimeLink(link: KnowledgeProjectRuntimeLink, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeRuntimeLinkResult>;
}
