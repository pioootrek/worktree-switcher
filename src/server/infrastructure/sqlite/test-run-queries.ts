import type { PendingTestRun } from "@/server/state-store";
import type { TestEnvironmentMode, TestRun, TestRunPhase } from "@/shared/contracts";
import Database from "better-sqlite3";

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

/** Borrows the owner connection; never opens or closes a database. */
export class TestRunQueries {
  constructor(private readonly database: Database.Database) {}

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

  hasTestRun(id: string): boolean {
    return this.database.prepare("SELECT 1 FROM test_runs WHERE id = ?").get(id) !== undefined;
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
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE test_runs SET phase = 'interrupted', finished_at = ?, queue_position = NULL,
          error = 'Kontroler został zatrzymany przed zakończeniem testu.'
        WHERE phase IN ('queued', 'running')
      `).run(now);
      this.database.prepare(`
        DELETE FROM test_runs WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY queued_at DESC, id DESC) AS rank
            FROM test_runs WHERE phase NOT IN ('queued', 'running')
          ) WHERE rank > 50
        )
      `).run();
    })();
  }
}
