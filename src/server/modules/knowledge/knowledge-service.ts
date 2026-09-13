import { createHash, randomUUID } from "node:crypto";

import type { AuthenticatedPrincipal, IdentityService, KnowledgeProject } from "@/server/modules/identity";
import type {
  KnowledgeMutationContext,
  KnowledgeMutationResult,
  KnowledgeHistoryEntry,
  KnowledgePage,
  KnowledgePageOptions,
  KnowledgeRelation,
  KnowledgeRecordKind,
  KnowledgeReply,
  KnowledgeRuntimeLinkResult,
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export class KnowledgeService {
  constructor(
    private readonly store: KnowledgeStore,
    private readonly identity: Pick<IdentityService, "authorizeKnowledge">,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly id: () => string = randomUUID,
  ) {}

  listThreads(projectId: string, actor: AuthenticatedPrincipal, options: KnowledgePageOptions = {}): KnowledgePage<KnowledgeThread> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    const page = this.page(options);
    return this.store.listThreads(projectId, page.limit, page.offset);
  }

  thread(projectId: string, threadId: string, actor: AuthenticatedPrincipal): KnowledgeThread {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    const thread = this.store.getThread(projectId, threadId);
    if (!thread) throw new KnowledgeError("not_found", "Nie znaleziono wątku.");
    return thread;
  }

  listReplies(projectId: string, threadId: string, actor: AuthenticatedPrincipal, options: KnowledgePageOptions = {}): KnowledgePage<KnowledgeReply> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    if (!this.store.getThread(projectId, threadId)) throw new KnowledgeError("not_found", "Nie znaleziono wątku.");
    const page = this.page(options);
    return this.store.listReplies(projectId, threadId, page.limit, page.offset);
  }

  listTasks(projectId: string, actor: AuthenticatedPrincipal, options: KnowledgePageOptions = {}): KnowledgePage<KnowledgeTask> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    const page = this.page(options);
    return this.store.listTasks(projectId, page.limit, page.offset);
  }

  task(projectId: string, taskId: string, actor: AuthenticatedPrincipal): KnowledgeTask {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    const task = this.store.getTask(projectId, taskId);
    if (!task) throw new KnowledgeError("not_found", "Nie znaleziono zadania.");
    return task;
  }

  relations(projectId: string, recordKind: KnowledgeRecordKind, recordId: string, actor: AuthenticatedPrincipal, options: KnowledgePageOptions = {}): KnowledgePage<KnowledgeRelation> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    const page = this.page(options);
    return this.store.listRelations(projectId, recordKind, recordId, page.limit, page.offset);
  }

  history(projectId: string, recordKind: KnowledgeHistoryEntry["recordKind"], recordId: string, actor: AuthenticatedPrincipal, options: KnowledgePageOptions = {}): KnowledgePage<KnowledgeHistoryEntry> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:read");
    const page = this.page(options);
    return this.store.listHistory(projectId, recordKind, recordId, page.limit, page.offset);
  }

  createThread(projectId: string, input: { title: string; body: string }, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeThread> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    const title = this.text(input.title, "Tytuł", 200);
    const body = this.text(input.body, "Treść", 65_536);
    const context = this.context("thread.create", projectId, { title, body }, options, actor);
    const replay = this.store.findIdempotentResult<KnowledgeThread>("thread.create", context);
    if (replay) return replay;
    this.requireActiveProject(projectId);
    const now = this.clock();
    const thread: KnowledgeThread = { id: this.id(), projectId, title, body, revision: 1, createdBy: actor.principalId, createdAt: now, updatedAt: now };
    return this.store.createThread(thread, context);
  }

  createReply(projectId: string, threadId: string, input: { body: string }, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeReply> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    const body = this.text(input.body, "Treść", 65_536);
    const context = this.context("reply.create", projectId, { threadId, body }, options, actor);
    const replay = this.store.findIdempotentResult<KnowledgeReply>("reply.create", context);
    if (replay) return replay;
    this.requireActiveProject(projectId);
    if (!this.store.getThread(projectId, threadId)) throw new KnowledgeError("not_found", "Nie znaleziono wątku.");
    const now = this.clock();
    const reply: KnowledgeReply = { id: this.id(), projectId, threadId, body, revision: 1, createdBy: actor.principalId, createdAt: now, updatedAt: now };
    return this.store.createReply(reply, context);
  }

  createTaskFromThread(projectId: string, threadId: string, input: { title: string; description: string; priority?: KnowledgeTaskPriority }, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<{ task: KnowledgeTask; relation: KnowledgeRelation }> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    const title = this.text(input.title, "Tytuł", 200);
    const description = this.text(input.description, "Opis", 65_536);
    const priority = input.priority ?? "later";
    if (!["now", "next", "later"].includes(priority)) throw new KnowledgeError("invalid_request", "Nieprawidłowy priorytet.");
    const context = this.context("task.create_from_thread", projectId, { threadId, title, description, priority }, options, actor);
    const replay = this.store.findIdempotentResult<{ task: KnowledgeTask; relation: KnowledgeRelation }>("task.create_from_thread", context);
    if (replay) return replay;
    this.requireActiveProject(projectId);
    if (!this.store.getThread(projectId, threadId)) throw new KnowledgeError("not_found", "Nie znaleziono wątku.");
    const now = this.clock();
    const task: KnowledgeTask = { id: this.id(), projectId, title, description, priority, status: "open", revision: 1, createdBy: actor.principalId, createdAt: now, updatedAt: now };
    const relation: KnowledgeRelation = { id: this.id(), projectId, type: "derived_from", sourceKind: "task", sourceId: task.id, targetKind: "thread", targetId: threadId, revision: 1, createdBy: actor.principalId, createdAt: now };
    return this.store.createTaskFromThread(task, relation, context);
  }

  updateTask(projectId: string, taskId: string, input: { title: string; description: string; status: KnowledgeTaskStatus; priority: KnowledgeTaskPriority; expectedRevision: number }, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeTask> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new KnowledgeError("invalid_request", "Oczekiwana rewizja musi być dodatnia.");
    const title = this.text(input.title, "Tytuł", 200);
    const description = this.text(input.description, "Opis", 65_536);
    if (!["open", "in_progress", "blocked", "done", "archived"].includes(input.status)) throw new KnowledgeError("invalid_request", "Nieprawidłowy stan.");
    if (!["now", "next", "later"].includes(input.priority)) throw new KnowledgeError("invalid_request", "Nieprawidłowy priorytet.");
    const payload = { taskId, title, description, status: input.status, priority: input.priority, expectedRevision: input.expectedRevision };
    const context = this.context("task.update", projectId, payload, options, actor);
    const replay = this.store.findIdempotentResult<KnowledgeTask>("task.update", context);
    if (replay) return replay;
    this.requireActiveProject(projectId);
    const current = this.store.getTask(projectId, taskId);
    if (!current) throw new KnowledgeError("not_found", "Nie znaleziono zadania.");
    const task = { ...current, title, description, status: input.status, priority: input.priority, revision: input.expectedRevision + 1, updatedAt: this.clock() };
    return this.store.updateTask(task, input.expectedRevision, context);
  }

  archiveProject(projectId: string, expectedRevision: number, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeProject> {
    return this.setProjectStatus(projectId, "archived", expectedRevision, options, actor);
  }

  restoreProject(projectId: string, expectedRevision: number, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeProject> {
    return this.setProjectStatus(projectId, "active", expectedRevision, options, actor);
  }

  private setProjectStatus(projectId: string, status: KnowledgeProject["status"], expectedRevision: number, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeProject> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    this.revision(expectedRevision);
    const operation = status === "active" ? "project.restore" : "project.archive";
    const context = this.context(operation, projectId, { expectedRevision }, options, actor);
    const replay = this.store.findIdempotentResult<KnowledgeProject>(operation, context);
    if (replay) return replay;
    const current = this.store.getKnowledgeProject(projectId);
    if (!current) throw new KnowledgeError("not_found", "Nie znaleziono projektu wiedzy.");
    const project = { ...current, status, revision: expectedRevision + 1, updatedAt: this.clock() };
    return this.store.updateKnowledgeProject(project, expectedRevision, context);
  }

  setRuntimeLink(projectId: string, runtimeProjectId: string | null, expectedRevision: number, options: KnowledgeWriteOptions, actor: AuthenticatedPrincipal): KnowledgeMutationResult<KnowledgeRuntimeLinkResult> {
    this.identity.authorizeKnowledge(actor, projectId, "knowledge:write");
    this.revision(expectedRevision);
    const context = this.context("project.runtime_link", projectId, { runtimeProjectId, expectedRevision }, options, actor);
    const replay = this.store.findIdempotentResult<KnowledgeRuntimeLinkResult>("project.runtime_link", context);
    if (replay) return replay;
    const now = this.clock();
    const link = { projectId, runtimeProjectId, linkedAt: now, unlinkedAt: runtimeProjectId === null ? now : null };
    return this.store.setKnowledgeProjectRuntimeLink(link, expectedRevision, context);
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

  private revision(value: number): void {
    if (!Number.isInteger(value) || value < 1) throw new KnowledgeError("invalid_request", "Oczekiwana rewizja musi być dodatnia.");
  }

  private page(options: KnowledgePageOptions): { limit: number; offset: number } {
    const limit = options.limit ?? 25;
    const offset = options.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new KnowledgeError("invalid_request", "Limit musi wynosić od 1 do 100.");
    if (!Number.isInteger(offset) || offset < 0) throw new KnowledgeError("invalid_request", "Offset musi być nieujemny.");
    return { limit, offset };
  }
}
