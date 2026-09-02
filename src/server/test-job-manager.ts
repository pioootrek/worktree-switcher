import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";

import type { TestQueueStatus, TestRun, Worktree } from "@/shared/contracts";
import type { LogWriter } from "./log-writer";
import type { StateStore } from "./state-store";
import type { TestCommand } from "./test-command";

const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_LENGTH = 2_000;
const MAX_QUEUED_RUNS = 100;
const LOG_PERSISTENCE_INTERVAL_MS = 250;

interface ActiveRun {
  child: ChildProcess;
  run: TestRun;
  timeout: NodeJS.Timeout;
  cancellationRequested: boolean;
  timedOut: boolean;
  worktreePath: string;
}

export interface EnqueueTestInput {
  projectId: string;
  worktree: Worktree;
  command: TestCommand;
  environment: Record<string, string>;
  actor: string;
  idempotencyKey?: string;
}

export class TestJobManager {
  private readonly active = new Map<string, ActiveRun>();
  private pumping = false;
  private closed = false;
  private outputNotification: NodeJS.Timeout | null = null;
  private readonly logPersistence = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: StateStore,
    private readonly logs: LogWriter,
    private readonly onChange: () => void = () => undefined,
  ) {
    this.store.markInterruptedTestRuns();
  }

  status(): TestQueueStatus {
    const settings = this.store.getTestQueueSettings();
    return {
      ...settings,
      running: this.active.size,
      queued: this.store.countTestRuns(["queued"]),
    };
  }

  setLimit(limit: number): TestQueueStatus {
    if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new Error("Limit równoległych testów musi być liczbą całkowitą od 1 do 16.");
    this.store.setTestQueueSettings({ limit });
    this.pump();
    this.onChange();
    return this.status();
  }

  enqueue(input: EnqueueTestInput): TestRun {
    if (input.idempotencyKey) {
      const repeated = this.store.findTestRunByIdempotency(input.actor, input.idempotencyKey);
      if (repeated) {
        if (
          repeated.projectId !== input.projectId
          || repeated.worktreePath !== input.worktree.path
          || repeated.presetId !== input.command.preset.id
        ) throw new Error("Klucz idempotencji jest już używany przez inne uruchomienie testu.");
        return repeated;
      }
    }
    if (this.store.countTestRuns(["queued"]) >= MAX_QUEUED_RUNS) {
      throw new Error(`Kolejka testów może zawierać najwyżej ${MAX_QUEUED_RUNS} oczekujących zadań.`);
    }
    const run: TestRun = {
      id: randomUUID(),
      projectId: input.projectId,
      worktreePath: input.worktree.path,
      worktreeHead: input.worktree.head,
      worktreeBranch: input.worktree.branch,
      worktreeDirty: input.worktree.dirty,
      presetId: input.command.preset.id,
      presetName: input.command.preset.name,
      adapter: input.command.preset.adapter,
      actor: input.actor,
      phase: "queued",
      queuePosition: null,
      executable: input.command.executable,
      args: input.command.args,
      cwd: input.command.cwd,
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      logs: [],
    };
    this.store.saveTestRun(run, input.idempotencyKey);
    this.environments.set(run.id, input.environment);
    this.timeouts.set(run.id, input.command.preset.timeoutMs);
    this.write(run, `$ ${run.executable} ${run.args.join(" ")}`);
    this.persistNow(run);
    this.pump();
    this.onChange();
    return this.requireRun(run.id);
  }

  cancel(runId: string, actor: string): TestRun {
    const persisted = this.requireRun(runId);
    const active = this.active.get(runId);
    const run = active?.run ?? persisted;
    if (actor !== "local-user" && run.actor !== actor) throw new Error("Tylko autor testu może go anulować.");
    if (run.phase === "queued") {
      run.phase = "cancelled";
      run.finishedAt = new Date().toISOString();
      this.persistNow(run);
      this.cleanup(run.id);
      this.pump();
      this.onChange();
      return run;
    }
    if (!active || run.phase !== "running") return run;
    active.cancellationRequested = true;
    this.signal(active.child, "SIGTERM");
    setTimeout(() => {
      if (this.active.has(run.id)) this.signal(active.child, "SIGKILL");
    }, 3_500).unref();
    this.onChange();
    return run;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.outputNotification) clearTimeout(this.outputNotification);
    this.outputNotification = null;
    const unfinished = this.store.listPendingTestRuns();
    for (const run of unfinished) this.cancel(run.id, "local-user");
    await Promise.all([...this.active.values()].map(({ child }) => new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      setTimeout(resolve, 4_500).unref();
    })));
  }

  private readonly environments = new Map<string, Record<string, string>>();
  private readonly timeouts = new Map<string, number>();

  private pump(): void {
    if (this.pumping || this.closed) return;
    this.pumping = true;
    queueMicrotask(() => {
      try {
        if (this.closed) return;
        const limit = this.store.getTestQueueSettings().limit;
        const queued = this.store.listPendingTestRuns()
          .filter(({ phase }) => phase === "queued")
          .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
        const occupiedWorktrees = new Set([...this.active.values()].map(({ worktreePath }) => worktreePath));
        while (this.active.size < limit) {
          const next = queued.find(({ worktreePath }) => !occupiedWorktrees.has(worktreePath));
          if (!next) break;
          queued.splice(queued.indexOf(next), 1);
          occupiedWorktrees.add(next.worktreePath);
          this.start(this.requireRun(next.id));
        }
        this.updateQueuePositions();
      } finally {
        this.pumping = false;
      }
    });
  }

  private start(run: TestRun): void {
    run.phase = "running";
    run.startedAt = new Date().toISOString();
    run.queuePosition = null;
    this.store.saveTestRun(run);
    let child: ChildProcess;
    try {
      child = spawn(run.executable, run.args, {
        cwd: run.cwd,
        env: { ...process.env, ...(this.environments.get(run.id) ?? {}) },
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      run.phase = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      run.finishedAt = new Date().toISOString();
      this.finish(run);
      return;
    }
    const timeout = setTimeout(() => {
      const active = this.active.get(run.id);
      if (!active) return;
      active.timedOut = true;
      this.signal(child, "SIGTERM");
      setTimeout(() => {
        if (this.active.has(run.id)) this.signal(child, "SIGKILL");
      }, 3_500).unref();
    }, this.timeouts.get(run.id) ?? 15 * 60_000);
    timeout.unref();
    this.active.set(run.id, { child, run, timeout, cancellationRequested: false, timedOut: false, worktreePath: run.worktreePath });
    child.stdout?.on("data", (chunk: Buffer) => this.appendChunk(run, chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.appendChunk(run, chunk));
    child.once("error", (error) => {
      if (!this.active.has(run.id)) return;
      run.phase = "failed";
      run.error = error.message;
      run.finishedAt = new Date().toISOString();
      this.finish(run);
    });
    child.once("close", (code, signal) => {
      if (!this.active.has(run.id)) return;
      const active = this.active.get(run.id)!;
      run.exitCode = code;
      run.signal = signal;
      run.finishedAt = new Date().toISOString();
      run.phase = active.cancellationRequested ? "cancelled" : active.timedOut ? "timed_out" : code === 0 ? "passed" : "failed";
      if (run.phase === "failed" && !run.error) run.error = `Proces testowy zakończył się z kodem ${code ?? signal ?? "unknown"}.`;
      this.finish(run);
    });
    this.onChange();
  }

  private finish(run: TestRun): void {
    const active = this.active.get(run.id);
    if (active) clearTimeout(active.timeout);
    this.persistNow(run);
    this.active.delete(run.id);
    this.cleanup(run.id);
    this.logs.controller("test_run.finished", { runId: run.id, projectId: run.projectId, phase: run.phase, exitCode: run.exitCode });
    this.pump();
    this.onChange();
  }

  private appendChunk(run: TestRun, chunk: Buffer): void {
    for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) this.write(run, line);
  }

  private write(run: TestRun, line: string): void {
    const bounded = line.slice(0, MAX_LOG_LINE_LENGTH);
    run.logs.push(bounded);
    if (run.logs.length > MAX_LOG_LINES) run.logs.splice(0, run.logs.length - MAX_LOG_LINES);
    this.logs.test(run.id, bounded);
    this.schedulePersistence(run);
    this.notifyOutput();
  }

  private updateQueuePositions(): void {
    const queued = this.store.listPendingTestRuns()
      .filter(({ phase }) => phase === "queued")
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
    queued.forEach((run, index) => {
      const position = index + 1;
      if (run.queuePosition === position) return;
      const persisted = this.requireRun(run.id);
      persisted.queuePosition = position;
      this.store.saveTestRun(persisted);
    });
  }

  private cleanup(runId: string): void {
    const pendingPersistence = this.logPersistence.get(runId);
    if (pendingPersistence) clearTimeout(pendingPersistence);
    this.logPersistence.delete(runId);
    this.environments.delete(runId);
    this.timeouts.delete(runId);
  }

  private requireRun(id: string): TestRun {
    const run = this.store.getTestRun(id);
    if (!run) throw new Error("Nie znaleziono uruchomienia testu.");
    return run;
  }

  private signal(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid) return;
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  private schedulePersistence(run: TestRun): void {
    if (this.logPersistence.has(run.id)) return;
    const timeout = setTimeout(() => {
      this.logPersistence.delete(run.id);
      this.store.saveTestRun(run);
    }, LOG_PERSISTENCE_INTERVAL_MS);
    timeout.unref();
    this.logPersistence.set(run.id, timeout);
  }

  private persistNow(run: TestRun): void {
    const pending = this.logPersistence.get(run.id);
    if (pending) clearTimeout(pending);
    this.logPersistence.delete(run.id);
    this.store.saveTestRun(run);
  }

  private notifyOutput(): void {
    if (this.outputNotification || this.closed) return;
    this.outputNotification = setTimeout(() => {
      this.outputNotification = null;
      if (!this.closed) this.onChange();
    }, 500);
    this.outputNotification.unref();
  }
}
