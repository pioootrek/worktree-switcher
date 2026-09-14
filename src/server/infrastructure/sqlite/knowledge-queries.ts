import type { KnowledgeFilters, KnowledgeProjectSummary } from "@/shared/contracts/knowledge";
import Database from "better-sqlite3";

import {
  KnowledgeError,
  type KnowledgeHistoryEntry,
  type KnowledgeMutationContext,
  type KnowledgeMutationResult,
  type KnowledgePage,
  type KnowledgeRelation,
  type KnowledgeReply,
  type KnowledgeRuntimeLinkResult,
  type KnowledgeStore,
  type KnowledgeTask,
  type KnowledgeThread,
} from "@/server/modules/knowledge";
import type { KnowledgeProject, KnowledgeProjectRuntimeLink } from "@/server/modules/identity";

type ThreadRow = { id: string; project_id: string; title: string; body: string; revision: number; created_by: string; created_at: string; updated_at: string };
type ReplyRow = { id: string; project_id: string; thread_id: string; body: string; revision: number; created_by: string; created_at: string; updated_at: string };
type TaskRow = { id: string; project_id: string; title: string; description: string; status: KnowledgeTask["status"]; priority: KnowledgeTask["priority"]; revision: number; created_by: string; created_at: string; updated_at: string };
type HistoryRow = { id: number; project_id: string; record_kind: KnowledgeHistoryEntry["recordKind"]; record_id: string; operation: KnowledgeHistoryEntry["operation"]; previous_json: string | null; principal_id: string; authentication_method: KnowledgeHistoryEntry["authenticationMethod"]; revision: number; created_at: string };
type RelationRow = { id: string; project_id: string; type: KnowledgeRelation["type"]; source_kind: KnowledgeRelation["sourceKind"]; source_id: string; target_kind: KnowledgeRelation["targetKind"]; target_id: string; revision: number; created_by: string; created_at: string };
type IdempotencyRow = { request_hash: string; result_json: string };

const mapThread = (row: ThreadRow): KnowledgeThread => ({ id: row.id, projectId: row.project_id, title: row.title, body: row.body, revision: row.revision, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at });
const mapReply = (row: ReplyRow): KnowledgeReply => ({ id: row.id, projectId: row.project_id, threadId: row.thread_id, body: row.body, revision: row.revision, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at });
const mapTask = (row: TaskRow): KnowledgeTask => ({ id: row.id, projectId: row.project_id, title: row.title, description: row.description, status: row.status, priority: row.priority, revision: row.revision, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at });

/** Borrows the controller's singleton connection and owns no lifecycle. */
export class KnowledgeQueries implements KnowledgeStore {
  constructor(private readonly database: Database.Database) {
    database.function("knowledge_fold", { deterministic: true }, value => String(value).normalize("NFC").toLowerCase());
  }

  listKnowledgeProjects(principalId: string, limit: number, offset: number): KnowledgePage<KnowledgeProjectSummary> {
    const rows = this.database.prepare(`SELECT p.*, EXISTS(SELECT 1 FROM json_each(g.permissions_json) WHERE value = 'knowledge:write') AS writable
      FROM knowledge_projects p JOIN knowledge_project_grants g ON g.project_id = p.id
      WHERE g.principal_id = ? AND g.revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM json_each(g.permissions_json) WHERE value = 'knowledge:read')
      ORDER BY p.name, p.id LIMIT ? OFFSET ?`).all(principalId, limit + 1, offset) as Array<{ id: string; name: string; status: KnowledgeProject["status"]; revision: number; created_at: string; updated_at: string; writable: number }>;
    return this.page(rows.map(row => ({ id: row.id, name: row.name, status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, writable: Boolean(row.writable) })), limit, offset);
  }

  createTask(task: KnowledgeTask, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeTask> {
    return this.mutate("task.create", context, () => {
      this.insertTask(task);
      this.history(task.projectId, "task", task.id, "created", null, task.revision, context, task.createdAt);
      return task;
    });
  }

  getKnowledgeProject(id: string): KnowledgeProject | null {
    const row = this.database.prepare("SELECT id, name, status, revision, created_at, updated_at FROM knowledge_projects WHERE id = ?").get(id) as { id: string; name: string; status: KnowledgeProject["status"]; revision: number; created_at: string; updated_at: string } | undefined;
    return row ? { id: row.id, name: row.name, status: row.status, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  hasRuntimeProject(id: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(id));
  }

  getRuntimeLinkOwner(runtimeProjectId: string): string | null {
    const row = this.database.prepare("SELECT knowledge_project_id FROM knowledge_project_runtime_links WHERE runtime_project_id = ?").get(runtimeProjectId) as { knowledge_project_id: string } | undefined;
    return row?.knowledge_project_id ?? null;
  }

  listThreads(projectId: string, limit: number, offset: number, filters: KnowledgeFilters = {}): KnowledgePage<KnowledgeThread> {
    return this.page((this.database.prepare("SELECT * FROM knowledge_threads WHERE project_id = ? AND instr(knowledge_fold(title), knowledge_fold(?)) > 0 ORDER BY updated_at DESC, id LIMIT ? OFFSET ?").all(projectId, filters.query ?? "", limit + 1, offset) as ThreadRow[]).map(mapThread), limit, offset);
  }
  getThread(projectId: string, id: string): KnowledgeThread | null {
    const row = this.database.prepare("SELECT * FROM knowledge_threads WHERE project_id = ? AND id = ?").get(projectId, id) as ThreadRow | undefined;
    return row ? mapThread(row) : null;
  }
  listReplies(projectId: string, threadId: string, limit: number, offset: number): KnowledgePage<KnowledgeReply> {
    return this.page((this.database.prepare("SELECT * FROM knowledge_replies WHERE project_id = ? AND thread_id = ? ORDER BY created_at, id LIMIT ? OFFSET ?").all(projectId, threadId, limit + 1, offset) as ReplyRow[]).map(mapReply), limit, offset);
  }
  listRelations(projectId: string, recordKind: KnowledgeRelation["sourceKind"], recordId: string, limit: number, offset: number): KnowledgePage<KnowledgeRelation> {
    const rows = (this.database.prepare(`SELECT * FROM knowledge_relations WHERE project_id = ? AND ((source_kind = ? AND source_id = ?) OR (target_kind = ? AND target_id = ?)) ORDER BY created_at, id LIMIT ? OFFSET ?`).all(projectId, recordKind, recordId, recordKind, recordId, limit + 1, offset) as RelationRow[]).map((row) => ({ id: row.id, projectId: row.project_id, type: row.type, sourceKind: row.source_kind, sourceId: row.source_id, targetKind: row.target_kind, targetId: row.target_id, revision: row.revision, createdBy: row.created_by, createdAt: row.created_at }));
    return this.page(rows, limit, offset);
  }
  getTask(projectId: string, id: string): KnowledgeTask | null {
    const row = this.database.prepare("SELECT * FROM knowledge_tasks WHERE project_id = ? AND id = ?").get(projectId, id) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }
  listTasks(projectId: string, limit: number, offset: number, filters: KnowledgeFilters = {}): KnowledgePage<KnowledgeTask> {
    return this.page((this.database.prepare("SELECT * FROM knowledge_tasks WHERE project_id = ? AND instr(knowledge_fold(title), knowledge_fold(?)) > 0 AND (? IS NULL OR status = ?) AND (? IS NULL OR priority = ?) ORDER BY updated_at DESC, id LIMIT ? OFFSET ?").all(projectId, filters.query ?? "", filters.status ?? null, filters.status ?? null, filters.priority ?? null, filters.priority ?? null, limit + 1, offset) as TaskRow[]).map(mapTask), limit, offset);
  }
  listHistory(projectId: string, recordKind: KnowledgeHistoryEntry["recordKind"], recordId: string, limit: number, offset: number): KnowledgePage<KnowledgeHistoryEntry> {
    const rows = (this.database.prepare("SELECT * FROM knowledge_history WHERE project_id = ? AND record_kind = ? AND record_id = ? ORDER BY id LIMIT ? OFFSET ?").all(projectId, recordKind, recordId, limit + 1, offset) as HistoryRow[]).map((row) => ({ id: row.id, projectId: row.project_id, recordKind: row.record_kind, recordId: row.record_id, operation: row.operation, previousJson: row.previous_json, principalId: row.principal_id, authenticationMethod: row.authentication_method, revision: row.revision, createdAt: row.created_at }));
    return this.page(rows, limit, offset);
  }

  findIdempotentResult<T>(operation: string, context: KnowledgeMutationContext): KnowledgeMutationResult<T> | null {
    const previous = this.database.prepare(`SELECT request_hash, result_json FROM knowledge_idempotency WHERE principal_id = ? AND project_id = ? AND operation = ? AND idempotency_key = ?`).get(context.actor.principalId, context.projectId, operation, context.idempotencyKey) as IdempotencyRow | undefined;
    if (!previous) return null;
    if (previous.request_hash !== context.requestHash) throw new KnowledgeError("idempotency_conflict", "Klucz idempotencji został użyty z inną treścią.");
    return { value: JSON.parse(previous.result_json) as T, replayed: true };
  }

  createThread(thread: KnowledgeThread, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeThread> {
    return this.mutate("thread.create", context, () => {
      this.database.prepare("INSERT INTO knowledge_threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(thread.id, thread.projectId, thread.title, thread.body, thread.revision, thread.createdBy, thread.createdAt, thread.updatedAt);
      this.history(thread.projectId, "thread", thread.id, "created", null, thread.revision, context, thread.createdAt);
      return thread;
    });
  }

  createReply(reply: KnowledgeReply, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeReply> {
    return this.mutate("reply.create", context, () => {
      this.database.prepare("INSERT INTO knowledge_replies VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(reply.id, reply.projectId, reply.threadId, reply.body, reply.revision, reply.createdBy, reply.createdAt, reply.updatedAt);
      this.history(reply.projectId, "reply", reply.id, "created", null, reply.revision, context, reply.createdAt);
      return reply;
    });
  }

  createTaskFromThread(task: KnowledgeTask, relation: KnowledgeRelation, context: KnowledgeMutationContext): KnowledgeMutationResult<{ task: KnowledgeTask; relation: KnowledgeRelation }> {
    return this.mutate("task.create_from_thread", context, () => {
      this.insertTask(task);
      this.database.prepare("INSERT INTO knowledge_relations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(relation.id, relation.projectId, relation.type, relation.sourceKind, relation.sourceId, relation.targetKind, relation.targetId, relation.revision, relation.createdBy, relation.createdAt);
      this.history(task.projectId, "task", task.id, "created", null, task.revision, context, task.createdAt);
      this.history(relation.projectId, "relation", relation.id, "linked", null, relation.revision, context, relation.createdAt);
      return { task, relation };
    });
  }

  updateTask(task: KnowledgeTask, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeTask> {
    return this.mutate("task.update", context, () => {
      const previous = this.getTask(task.projectId, task.id);
      if (!previous) throw new KnowledgeError("not_found", "Nie znaleziono zadania.");
      const result = this.database.prepare(`UPDATE knowledge_tasks SET title = ?, description = ?, status = ?, priority = ?, revision = ?, updated_at = ? WHERE project_id = ? AND id = ? AND revision = ?`)
        .run(task.title, task.description, task.status, task.priority, task.revision, task.updatedAt, task.projectId, task.id, expectedRevision);
      if (result.changes === 0) {
        const current = this.getTask(task.projectId, task.id);
        throw new KnowledgeError("revision_conflict", "Rewizja zadania uległa zmianie.", current?.revision);
      }
      this.history(task.projectId, "task", task.id, task.status === "archived" ? "archived" : "updated", JSON.stringify(previous), task.revision, context, task.updatedAt);
      return task;
    });
  }

  updateKnowledgeProject(project: KnowledgeProject, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeProject> {
    const operation = project.status === "active" ? "project.restore" : "project.archive";
    return this.mutate(operation, context, () => {
      const previous = this.getKnowledgeProject(project.id);
      const result = this.database.prepare("UPDATE knowledge_projects SET name = ?, status = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?")
        .run(project.name, project.status, project.revision, project.updatedAt, project.id, expectedRevision);
      if (result.changes === 0) throw new KnowledgeError("revision_conflict", "Rewizja projektu wiedzy uległa zmianie.", this.getKnowledgeProject(project.id)?.revision);
      this.history(project.id, "project", project.id, project.status === "archived" ? "archived" : "updated", JSON.stringify(previous), project.revision, context, project.updatedAt);
      return project;
    });
  }

  setKnowledgeProjectRuntimeLink(link: KnowledgeProjectRuntimeLink, expectedRevision: number, context: KnowledgeMutationContext): KnowledgeMutationResult<KnowledgeRuntimeLinkResult> {
    return this.mutate("project.runtime_link", context, () => {
      const project = this.getKnowledgeProject(link.projectId);
      if (!project) throw new KnowledgeError("not_found", "Nie znaleziono projektu wiedzy.");
      const previous = this.database.prepare("SELECT runtime_project_id FROM knowledge_project_runtime_links WHERE knowledge_project_id = ?").get(link.projectId) as { runtime_project_id: string | null } | undefined;
      const revision = expectedRevision + 1;
      const updated = this.database.prepare("UPDATE knowledge_projects SET revision = ?, updated_at = ? WHERE id = ? AND revision = ?")
        .run(revision, link.linkedAt, link.projectId, expectedRevision);
      if (updated.changes === 0) throw new KnowledgeError("revision_conflict", "Rewizja projektu wiedzy uległa zmianie.", this.getKnowledgeProject(link.projectId)?.revision);
      this.database.prepare(`INSERT INTO knowledge_project_runtime_links(knowledge_project_id, runtime_project_id, linked_at, unlinked_at) VALUES (?, ?, ?, ?) ON CONFLICT(knowledge_project_id) DO UPDATE SET runtime_project_id = excluded.runtime_project_id, linked_at = excluded.linked_at, unlinked_at = excluded.unlinked_at`)
        .run(link.projectId, link.runtimeProjectId, link.linkedAt, link.unlinkedAt);
      this.history(link.projectId, "project", link.projectId, link.runtimeProjectId === null ? "unlinked" : "linked", previous ? JSON.stringify(previous) : null, revision, context, link.linkedAt);
      return { link, project: { ...project, revision, updatedAt: link.linkedAt } };
    });
  }

  private insertTask(task: KnowledgeTask): void {
    this.database.prepare("INSERT INTO knowledge_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(task.id, task.projectId, task.title, task.description, task.status, task.priority, task.revision, task.createdBy, task.createdAt, task.updatedAt);
  }

  private mutate<T>(operation: string, context: KnowledgeMutationContext, work: () => T): KnowledgeMutationResult<T> {
    return this.database.transaction(() => {
      const previous = this.findIdempotentResult<T>(operation, context);
      if (previous) return previous;
      const value = work();
      this.database.prepare(`INSERT INTO knowledge_idempotency(principal_id, project_id, operation, idempotency_key, request_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(context.actor.principalId, context.projectId, operation, context.idempotencyKey, context.requestHash, JSON.stringify(value), new Date().toISOString());
      return { value, replayed: false };
    }).immediate();
  }

  private page<T>(rows: T[], limit: number, offset: number): KnowledgePage<T> {
    return { items: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null };
  }

  private history(projectId: string, recordKind: KnowledgeHistoryEntry["recordKind"], recordId: string, operation: KnowledgeHistoryEntry["operation"], previousJson: string | null, revision: number, context: KnowledgeMutationContext, createdAt: string): void {
    this.database.prepare(`INSERT INTO knowledge_history(project_id, record_kind, record_id, operation, previous_json, principal_id, authentication_method, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, recordKind, recordId, operation, previousJson, context.actor.principalId, context.actor.authenticationMethod, revision, createdAt);
  }
}
