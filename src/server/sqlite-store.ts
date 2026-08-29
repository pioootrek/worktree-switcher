import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { Project, Reservation } from "@/shared/contracts";
import type { ProjectRegistration, ReservationRequest, StateStore } from "./state-store";

type ProjectRow = {
  id: string;
  name: string;
  repository_path: string;
  port: number;
  executable: string;
  args_json: string;
  healthcheck_path: string;
  startup_timeout_ms: number;
  selected_worktree_path: string | null;
  created_at: string;
  updated_at: string;
};

type ReservationRow = {
  id: string;
  project_id: string;
  worktree_path: string;
  kind: "human" | "agent";
  owner: string;
  reason: string | null;
  created_at: string;
  expires_at: string | null;
};

const schema = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL UNIQUE,
    port INTEGER NOT NULL UNIQUE CHECK(port BETWEEN 1 AND 65535),
    executable TEXT NOT NULL,
    args_json TEXT NOT NULL,
    healthcheck_path TEXT NOT NULL,
    startup_timeout_ms INTEGER NOT NULL,
    selected_worktree_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    worktree_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('human', 'agent')),
    owner TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    released_at TEXT,
    released_by TEXT,
    CHECK((kind = 'human' AND expires_at IS NULL) OR (kind = 'agent' AND expires_at IS NOT NULL))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS one_active_reservation_per_project
    ON reservations(project_id) WHERE released_at IS NULL;

  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  INSERT OR IGNORE INTO schema_migrations(version, applied_at)
    VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`;

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repositoryPath: row.repository_path,
    port: row.port,
    executable: row.executable,
    args: JSON.parse(row.args_json) as string[],
    healthcheckPath: row.healthcheck_path,
    startupTimeoutMs: row.startup_timeout_ms,
    selectedWorktreePath: row.selected_worktree_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    projectId: row.project_id,
    worktreePath: row.worktree_path,
    kind: row.kind,
    owner: row.owner,
    reason: row.reason,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class SqliteStateStore implements StateStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 3000");
    this.database.exec(schema);
    this.applyMigrations();
  }

  listProjects(): Project[] {
    const rows = this.database.prepare("SELECT * FROM projects ORDER BY name COLLATE NOCASE").all() as ProjectRow[];
    return rows.map(mapProject);
  }

  getProject(id: string): Project | null {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  addProject(input: ProjectRegistration): Project {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO projects (
          id, name, repository_path, port, executable, args_json,
          healthcheck_path, startup_timeout_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '/', 45000, ?, ?)
      `).run(id, input.name, input.repositoryPath, input.port, input.executable, JSON.stringify(input.args), now, now);
      this.audit(id, "project.created", "local-user", {
        repositoryPath: input.repositoryPath,
        port: input.port,
        executable: input.executable,
        args: input.args,
      });
    })();
    return this.getProject(id)!;
  }

  setSelectedWorktree(projectId: string, path: string): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const result = this.database.prepare(
        "UPDATE projects SET selected_worktree_path = ?, updated_at = ? WHERE id = ?",
      ).run(path, now, projectId);
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
      this.audit(projectId, "worktree.selected", "local-user", { path });
    })();
  }

  getActiveReservation(projectId: string): Reservation | null {
    this.expireReservations(projectId);
    const row = this.database.prepare(`
      SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at
      FROM reservations WHERE project_id = ? AND released_at IS NULL
    `).get(projectId) as ReservationRow | undefined;
    return row ? mapReservation(row) : null;
  }

  acquireReservation(input: ReservationRequest): Reservation {
    return this.database.transaction(() => {
      this.expireReservations(input.projectId);
      const active = this.getActiveReservation(input.projectId);
      if (active) throw new Error(`Projekt jest zablokowany przez ${active.owner}.`);
      if (input.kind === "agent" && (!input.ttlSeconds || input.ttlSeconds < 30)) {
        throw new Error("Dzierżawa agenta musi trwać co najmniej 30 sekund.");
      }
      const createdAt = new Date().toISOString();
      const expiresAt = input.kind === "agent"
        ? new Date(Date.now() + input.ttlSeconds! * 1000).toISOString()
        : null;
      const reservation: Reservation = {
        id: randomUUID(),
        projectId: input.projectId,
        worktreePath: input.worktreePath,
        kind: input.kind,
        owner: input.owner,
        reason: input.reason ?? null,
        createdAt,
        expiresAt,
      };
      this.database.prepare(`
        INSERT INTO reservations (id, project_id, worktree_path, kind, owner, reason, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reservation.id,
        reservation.projectId,
        reservation.worktreePath,
        reservation.kind,
        reservation.owner,
        reservation.reason,
        reservation.createdAt,
        reservation.expiresAt,
      );
      this.audit(input.projectId, "reservation.acquired", input.owner, reservation);
      return reservation;
    })();
  }

  releaseReservation(projectId: string, owner: string, force = false): void {
    this.database.transaction(() => {
      this.expireReservations(projectId);
      const active = this.getActiveReservation(projectId);
      if (!active) return;
      if (!force && active.owner !== owner) throw new Error("Tylko właściciel może zdjąć tę blokadę.");
      this.database.prepare(`
        UPDATE reservations SET released_at = ?, released_by = ? WHERE id = ?
      `).run(new Date().toISOString(), owner, active.id);
      this.audit(projectId, force ? "reservation.force_released" : "reservation.released", owner, { id: active.id });
    })();
  }

  close(): void {
    this.database.close();
  }

  private applyMigrations(): void {
    const version = 2;
    const applied = this.database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version);
    if (applied) return;
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE projects SET args_json = '["run","dev"]', updated_at = ?
        WHERE executable = 'pnpm' AND args_json LIKE '["dev","--","--port",%'
      `).run(new Date().toISOString());
      this.database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(version, new Date().toISOString());
    })();
  }

  private expireReservations(projectId: string): void {
    this.database.prepare(`
      UPDATE reservations SET released_at = ?, released_by = 'system:expiry'
      WHERE project_id = ? AND released_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
    `).run(new Date().toISOString(), projectId, new Date().toISOString());
  }

  private audit(projectId: string, eventType: string, actor: string, details: unknown): void {
    this.database.prepare(`
      INSERT INTO audit_events(project_id, event_type, actor, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, eventType, actor, JSON.stringify(details), new Date().toISOString());
  }
}
