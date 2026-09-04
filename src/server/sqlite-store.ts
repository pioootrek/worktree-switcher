import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { LaunchPreset, Project, Reservation, ServerCapacitySettings, TestEnvironmentMode, TestEnvironmentProfile, TestQueueSettings, TestRun, TestRunPhase, WorktreeStorageHistoryPoint, WorktreeStorageSnapshot } from "@/shared/contracts";
import type { PendingTestRun, ProjectRegistration, ReservationRequest, StateStore, WorktreeStorageSample } from "./state-store";

type ProjectRow = {
  id: string;
  name: string;
  repository_path: string;
  port: number;
  launch_preset: LaunchPreset;
  tls_mode: "off" | "generated" | "custom";
  tls_key_path: string | null;
  tls_cert_path: string | null;
  tls_ca_path: string | null;
  executable: string;
  args_json: string;
  environment_json: string;
  environment_profiles_json: string;
  selected_environment_profile: string;
  test_environment_profiles_json: string;
  test_preset_profiles_json: string;
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
  maximum_expires_at: string | null;
  token_hash: string | null;
  idempotency_key: string | null;
  released_at?: string | null;
};

type StorageRow = {
  project_id: string;
  worktree_path: string;
  total_bytes: number;
  next_bytes: number;
  next_cache_bytes: number;
  node_modules_bytes: number;
  top_directories_json: string;
  measured_at: string;
};

type TestRunRow = {
  id: string;
  project_id: string;
  worktree_path: string;
  worktree_head: string;
  worktree_branch: string | null;
  worktree_dirty: number;
  preset_id: string;
  preset_name: string;
  adapter: "node" | "django";
  actor: string;
  phase: TestRunPhase;
  queue_position: number | null;
  executable: string;
  args_json: string;
  cwd: string;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  signal: string | null;
  error: string | null;
  logs_json: string;
  idempotency_key: string | null;
  environment_mode: TestEnvironmentMode;
  environment_profile: string;
  inherited_server_profile: string | null;
  environment_variable_names_json: string;
};

/** Built-in test profiles every project starts with; see `test-environment.ts`. */
const DEFAULT_TEST_PROFILES_JSON = JSON.stringify([
  { name: "unit", policy: { mode: "clean", serverProfile: null }, environment: {}, nodeEnv: "test", requiredVariables: [] },
  { name: "tooling", policy: { mode: "clean", serverProfile: null }, environment: {}, nodeEnv: null, requiredVariables: [] },
]);

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
    launch_preset TEXT NOT NULL DEFAULT 'node' CHECK(launch_preset IN ('auto', 'node', 'django')),
    tls_mode TEXT NOT NULL DEFAULT 'off' CHECK(tls_mode IN ('off', 'generated', 'custom')),
    tls_key_path TEXT,
    tls_cert_path TEXT,
    tls_ca_path TEXT,
    executable TEXT NOT NULL,
    args_json TEXT NOT NULL,
    environment_json TEXT NOT NULL DEFAULT '{}',
    environment_profiles_json TEXT NOT NULL DEFAULT '[{"name":"default","environment":{}}]',
    selected_environment_profile TEXT NOT NULL DEFAULT 'default',
    test_environment_profiles_json TEXT NOT NULL DEFAULT '${DEFAULT_TEST_PROFILES_JSON}',
    test_preset_profiles_json TEXT NOT NULL DEFAULT '{}',
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
    maximum_expires_at TEXT,
    token_hash TEXT,
    idempotency_key TEXT,
    released_at TEXT,
    released_by TEXT,
    CHECK(
      (kind = 'human' AND expires_at IS NULL AND maximum_expires_at IS NULL AND token_hash IS NULL)
      OR
      (kind = 'agent' AND expires_at IS NOT NULL AND maximum_expires_at IS NOT NULL AND token_hash IS NOT NULL AND idempotency_key IS NOT NULL)
    )
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

  CREATE TABLE IF NOT EXISTS controller_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS controller_audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    worktree_path TEXT NOT NULL,
    worktree_head TEXT NOT NULL,
    worktree_branch TEXT,
    worktree_dirty INTEGER NOT NULL CHECK(worktree_dirty IN (0, 1)),
    preset_id TEXT NOT NULL,
    preset_name TEXT NOT NULL,
    adapter TEXT NOT NULL CHECK(adapter IN ('node', 'django')),
    actor TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('queued', 'running', 'passed', 'failed', 'cancelled', 'timed_out', 'interrupted')),
    queue_position INTEGER,
    executable TEXT NOT NULL,
    args_json TEXT NOT NULL,
    cwd TEXT NOT NULL,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    exit_code INTEGER,
    signal TEXT,
    error TEXT,
    logs_json TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT,
    environment_mode TEXT NOT NULL DEFAULT 'clean' CHECK(environment_mode IN ('clean', 'inherit-server-profile')),
    environment_profile TEXT NOT NULL DEFAULT 'unit',
    inherited_server_profile TEXT,
    environment_variable_names_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS test_runs_project_history ON test_runs(project_id, queued_at DESC);
  CREATE INDEX IF NOT EXISTS test_runs_phase_queue ON test_runs(phase, queued_at, id);
  CREATE UNIQUE INDEX IF NOT EXISTS test_runs_actor_idempotency
    ON test_runs(actor, idempotency_key) WHERE idempotency_key IS NOT NULL;

  INSERT OR IGNORE INTO schema_migrations(version, applied_at)
    VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`;

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    repositoryPath: row.repository_path,
    port: row.port,
    launchPreset: row.launch_preset,
    tlsMode: row.tls_mode,
    tlsKeyPath: row.tls_key_path,
    tlsCertPath: row.tls_cert_path,
    tlsCaPath: row.tls_ca_path,
    executable: row.executable,
    args: JSON.parse(row.args_json) as string[],
    environment: JSON.parse(row.environment_json) as Record<string, string>,
    environmentProfiles: JSON.parse(row.environment_profiles_json) as Project["environmentProfiles"],
    selectedEnvironmentProfile: row.selected_environment_profile,
    testEnvironmentProfiles: JSON.parse(row.test_environment_profiles_json) as Project["testEnvironmentProfiles"],
    testPresetProfiles: JSON.parse(row.test_preset_profiles_json) as Project["testPresetProfiles"],
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
    maximumExpiresAt: row.maximum_expires_at,
  };
}

function mapTestRun(row: TestRunRow): TestRun {
  return {
    id: row.id,
    projectId: row.project_id,
    worktreePath: row.worktree_path,
    worktreeHead: row.worktree_head,
    worktreeBranch: row.worktree_branch,
    worktreeDirty: row.worktree_dirty === 1,
    presetId: row.preset_id,
    presetName: row.preset_name,
    adapter: row.adapter,
    actor: row.actor,
    phase: row.phase,
    queuePosition: row.queue_position,
    executable: row.executable,
    args: JSON.parse(row.args_json) as string[],
    cwd: row.cwd,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    signal: row.signal,
    error: row.error,
    logs: JSON.parse(row.logs_json) as string[],
    environmentMode: row.environment_mode,
    environmentProfile: row.environment_profile,
    inheritedServerProfile: row.inherited_server_profile,
    environmentVariableNames: JSON.parse(row.environment_variable_names_json) as string[],
  };
}

function equalHash(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
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
          id, name, repository_path, port, launch_preset, executable, args_json,
          healthcheck_path, startup_timeout_ms, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '/', 45000, ?, ?)
      `).run(id, input.name, input.repositoryPath, input.port, input.launchPreset ?? "auto", input.executable, JSON.stringify(input.args), now, now);
      this.audit(id, "project.created", "local-user", {
        repositoryPath: input.repositoryPath,
        port: input.port,
        launchPreset: input.launchPreset ?? "auto",
        executable: input.executable,
        args: input.args,
      });
    })();
    return this.getProject(id)!;
  }

  removeProject(projectId: string, actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO controller_audit_events(event_type, actor, details_json, created_at)
        VALUES ('project.removed', ?, ?, ?)
      `).run(actor, JSON.stringify({
        projectId: project.id,
        name: project.name,
        repositoryPath: project.repositoryPath,
        port: project.port,
      }), now);
      const result = this.database.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
    })();
  }

  updateProjectLaunch(projectId: string, input: {
    tlsMode: "off" | "generated" | "custom";
    tlsKeyPath: string | null;
    tlsCertPath: string | null;
    tlsCaPath: string | null;
    executable: string;
    args: string[];
  }): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE projects SET
          tls_mode = ?, tls_key_path = ?, tls_cert_path = ?, tls_ca_path = ?,
          executable = ?, args_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.tlsMode,
        input.tlsKeyPath,
        input.tlsCertPath,
        input.tlsCaPath,
        input.executable,
        JSON.stringify(input.args),
        now,
        projectId,
      );
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
      this.audit(projectId, "project.launch_updated", "local-user", input);
    })();
  }

  updateProjectEnvironment(projectId: string, environment: Record<string, string>, actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    this.saveProjectEnvironmentProfile(projectId, { name: project.selectedEnvironmentProfile, environment }, actor);
  }

  saveProjectEnvironmentProfile(projectId: string, profile: Project["environmentProfiles"][number], actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    const profiles = [...project.environmentProfiles.filter(({ name }) => name !== profile.name), profile]
      .sort((left, right) => left.name.localeCompare(right.name));
    const environment = project.selectedEnvironmentProfile === profile.name ? profile.environment : project.environment;
    this.persistEnvironmentProfiles(projectId, profiles, project.selectedEnvironmentProfile, environment, actor, "project.environment_profile_saved", profile.name, Object.keys(profile.environment));
  }

  deleteProjectEnvironmentProfile(projectId: string, profileName: string, actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    const profiles = project.environmentProfiles.filter(({ name }) => name !== profileName);
    this.persistEnvironmentProfiles(projectId, profiles, project.selectedEnvironmentProfile, project.environment, actor, "project.environment_profile_deleted", profileName, []);
  }

  selectProjectEnvironmentProfile(projectId: string, profileName: string, actor: string): void {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    const profile = project.environmentProfiles.find(({ name }) => name === profileName);
    if (!profile) throw new Error("Nie znaleziono profilu środowiska.");
    this.persistEnvironmentProfiles(projectId, project.environmentProfiles, profileName, profile.environment, actor, "project.environment_profile_selected", profileName, Object.keys(profile.environment));
  }

  saveProjectTestEnvironmentProfile(projectId: string, profile: TestEnvironmentProfile, actor: string): void {
    const project = this.requireProjectRow(projectId);
    const profiles = [...project.testEnvironmentProfiles.filter(({ name }) => name !== profile.name), profile]
      .sort((left, right) => left.name.localeCompare(right.name));
    this.persistTestEnvironment(projectId, profiles, project.testPresetProfiles, actor, "project.test_profile_saved", {
      profileName: profile.name,
      mode: profile.policy.mode,
      serverProfile: profile.policy.serverProfile,
      nodeEnv: profile.nodeEnv,
      variableNames: Object.keys(profile.environment).sort(),
    });
  }

  deleteProjectTestEnvironmentProfile(projectId: string, profileName: string, actor: string): void {
    const project = this.requireProjectRow(projectId);
    const profiles = project.testEnvironmentProfiles.filter(({ name }) => name !== profileName);
    this.persistTestEnvironment(projectId, profiles, project.testPresetProfiles, actor, "project.test_profile_deleted", { profileName });
  }

  assignProjectTestPresetProfile(projectId: string, presetId: string, profileName: string | null, actor: string): void {
    const project = this.requireProjectRow(projectId);
    const assignments = { ...project.testPresetProfiles };
    if (profileName) assignments[presetId] = profileName;
    else delete assignments[presetId];
    this.persistTestEnvironment(projectId, project.testEnvironmentProfiles, assignments, actor, "project.test_preset_profile_assigned", { presetId, profileName });
  }

  private persistTestEnvironment(
    projectId: string,
    profiles: TestEnvironmentProfile[],
    presetProfiles: Record<string, string>,
    actor: string,
    eventType: string,
    details: Record<string, unknown>,
  ): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE projects SET test_environment_profiles_json = ?, test_preset_profiles_json = ?, updated_at = ?
        WHERE id = ?
      `).run(JSON.stringify(profiles), JSON.stringify(presetProfiles), now, projectId);
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
      this.audit(projectId, eventType, actor, details);
    })();
  }

  private requireProjectRow(projectId: string): Project {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Nie znaleziono projektu.");
    return project;
  }

  private persistEnvironmentProfiles(
    projectId: string,
    profiles: Project["environmentProfiles"],
    selectedProfile: string,
    environment: Record<string, string>,
    actor: string,
    eventType: string,
    profileName: string,
    variableNames: string[],
  ): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE projects SET environment_profiles_json = ?, selected_environment_profile = ?,
          environment_json = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(profiles), selectedProfile, JSON.stringify(environment), now, projectId);
      if (result.changes === 0) throw new Error("Nie znaleziono projektu.");
      this.audit(projectId, eventType, actor, { profileName, variableNames: variableNames.sort() });
    })();
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

  getServerCapacitySettings(): ServerCapacitySettings {
    const row = this.database.prepare("SELECT value_json FROM controller_settings WHERE key = 'server_capacity'")
      .get() as { value_json: string } | undefined;
    if (!row) return { enabled: false, limit: 2 };
    const value = JSON.parse(row.value_json) as Partial<ServerCapacitySettings>;
    return {
      enabled: value.enabled === true,
      limit: Number.isInteger(value.limit) && value.limit! >= 1 && value.limit! <= 64 ? value.limit! : 2,
    };
  }

  setServerCapacitySettings(settings: ServerCapacitySettings): void {
    this.database.transaction(() => {
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO controller_settings(key, value_json, updated_at)
        VALUES ('server_capacity', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(settings), now);
      this.database.prepare(`
        INSERT INTO controller_audit_events(event_type, actor, details_json, created_at)
        VALUES ('server_capacity.updated', 'local-user', ?, ?)
      `).run(JSON.stringify(settings), now);
    })();
  }

  getTestQueueSettings(): TestQueueSettings {
    const row = this.database.prepare("SELECT value_json FROM controller_settings WHERE key = 'test_queue'")
      .get() as { value_json: string } | undefined;
    if (!row) return { limit: 1 };
    const value = JSON.parse(row.value_json) as Partial<TestQueueSettings>;
    return { limit: Number.isInteger(value.limit) && value.limit! >= 1 && value.limit! <= 16 ? value.limit! : 1 };
  }

  setTestQueueSettings(settings: TestQueueSettings): void {
    this.database.transaction(() => {
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO controller_settings(key, value_json, updated_at)
        VALUES ('test_queue', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(settings), now);
      this.database.prepare(`
        INSERT INTO controller_audit_events(event_type, actor, details_json, created_at)
        VALUES ('test_queue.updated', 'local-user', ?, ?)
      `).run(JSON.stringify(settings), now);
    })();
  }

  countTestRuns(phases: TestRunPhase[], projectId?: string, worktreePath?: string): number {
    if (phases.length === 0) return 0;
    const conditions = [`phase IN (${phases.map(() => "?").join(", ")})`];
    const parameters: string[] = [...phases];
    if (projectId) {
      conditions.push("project_id = ?");
      parameters.push(projectId);
    }
    if (worktreePath) {
      conditions.push("worktree_path = ?");
      parameters.push(worktreePath);
    }
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM test_runs WHERE ${conditions.join(" AND ")}`)
      .get(...parameters) as { count: number };
    return row.count;
  }

  listPendingTestRuns(): PendingTestRun[] {
    return this.database.prepare(`
      SELECT id, project_id AS projectId, worktree_path AS worktreePath, phase,
             queue_position AS queuePosition, queued_at AS queuedAt
      FROM test_runs
      WHERE phase IN ('queued', 'running')
      ORDER BY queued_at ASC, id ASC
    `).all() as PendingTestRun[];
  }

  listTestRuns(projectId?: string, limit = 50): TestRun[] {
    const boundedLimit = Math.max(1, Math.min(500, limit));
    const rows = projectId
      ? this.database.prepare("SELECT * FROM test_runs WHERE project_id = ? ORDER BY CASE WHEN phase IN ('queued', 'running') THEN 0 ELSE 1 END, queued_at DESC, id DESC LIMIT ?").all(projectId, boundedLimit)
      : this.database.prepare("SELECT * FROM test_runs ORDER BY CASE WHEN phase IN ('queued', 'running') THEN 0 ELSE 1 END, queued_at DESC, id DESC LIMIT ?").all(boundedLimit);
    return (rows as TestRunRow[]).map(mapTestRun);
  }

  getTestRun(id: string): TestRun | null {
    const row = this.database.prepare("SELECT * FROM test_runs WHERE id = ?").get(id) as TestRunRow | undefined;
    return row ? mapTestRun(row) : null;
  }

  findTestRunByIdempotency(actor: string, idempotencyKey: string): TestRun | null {
    const row = this.database.prepare("SELECT * FROM test_runs WHERE actor = ? AND idempotency_key = ?")
      .get(actor, idempotencyKey) as TestRunRow | undefined;
    return row ? mapTestRun(row) : null;
  }

  saveTestRun(run: TestRun, idempotencyKey?: string): void {
    this.database.prepare(`
      INSERT INTO test_runs (
        id, project_id, worktree_path, worktree_head, worktree_branch, worktree_dirty,
        preset_id, preset_name, adapter, actor, phase, queue_position, executable,
        args_json, cwd, queued_at, started_at, finished_at, exit_code, signal, error,
        logs_json, idempotency_key, environment_mode, environment_profile,
        inherited_server_profile, environment_variable_names_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        phase = excluded.phase, queue_position = excluded.queue_position,
        started_at = excluded.started_at, finished_at = excluded.finished_at,
        exit_code = excluded.exit_code, signal = excluded.signal, error = excluded.error,
        logs_json = excluded.logs_json
    `).run(
      run.id, run.projectId, run.worktreePath, run.worktreeHead, run.worktreeBranch,
      run.worktreeDirty ? 1 : 0, run.presetId, run.presetName, run.adapter, run.actor,
      run.phase, run.queuePosition, run.executable, JSON.stringify(run.args), run.cwd, run.queuedAt,
      run.startedAt, run.finishedAt, run.exitCode, run.signal, run.error,
      JSON.stringify(run.logs), idempotencyKey ?? null, run.environmentMode, run.environmentProfile,
      run.inheritedServerProfile, JSON.stringify(run.environmentVariableNames),
    );
    if (["passed", "failed", "cancelled", "timed_out", "interrupted"].includes(run.phase)) {
      this.database.prepare(`
        DELETE FROM test_runs WHERE id IN (
          SELECT id FROM test_runs WHERE project_id = ? AND phase NOT IN ('queued', 'running')
          ORDER BY queued_at DESC, id DESC LIMIT -1 OFFSET 50
        )
      `).run(run.projectId);
    }
  }

  markInterruptedTestRuns(): void {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE test_runs SET phase = 'interrupted', finished_at = ?, queue_position = NULL,
        error = 'Kontroler został zatrzymany przed zakończeniem testu.'
      WHERE phase IN ('queued', 'running')
    `).run(now);
  }

  getWorktreeStorage(projectId: string, worktreePath: string): WorktreeStorageSnapshot | null {
    const rows = this.database.prepare(`
      SELECT project_id, worktree_path, total_bytes, next_bytes, next_cache_bytes,
             node_modules_bytes, top_directories_json, measured_at
      FROM worktree_storage_samples
      WHERE project_id = ? AND worktree_path = ?
      ORDER BY measured_at ASC, id ASC
    `).all(projectId, worktreePath) as StorageRow[];
    const latest = rows.at(-1);
    if (!latest) return null;
    const history: WorktreeStorageHistoryPoint[] = rows.map((row) => ({
      measuredAt: row.measured_at,
      totalBytes: row.total_bytes,
      nextBytes: row.next_bytes,
      nextCacheBytes: row.next_cache_bytes,
      nodeModulesBytes: row.node_modules_bytes,
    }));
    return {
      worktreePath,
      status: "available",
      totalBytes: latest.total_bytes,
      nextBytes: latest.next_bytes,
      nextCacheBytes: latest.next_cache_bytes,
      nodeModulesBytes: latest.node_modules_bytes,
      otherBytes: Math.max(0, latest.total_bytes - latest.next_bytes - latest.node_modules_bytes),
      measuredAt: latest.measured_at,
      topDirectories: JSON.parse(latest.top_directories_json) as Array<{ name: string; bytes: number }>,
      history,
      error: null,
    };
  }

  saveWorktreeStorage(sample: WorktreeStorageSample): void {
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO worktree_storage_samples(
          project_id, worktree_path, total_bytes, next_bytes, next_cache_bytes,
          node_modules_bytes, top_directories_json, measured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sample.projectId,
        sample.worktreePath,
        sample.totalBytes,
        sample.nextBytes,
        sample.nextCacheBytes,
        sample.nodeModulesBytes,
        JSON.stringify(sample.topDirectories),
        sample.measuredAt,
      );
      const rows = this.database.prepare(`
        SELECT id FROM worktree_storage_samples
        WHERE project_id = ? AND worktree_path = ?
        ORDER BY measured_at ASC, id ASC
      `).all(sample.projectId, sample.worktreePath) as Array<{ id: number }>;
      const obsolete = rows.length > 180 ? rows.slice(1, rows.length - 179) : [];
      const remove = this.database.prepare("DELETE FROM worktree_storage_samples WHERE id = ?");
      for (const row of obsolete) remove.run(row.id);
    })();
  }

  recordProjectEvent(projectId: string, eventType: string, actor: string, details: unknown): void {
    this.audit(projectId, eventType, actor, details);
  }

  getActiveReservation(projectId: string): Reservation | null {
    this.expireReservations(projectId);
    const row = this.database.prepare(`
      SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
             maximum_expires_at, token_hash, idempotency_key, released_at
      FROM reservations WHERE project_id = ? AND released_at IS NULL
    `).get(projectId) as ReservationRow | undefined;
    return row ? mapReservation(row) : null;
  }

  acquireReservation(input: ReservationRequest): Reservation {
    return this.database.transaction(() => {
      this.expireReservations(input.projectId);
      if (input.kind === "agent") {
        if (!input.ttlSeconds || input.ttlSeconds < 30) {
          throw new Error("Dzierżawa agenta musi trwać co najmniej 30 sekund.");
        }
        if (!input.maximumLifetimeSeconds || input.maximumLifetimeSeconds < input.ttlSeconds) {
          throw new Error("Maksymalny czas dzierżawy nie może być krótszy od jej czasu początkowego.");
        }
        if (!input.leaseTokenHash || !input.idempotencyKey) {
          throw new Error("Dzierżawa agenta wymaga tokenu i klucza idempotencji.");
        }
        const repeated = this.database.prepare(`
          SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
                 maximum_expires_at, token_hash, idempotency_key, released_at
          FROM reservations
          WHERE owner = ? AND idempotency_key = ? AND kind = 'agent' AND released_at IS NULL
        `).get(input.owner, input.idempotencyKey) as ReservationRow | undefined;
        if (repeated) {
          if (
            repeated.project_id !== input.projectId
            || repeated.worktree_path !== input.worktreePath
            || !equalHash(repeated.token_hash, input.leaseTokenHash)
          ) {
            throw new Error("Klucz idempotencji jest już używany przez inną dzierżawę.");
          }
          return mapReservation(repeated);
        }
      }
      const active = this.getActiveReservation(input.projectId);
      if (active) throw new Error(`Projekt jest zablokowany przez ${active.owner}.`);
      const createdAt = new Date().toISOString();
      const expiresAt = input.kind === "agent"
        ? new Date(Date.now() + input.ttlSeconds! * 1000).toISOString()
        : null;
      const maximumExpiresAt = input.kind === "agent"
        ? new Date(Date.now() + input.maximumLifetimeSeconds! * 1000).toISOString()
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
        maximumExpiresAt,
      };
      this.database.prepare(`
        INSERT INTO reservations (
          id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
          maximum_expires_at, token_hash, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        reservation.id,
        reservation.projectId,
        reservation.worktreePath,
        reservation.kind,
        reservation.owner,
        reservation.reason,
        reservation.createdAt,
        reservation.expiresAt,
        reservation.maximumExpiresAt,
        input.leaseTokenHash ?? null,
        input.idempotencyKey ?? null,
      );
      this.audit(input.projectId, "reservation.acquired", input.owner, reservation);
      return reservation;
    })();
  }

  authorizeReservation(projectId: string, owner: string, leaseTokenHash?: string): Reservation | null {
    const reservation = this.getActiveReservation(projectId);
    if (!reservation) return null;
    const row = this.activeReservationRow(projectId)!;
    if (reservation.owner !== owner) throw new Error(`Projekt jest zablokowany przez ${reservation.owner}.`);
    if (reservation.kind === "agent" && (!leaseTokenHash || !equalHash(row.token_hash, leaseTokenHash))) {
      throw new Error("Nieprawidłowy token dzierżawy agenta.");
    }
    return reservation;
  }

  renewAgentReservation(
    projectId: string,
    reservationId: string,
    owner: string,
    leaseTokenHash: string,
    ttlSeconds: number,
  ): Reservation {
    return this.database.transaction(() => {
      if (ttlSeconds < 30) throw new Error("Dzierżawa agenta musi trwać co najmniej 30 sekund.");
      this.expireReservations(projectId);
      const row = this.activeReservationRow(projectId);
      if (!row || row.id !== reservationId) throw new Error("Dzierżawa agenta wygasła lub nie istnieje.");
      if (row.kind !== "agent" || row.owner !== owner || !equalHash(row.token_hash, leaseTokenHash)) {
        throw new Error("Nieprawidłowy token dzierżawy agenta.");
      }
      const maximum = new Date(row.maximum_expires_at!).getTime();
      const expiresAt = new Date(Math.min(Date.now() + ttlSeconds * 1000, maximum)).toISOString();
      if (new Date(expiresAt).getTime() <= Date.now()) throw new Error("Dzierżawa agenta osiągnęła maksymalny czas życia.");
      this.database.prepare("UPDATE reservations SET expires_at = ? WHERE id = ?").run(expiresAt, row.id);
      this.audit(projectId, "reservation.renewed", owner, { id: row.id, expiresAt });
      return { ...mapReservation(row), expiresAt };
    })();
  }

  releaseAgentReservation(projectId: string, reservationId: string, owner: string, leaseTokenHash: string): void {
    this.database.transaction(() => {
      this.expireReservations(projectId);
      const row = this.activeReservationRow(projectId);
      if (!row || row.id !== reservationId) return;
      if (row.kind !== "agent" || row.owner !== owner || !equalHash(row.token_hash, leaseTokenHash)) {
        throw new Error("Nieprawidłowy token dzierżawy agenta.");
      }
      this.releaseRow(row, owner, false);
    })();
  }

  releaseReservation(projectId: string, owner: string, force = false): void {
    this.database.transaction(() => {
      this.expireReservations(projectId);
      const active = this.getActiveReservation(projectId);
      if (!active) return;
      if (!force && active.kind === "agent") throw new Error("Dzierżawę agenta może zdjąć tylko jej właściciel lub człowiek przez force release.");
      if (!force && active.owner !== owner) throw new Error("Tylko właściciel może zdjąć tę blokadę.");
      const row = this.activeReservationRow(projectId)!;
      this.releaseRow(row, owner, force);
    })();
  }

  close(): void {
    this.database.close();
  }

  private applyMigrations(): void {
    if (!this.hasMigration(2)) {
      this.database.transaction(() => {
        this.database.prepare(`
          UPDATE projects SET args_json = '["run","dev"]', updated_at = ?
          WHERE executable = 'pnpm' AND args_json LIKE '["dev","--","--port",%'
        `).run(new Date().toISOString());
        this.recordMigration(2);
      })();
    }
    if (!this.hasMigration(3)) {
      this.database.transaction(() => {
        const columns = this.database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
        const names = new Set(columns.map(({ name }) => name));
        if (!names.has("tls_mode")) this.database.exec("ALTER TABLE projects ADD COLUMN tls_mode TEXT NOT NULL DEFAULT 'off' CHECK(tls_mode IN ('off', 'generated', 'custom'))");
        if (!names.has("tls_key_path")) this.database.exec("ALTER TABLE projects ADD COLUMN tls_key_path TEXT");
        if (!names.has("tls_cert_path")) this.database.exec("ALTER TABLE projects ADD COLUMN tls_cert_path TEXT");
        if (!names.has("tls_ca_path")) this.database.exec("ALTER TABLE projects ADD COLUMN tls_ca_path TEXT");
        this.recordMigration(3);
      })();
    }
    if (!this.hasMigration(4)) {
      this.database.transaction(() => {
        const columns = this.database.prepare("PRAGMA table_info(reservations)").all() as Array<{ name: string }>;
        const names = new Set(columns.map(({ name }) => name));
        if (!names.has("maximum_expires_at")) this.database.exec("ALTER TABLE reservations ADD COLUMN maximum_expires_at TEXT");
        if (!names.has("token_hash")) this.database.exec("ALTER TABLE reservations ADD COLUMN token_hash TEXT");
        if (!names.has("idempotency_key")) this.database.exec("ALTER TABLE reservations ADD COLUMN idempotency_key TEXT");
        this.database.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS active_agent_idempotency_key
          ON reservations(owner, idempotency_key)
          WHERE kind = 'agent' AND released_at IS NULL AND idempotency_key IS NOT NULL
        `);
        this.recordMigration(4);
      })();
    }
    if (!this.hasMigration(5)) {
      this.database.transaction(() => {
        this.database.prepare(`
          INSERT OR IGNORE INTO controller_settings(key, value_json, updated_at)
          VALUES ('server_capacity', ?, ?)
        `).run(JSON.stringify({ enabled: false, limit: 2 }), new Date().toISOString());
        this.recordMigration(5);
      })();
    }
    if (!this.hasMigration(6)) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS worktree_storage_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            worktree_path TEXT NOT NULL,
            total_bytes INTEGER NOT NULL,
            next_bytes INTEGER NOT NULL,
            next_cache_bytes INTEGER NOT NULL,
            node_modules_bytes INTEGER NOT NULL,
            top_directories_json TEXT NOT NULL,
            measured_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS worktree_storage_history
            ON worktree_storage_samples(project_id, worktree_path, measured_at);
        `);
        this.recordMigration(6);
      })();
    }
    if (!this.hasMigration(7)) {
      this.database.transaction(() => {
        const columns = this.database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "launch_preset")) {
          this.database.exec("ALTER TABLE projects ADD COLUMN launch_preset TEXT NOT NULL DEFAULT 'node' CHECK(launch_preset IN ('auto', 'node', 'django'))");
        }
        this.recordMigration(7);
      })();
    }
    if (!this.hasMigration(8)) {
      this.database.transaction(() => {
        const columns = this.database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
        if (!columns.some(({ name }) => name === "environment_json")) {
          this.database.exec("ALTER TABLE projects ADD COLUMN environment_json TEXT NOT NULL DEFAULT '{}'");
        }
        this.recordMigration(8);
      })();
    }
    if (!this.hasMigration(9)) {
      this.database.transaction(() => {
        const columns = this.database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
        const names = new Set(columns.map(({ name }) => name));
        const addedProfilesColumn = !names.has("environment_profiles_json");
        if (addedProfilesColumn) {
          this.database.exec(`ALTER TABLE projects ADD COLUMN environment_profiles_json TEXT NOT NULL DEFAULT '[{"name":"default","environment":{}}]'`);
        }
        if (!names.has("selected_environment_profile")) {
          this.database.exec("ALTER TABLE projects ADD COLUMN selected_environment_profile TEXT NOT NULL DEFAULT 'default'");
        }
        if (addedProfilesColumn) {
          this.database.prepare(`
            UPDATE projects SET environment_profiles_json = json_array(json_object('name', 'default', 'environment', json(environment_json)))
          `).run();
        }
        this.recordMigration(9);
      })();
    }
    if (!this.hasMigration(10)) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS test_runs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            worktree_path TEXT NOT NULL,
            worktree_head TEXT NOT NULL,
            worktree_branch TEXT,
            worktree_dirty INTEGER NOT NULL CHECK(worktree_dirty IN (0, 1)),
            preset_id TEXT NOT NULL,
            preset_name TEXT NOT NULL,
            adapter TEXT NOT NULL CHECK(adapter IN ('node', 'django')),
            actor TEXT NOT NULL,
            phase TEXT NOT NULL CHECK(phase IN ('queued', 'running', 'passed', 'failed', 'cancelled', 'timed_out', 'interrupted')),
            queue_position INTEGER,
            executable TEXT NOT NULL,
            args_json TEXT NOT NULL,
            cwd TEXT NOT NULL,
            queued_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            exit_code INTEGER,
            signal TEXT,
            error TEXT,
            logs_json TEXT NOT NULL DEFAULT '[]',
            idempotency_key TEXT
          );
          CREATE INDEX IF NOT EXISTS test_runs_project_history ON test_runs(project_id, queued_at DESC);
          CREATE INDEX IF NOT EXISTS test_runs_phase_queue ON test_runs(phase, queued_at, id);
          CREATE UNIQUE INDEX IF NOT EXISTS test_runs_actor_idempotency
            ON test_runs(actor, idempotency_key) WHERE idempotency_key IS NOT NULL;
        `);
        this.database.prepare(`
          INSERT OR IGNORE INTO controller_settings(key, value_json, updated_at)
          VALUES ('test_queue', ?, ?)
        `).run(JSON.stringify({ limit: 1 }), new Date().toISOString());
        this.recordMigration(10);
      })();
    }
    if (!this.hasMigration(11)) {
      this.database.transaction(() => {
        const projectColumns = new Set((this.database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map(({ name }) => name));
        if (!projectColumns.has("test_environment_profiles_json")) {
          this.database.exec(`ALTER TABLE projects ADD COLUMN test_environment_profiles_json TEXT NOT NULL DEFAULT '${DEFAULT_TEST_PROFILES_JSON}'`);
        }
        if (!projectColumns.has("test_preset_profiles_json")) {
          this.database.exec("ALTER TABLE projects ADD COLUMN test_preset_profiles_json TEXT NOT NULL DEFAULT '{}'");
        }
        const runColumns = new Set((this.database.prepare("PRAGMA table_info(test_runs)").all() as Array<{ name: string }>).map(({ name }) => name));
        if (!runColumns.has("environment_mode")) {
          // Historical runs predate the policy, so they are recorded as the inheriting behaviour they actually had.
          this.database.exec("ALTER TABLE test_runs ADD COLUMN environment_mode TEXT NOT NULL DEFAULT 'inherit-server-profile'");
          this.database.exec("ALTER TABLE test_runs ADD COLUMN environment_profile TEXT NOT NULL DEFAULT 'legacy'");
          this.database.exec("ALTER TABLE test_runs ADD COLUMN inherited_server_profile TEXT");
          this.database.exec("ALTER TABLE test_runs ADD COLUMN environment_variable_names_json TEXT NOT NULL DEFAULT '[]'");
        }
        this.recordMigration(11);
      })();
    }
  }

  private hasMigration(version: number): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version));
  }

  private recordMigration(version: number): void {
    this.database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(version, new Date().toISOString());
  }

  private expireReservations(projectId: string): void {
    this.database.transaction(() => {
      const now = new Date().toISOString();
      const expired = this.database.prepare(`
        SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
               maximum_expires_at, token_hash, idempotency_key, released_at
        FROM reservations
        WHERE project_id = ? AND released_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
      `).all(projectId, now) as ReservationRow[];
      for (const row of expired) {
        this.database.prepare(`
          UPDATE reservations SET released_at = ?, released_by = 'system:expiry' WHERE id = ?
        `).run(now, row.id);
        this.audit(projectId, "reservation.expired", "system:expiry", { id: row.id });
      }
    })();
  }

  private activeReservationRow(projectId: string): ReservationRow | undefined {
    return this.database.prepare(`
      SELECT id, project_id, worktree_path, kind, owner, reason, created_at, expires_at,
             maximum_expires_at, token_hash, idempotency_key, released_at
      FROM reservations WHERE project_id = ? AND released_at IS NULL
    `).get(projectId) as ReservationRow | undefined;
  }

  private releaseRow(row: ReservationRow, owner: string, force: boolean): void {
    this.database.prepare(`
      UPDATE reservations SET released_at = ?, released_by = ? WHERE id = ?
    `).run(new Date().toISOString(), owner, row.id);
    this.audit(row.project_id, force ? "reservation.force_released" : "reservation.released", owner, { id: row.id });
  }

  private audit(projectId: string, eventType: string, actor: string, details: unknown): void {
    this.database.prepare(`
      INSERT INTO audit_events(project_id, event_type, actor, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, eventType, actor, JSON.stringify(details), new Date().toISOString());
  }
}
