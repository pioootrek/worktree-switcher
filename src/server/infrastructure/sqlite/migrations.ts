import Database from "better-sqlite3";

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

export function initializeSchema(database: Database.Database): void {
  database.exec(schema);
  applyMigrations(database);
}

function applyMigrations(database: Database.Database): void {
  if (!hasMigration(database, 2)) {
    database.transaction(() => {
      database.prepare(`
        UPDATE projects SET args_json = '["run","dev"]', updated_at = ?
        WHERE executable = 'pnpm' AND args_json LIKE '["dev","--","--port",%'
      `).run(new Date().toISOString());
      recordMigration(database, 2);
    })();
  }
  if (!hasMigration(database, 3)) {
    database.transaction(() => {
      const columns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
      const names = new Set(columns.map(({ name }) => name));
      if (!names.has("tls_mode")) database.exec("ALTER TABLE projects ADD COLUMN tls_mode TEXT NOT NULL DEFAULT 'off' CHECK(tls_mode IN ('off', 'generated', 'custom'))");
      if (!names.has("tls_key_path")) database.exec("ALTER TABLE projects ADD COLUMN tls_key_path TEXT");
      if (!names.has("tls_cert_path")) database.exec("ALTER TABLE projects ADD COLUMN tls_cert_path TEXT");
      if (!names.has("tls_ca_path")) database.exec("ALTER TABLE projects ADD COLUMN tls_ca_path TEXT");
      recordMigration(database, 3);
    })();
  }
  if (!hasMigration(database, 4)) {
    database.transaction(() => {
      const columns = database.prepare("PRAGMA table_info(reservations)").all() as Array<{ name: string }>;
      const names = new Set(columns.map(({ name }) => name));
      if (!names.has("maximum_expires_at")) database.exec("ALTER TABLE reservations ADD COLUMN maximum_expires_at TEXT");
      if (!names.has("token_hash")) database.exec("ALTER TABLE reservations ADD COLUMN token_hash TEXT");
      if (!names.has("idempotency_key")) database.exec("ALTER TABLE reservations ADD COLUMN idempotency_key TEXT");
      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS active_agent_idempotency_key
        ON reservations(owner, idempotency_key)
        WHERE kind = 'agent' AND released_at IS NULL AND idempotency_key IS NOT NULL
      `);
      recordMigration(database, 4);
    })();
  }
  if (!hasMigration(database, 5)) {
    database.transaction(() => {
      database.prepare(`
        INSERT OR IGNORE INTO controller_settings(key, value_json, updated_at)
        VALUES ('server_capacity', ?, ?)
      `).run(JSON.stringify({ enabled: false, limit: 2 }), new Date().toISOString());
      recordMigration(database, 5);
    })();
  }
  if (!hasMigration(database, 6)) {
    database.transaction(() => {
      database.exec(`
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
      recordMigration(database, 6);
    })();
  }
  if (!hasMigration(database, 7)) {
    database.transaction(() => {
      const columns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "launch_preset")) {
        database.exec("ALTER TABLE projects ADD COLUMN launch_preset TEXT NOT NULL DEFAULT 'node' CHECK(launch_preset IN ('auto', 'node', 'django'))");
      }
      recordMigration(database, 7);
    })();
  }
  if (!hasMigration(database, 8)) {
    database.transaction(() => {
      const columns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "environment_json")) {
        database.exec("ALTER TABLE projects ADD COLUMN environment_json TEXT NOT NULL DEFAULT '{}'");
      }
      recordMigration(database, 8);
    })();
  }
  if (!hasMigration(database, 9)) {
    database.transaction(() => {
      const columns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
      const names = new Set(columns.map(({ name }) => name));
      const addedProfilesColumn = !names.has("environment_profiles_json");
      if (addedProfilesColumn) {
        database.exec(`ALTER TABLE projects ADD COLUMN environment_profiles_json TEXT NOT NULL DEFAULT '[{"name":"default","environment":{}}]'`);
      }
      if (!names.has("selected_environment_profile")) {
        database.exec("ALTER TABLE projects ADD COLUMN selected_environment_profile TEXT NOT NULL DEFAULT 'default'");
      }
      if (addedProfilesColumn) {
        database.prepare(`
          UPDATE projects SET environment_profiles_json = json_array(json_object('name', 'default', 'environment', json(environment_json)))
        `).run();
      }
      recordMigration(database, 9);
    })();
  }
  if (!hasMigration(database, 10)) {
    database.transaction(() => {
      database.exec(`
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
      database.prepare(`
        INSERT OR IGNORE INTO controller_settings(key, value_json, updated_at)
        VALUES ('test_queue', ?, ?)
      `).run(JSON.stringify({ limit: 1 }), new Date().toISOString());
      recordMigration(database, 10);
    })();
  }
  if (!hasMigration(database, 11)) {
    database.transaction(() => {
      const projectColumns = new Set((database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>).map(({ name }) => name));
      if (!projectColumns.has("test_environment_profiles_json")) {
        database.exec(`ALTER TABLE projects ADD COLUMN test_environment_profiles_json TEXT NOT NULL DEFAULT '${DEFAULT_TEST_PROFILES_JSON}'`);
      }
      if (!projectColumns.has("test_preset_profiles_json")) {
        database.exec("ALTER TABLE projects ADD COLUMN test_preset_profiles_json TEXT NOT NULL DEFAULT '{}'");
      }
      const runColumns = new Set((database.prepare("PRAGMA table_info(test_runs)").all() as Array<{ name: string }>).map(({ name }) => name));
      if (!runColumns.has("environment_mode")) {
        // Historical runs predate the policy, so they are recorded as the inheriting behaviour they actually had.
        database.exec("ALTER TABLE test_runs ADD COLUMN environment_mode TEXT NOT NULL DEFAULT 'inherit-server-profile'");
        database.exec("ALTER TABLE test_runs ADD COLUMN environment_profile TEXT NOT NULL DEFAULT 'legacy'");
        database.exec("ALTER TABLE test_runs ADD COLUMN inherited_server_profile TEXT");
        database.exec("ALTER TABLE test_runs ADD COLUMN environment_variable_names_json TEXT NOT NULL DEFAULT '[]'");
      }
      recordMigration(database, 11);
    })();
  }
}

function hasMigration(database: Database.Database, version: number): boolean {
  return Boolean(database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version));
}

function recordMigration(database: Database.Database, version: number): void {
  database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
    .run(version, new Date().toISOString());
}
