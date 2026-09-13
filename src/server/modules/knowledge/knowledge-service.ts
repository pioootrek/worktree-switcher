import { createHash, randomUUID } from "node:crypto";

import type { AuthenticatedPrincipal, IdentityService, KnowledgeProject, KnowledgeProjectRuntimeLink } from "@/server/modules/identity";
import type {
  KnowledgeMutationContext,
  KnowledgeMutationResult,
  KnowledgeHistoryEntry,
  KnowledgeRelation,
  KnowledgeRecordKind,
  KnowledgeReply,
  KnowledgeStore,
  KnowledgeTask,
  KnowledgeTaskPriority,
  KnowledgeTaskStatus,
  KnowledgeThread,
} from "./contracts";

export type KnowledgeErrorCode = "invalid_request" | "not_found" | "revision_conflict" | "idempotency_conflict";

export class KnowledgeError extends Error {
  constructor(readonly code: KnowledgeErrorCode, message: string, readonly currentRevision?: number) {
    super(message);
    this.name = "KnowledgeError";
  }
}

export interface KnowledgeWriteOptions { idempotencyKey: string }

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export class KnowledgeService {
  constructor(
    private readonly store: KnowledgeStore,
    private readonly identity: Pick<IdentityService, "authorizeKnowledge">,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly id: () => string = randomUUID,
  ) {}

  listThreads(projectId: string, actor: AuthenticatedPrincipal, limit = 25): KnowledgeThread[] {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    return this.store.listThreads(projectId, this.limit(limit));
  }

  thread(projectId: string, threadId: string, actor: AuthenticatedPrincipal): KnowledgeThread {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    const thread = this.store.getThread(projectId, threadId);
    if (!thread) throw new KnowledgeError("not_found", "Nie znaleziono wątku.");
    return thread;
  }

  listReplies(projectId: string, threadId: string, actor: AuthenticatedPrincipal, limit = 25): KnowledgeReply[] {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    if (!this.store.getThread(projectId, threadId)) throw new KnowledgeError("not_found", "Nie znaleziono wątku.");
    return this.store.listReplies(projectId, threadId, this.limit(limit));
  }

  listTasks(projectId: string, actor: AuthenticatedPrincipal, limit = 25): KnowledgeTask[] {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    return this.store.listTasks(projectId, this.limit(limit));
  }

  task(projectId: string, taskId: string, actor: AuthenticatedPrincipal): KnowledgeTask {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    const task = this.store.getTask(projectId, taskId);
    if (!task) throw new KnowledgeError("not_found", "Nie znaleziono zadania.");
    return task;
  }

  relations(projectId: string, recordKind: KnowledgeRecordKind, recordId: string, actor: AuthenticatedPrincipal): KnowledgeRelation[] {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    return this.store.listRelations(projectId, recordKind, recordId);
  }

  history(projectId: string, recordKind: KnowledgeHistoryEntry["recordKind"], recordId: string, actor: AuthenticatedPrincipal): KnowledgeHistoryEntry[] {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    return this.store.listHistory(projectId, recordKind, recordId);
  }

  createThread(projectId: string, input: { title: string; body: string }, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeThread> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    this.requireActiveProject(projectId);
    const title = this.text(input.title, "Tytuł", 200);
    const body = this.text(input.body, "Treść", 65_536);
    const now = this.clock();
    const thread: KnowledgeThread = { id: this.id(), projectId, title, body, revision: 1, createdBy: actor.principalId, createdAt: now, updatedAt: now };
    return this.store.createThread(thread, this.context("thread.create", projectId, { title, body }, options, actor));
  }

  createReply(projectId: string, threadId: string, input: { body: string }, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeReply> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    this.requireActiveProject(projectId);
    if (!this.store.getThread(projectId, threadId)) throw new KnowledgeError("not_found", "Nie znaleziono wątku.");
    const body = this.text(input.body, "Treść", 65_536);
    const now = this.clock();
    const reply: KnowledgeReply = { id: this.id(), projectId, threadId, body, revision: 1, createdBy: actor.principalId, createdAt: now, updatedAt: now };
    return this.store.createReply(reply, this.context("reply.create", projectId, { threadId, body }, options, actor));
  }

  createTaskFromThread(projectId: string, threadId: string, input: { title: string; description: string; priority?: KnowledgeTaskPriority }, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<{ task: KnowledgeTask; relation: KnowledgeRelation }> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    this.requireActiveProject(projectId);
    if (!this.store.getThread(projectId, threadId)) throw new KnowledgeError("not_found", "Nie znaleziono wątku.");
    const title = this.text(input.title, "Tytuł", 200);
    const description = this.text(input.description, "Opis", 65_536);
    const priority = input.priority ?? "later";
    if (!["now", "next", "later"].includes(priority)) throw new KnowledgeError("invalid_request", "Nieprawidłowy priorytet.");
    const now = this.clock();
    const task: KnowledgeTask = { id: this.id(), projectId, title, description, priority, status: "open", revision: 1, createdBy: actor.principalId, createdAt: now, updatedAt: now };
    const relation: KnowledgeRelation = { id: this.id(), projectId, type: "derived_from", sourceKind: "task", sourceId: task.id, targetKind: "thread", targetId: threadId, revision: 1, createdBy: actor.principalId, createdAt: now };
    return this.store.createTaskFromThread(task, relation, this.context("task.create_from_thread", projectId, { threadId, title, description, priority }, options, actor));
  }

  updateTask(projectId: string, taskId: string, input: { title: string; description: string; status: KnowledgeTaskStatus; priority: KnowledgeTaskPriority; expectedRevision: number }, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeTask> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    this.requireActiveProject(projectId);
    const current = this.store.getTask(projectId, taskId);
    if (!current) throw new KnowledgeError("not_found", "Nie znaleziono zadania.");
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new KnowledgeError("invalid_request", "Oczekiwana rewizja musi być dodatnia.");
    const title = this.text(input.title, "Tytuł", 200);
    const description = this.text(input.description, "Opis", 65_536);
    if (!["open", "in_progress", "blocked", "done", "archived"].includes(input.status)) throw new KnowledgeError("invalid_request", "Nieprawidłowy stan.");
    if (!["now", "next", "later"].includes(input.priority)) throw new KnowledgeError("invalid_request", "Nieprawidłowy priorytet.");
    const task = { ...current, title, description, status: input.status, priority: input.priority, revision: input.expectedRevision + 1, updatedAt: this.clock() };
    return this.store.updateTask(task, input.expectedRevision, this.context("task.update", projectId, { taskId, ...input }, options, actor));
  }

  archiveProject(projectId: string, expectedRevision: number, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeProject> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    const current = this.store.getKnowledgeProject(projectId);
    if (!current) throw new KnowledgeError("not_found", "Nie znaleziono projektu wiedzy.");
    const project = { ...current, status: "archived" as const, revision: expectedRevision + 1, updatedAt: this.clock() };
    return this.store.updateKnowledgeProject(project, expectedRevision, this.context("project.archive", projectId, { expectedRevision }, options, actor));
  }

  setRuntimeLink(projectId: string, runtimeProjectId: string | null, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeProjectRuntimeLink> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    const now = this.clock();
    const link = { projectId, runtimeProjectId, linkedAt: now, unlinkedAt: runtimeProjectId === null ? now : null };
    return this.store.setKnowledgeProjectRuntimeLink(link, this.context("project.runtime_link", projectId, { runtimeProjectId }, options, actor));
  }

  private context(operation: string, projectId: string, payload: unknown, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationContext {
    const key = options.idempotencyKey.trim();
    if (!key || key.length > 200) throw new KnowledgeError("invalid_request", "Klucz idempotencji musi mieć od 1 do 200 znaków.");
    return { actor, projectId, idempotencyKey: key, requestHash: canonicalHash({ operation, projectId, payload }) };
  }

  private requireActiveProject(projectId: string): void {
    if (this.store.getKnowledgeProject(projectId)?.status !== "active") throw new KnowledgeError("invalid_request", "Projekt wiedzy jest zarchiwizowany.");
  }

  private text(value: string, label: string, maximum: number): string {
    const normalized = value.trim();
    if (!normalized || Buffer.byteLength(normalized, "utf8") > maximum) throw new KnowledgeError("invalid_request", `${label} ma nieprawidłową długość.`);
    return normalized;
  }

  private limit(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 100) throw new KnowledgeError("invalid_request", "Limit musi wynosić od 1 do 100.");
    return value;
  }
}
