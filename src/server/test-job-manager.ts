import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";

import type { TestQueueStatus, TestRun, TestSourceObservation, Worktree } from "@/shared/contracts";
import type { LogWriter } from "./log-writer";
import type { StateStore } from "./state-store";
import type { ResolvedTestEnvironment } from "@/server/modules/environments";
import type { TestCommand } from "./test-command";

import { OwnedProcessGroup } from "./owned-process-group";
import { compareSource, legacySourceEvidence, pendingSourceEvidence, qualifySource, type TestSourceObserver } from "./test-source-attribution";

const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_LENGTH = 2_000;
const MAX_QUEUED_RUNS = 100;
const LOG_PERSISTENCE_INTERVAL_MS = 250;
const PROCESS_GROUP_CLEANUP_ATTEMPTS = 3;
const PROCESS_GROUP_CLEANUP_RETRY_MS = 100;
const OUTPUT_CLOSE_GRACE_MS = 1_000;

interface ActiveRun {
  child: ChildProcess;
  group: OwnedProcessGroup;
  closed: Promise<void>;
  completion: Promise<void> | null;
  executionError: string | null;
  exited: boolean;
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
  environment: ResolvedTestEnvironment;
  actor: string;
  idempotencyKey?: string;
  sourceObservation?: TestSourceObservation;
}

export class TestJobManager {
  private readonly active = new Map<string, ActiveRun>();
  private readonly finalizations = new Map<string, Promise<void>>();
  private readonly preparing = new Set<string>();
  private readonly preparationPromises = new Set<Promise<void>>();
  private sourceObserver: TestSourceObserver | null = null;
  private logMaintenance: Promise<void> = Promise.resolve();
  private pruneOperation: Promise<void> | null = null;
  private pumping = false;
  private closed = false;
  private outputNotification: NodeJS.Timeout | null = null;
  private readonly outputProjects = new Set<string>();
  private readonly logPersistence = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: StateStore,
    private readonly logs: LogWriter,
    private readonly onChange: (projectId?: string) => void = () => undefined,
  ) {
    this.store.markInterruptedTestRuns();
    void this.pruneLogs();
  }

  configureSourceObserver(observer: TestSourceObserver): void {
    this.sourceObserver = observer;
  }

  replay(actor: string, idempotencyKey: string, projectId: string, worktreePath: string, presetId: string): TestRun | null {
    const repeated = this.store.findTestRunByIdempotency(actor, idempotencyKey);
    if (!repeated) return null;
    if (repeated.projectId !== projectId || repeated.worktreePath !== worktreePath || repeated.presetId !== presetId) {
      throw new Error("Klucz idempotencji jest już używany przez inne uruchomienie testu.");
    }
    return repeated;
  }

  status(): TestQueueStatus {
    const settings = this.store.getTestQueueSettings();
    return {
      ...settings,
      running: this.active.size + this.preparing.size,
      queued: Math.max(0, this.store.countTestRuns(["queued"]) - this.preparing.size),
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
    if (this.closed) throw new Error("Kolejka testów jest zamknięta.");
    if (input.idempotencyKey) {
      const repeated = this.replay(input.actor, input.idempotencyKey, input.projectId, input.worktree.path, input.command.preset.id);
      if (repeated) return repeated;
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
      environmentMode: input.environment.mode,
      environmentProfile: input.environment.profile,
      inheritedServerProfile: input.environment.inheritedServerProfile,
      environmentVariableNames: input.environment.variableNames,
      source: input.sourceObservation ? pendingSourceEvidence(input.sourceObservation) : legacySourceEvidence(),
    };
    this.store.saveTestRun(run, input.idempotencyKey);
    this.environments.set(run.id, input.environment.environment);
    this.timeouts.set(run.id, input.command.preset.timeoutMs);
    this.logs.openTest(run.id);
    this.write(run, `$ ${run.executable} ${run.args.join(" ")}`);
    this.persistNow(run);
    this.pump();
    this.onChange(run.projectId);
    return this.requireRun(run.id);
  }

  async cancel(runId: string, actor: string): Promise<TestRun> {
    const persisted = this.requireRun(runId);
    const active = this.active.get(runId);
    const run = active?.run ?? persisted;
    if (actor !== "local-user" && run.actor !== actor) throw new Error("Tylko autor testu może go anulować.");
    if (run.phase === "queued") {
      this.preparing.delete(run.id);
      run.phase = "cancelled";
      run.finishedAt = new Date().toISOString();
      await this.finish(run);
      return this.store.getTestRun(run.id) ?? run;
    }
    if (!active || run.phase !== "running") return run;
    if (!active.exited) active.cancellationRequested = true;
    this.complete(active);
    this.onChange(run.projectId);
    return run;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.outputNotification) clearTimeout(this.outputNotification);
    this.outputNotification = null;
    const unfinished = this.store.listPendingTestRuns();
    const cancellations = await Promise.allSettled(unfinished.map((run) => this.cancel(run.id, "local-user")));
    await Promise.allSettled(this.preparationPromises);
    await Promise.all([...this.active.values()].map((active) => this.complete(active)));
    await Promise.all(this.finalizations.values());
    await this.logMaintenance;
    if (this.active.size) throw new Error("Nie potwierdzono zakończenia wszystkich grup procesów testowych.");
    const failures = cancellations.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Nie zakończono poprawnie anulowania zadań testowych.");
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
          .filter(({ id, phase }) => phase === "queued" && !this.finalizations.has(id))
          .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
        const occupiedWorktrees = new Set([...this.active.values()].map(({ worktreePath }) => worktreePath));
        for (const id of this.preparing) occupiedWorktrees.add(this.requireRun(id).worktreePath);
        while (this.active.size + this.preparing.size < limit) {
          const next = queued.find(({ worktreePath }) => !occupiedWorktrees.has(worktreePath));
          if (!next) break;
          queued.splice(queued.indexOf(next), 1);
          occupiedWorktrees.add(next.worktreePath);
          const run = this.requireRun(next.id);
          this.preparing.add(run.id);
          const preparation = this.prepare(run);
          this.preparationPromises.add(preparation);
          void preparation.finally(() => this.preparationPromises.delete(preparation));
        }
        this.updateQueuePositions();
      } finally {
        this.pumping = false;
      }
    });
  }

  private async prepare(run: TestRun): Promise<void> {
    try {
      if (!this.sourceObserver || !run.source.enqueue) {
        this.preparing.delete(run.id);
        this.start(run);
        return;
      }
      run.source.preflight = await this.sourceObserver(run, "preflight");
      run.source.queueComparison = compareSource(run.source.enqueue, run.source.preflight);
      if (this.closed || this.store.getTestRun(run.id)?.phase !== "queued") return;
      this.persistNow(run);
      if (run.source.queueComparison !== "match") {
        run.source = qualifySource(run.source);
        run.phase = "failed";
        run.finishedAt = new Date().toISOString();
        run.error = run.source.queueComparison === "changed" ? "Źródło testu zmieniło się podczas oczekiwania w kolejce." : "Nie udało się potwierdzić źródła testu przed uruchomieniem.";
        this.preparing.delete(run.id);
        await this.finish(run);
        return;
      }
      this.preparing.delete(run.id);
      if (this.closed || this.store.getTestRun(run.id)?.phase !== "queued") return;
      this.start(run);
    } catch (error) {
      if (this.store.getTestRun(run.id)?.phase === "queued") {
        run.source.reasonCodes = [...new Set([...run.source.reasonCodes, "source_preflight_failed"])];
        run.source = qualifySource(run.source);
        run.phase = "failed";
        run.finishedAt = new Date().toISOString();
        run.error = `Nie udało się sprawdzić źródła testu: ${String(error)}`;
        await this.finish(run);
      }
    } finally {
      this.preparing.delete(run.id);
      this.pump();
    }
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
        // The resolved policy is the complete environment: nothing of the controller's own
        // process environment reaches a test unless its profile asked for it. Next.js declares
        // ProcessEnv.NODE_ENV as required, but Node child processes permit it to be omitted.
        env: (this.environments.get(run.id) ?? {}) as NodeJS.ProcessEnv,
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      run.phase = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      run.finishedAt = new Date().toISOString();
      void this.finish(run).catch((error: unknown) => {
        this.logs.controller("test_run.finalization_failed", { runId: run.id, error: String(error) });
      });
      return;
    }
    const timeout = setTimeout(() => {
      const active = this.active.get(run.id);
      if (!active || active.exited) return;
      active.timedOut = true;
      this.complete(active);
    }, this.timeouts.get(run.id) ?? 15 * 60_000);
    timeout.unref();
    const active: ActiveRun = {
      child, run, timeout, cancellationRequested: false, timedOut: false,
      worktreePath: run.worktreePath, group: new OwnedProcessGroup(child), completion: null,
      executionError: null, exited: false,
      closed: new Promise<void>((resolve) => child.once("close", () => resolve())),
    };
    this.active.set(run.id, active);
    child.stdout?.on("data", (chunk: Buffer) => this.appendChunk(run, chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.appendChunk(run, chunk));
    child.once("error", (error) => {
      active.executionError = error.message;
      run.error = error.message;
      this.complete(active);
    });
    child.once("exit", (code, signal) => {
      active.exited = true;
      clearTimeout(active.timeout);
      run.exitCode = code;
      run.signal = signal;
      this.complete(active);
    });
    this.onChange(run.projectId);
  }

  private complete(active: ActiveRun): Promise<void> {
    if (active.completion) return active.completion;
    active.completion = (async () => {
      const { run } = active;
      try {
        await this.stopWithRetries(active.group);
        await this.waitForOutputClose(active);
        run.error = active.executionError;
        run.finishedAt = new Date().toISOString();
        run.phase = active.cancellationRequested ? "cancelled" : active.timedOut ? "timed_out"
          : run.exitCode === 0 && !run.error ? "passed" : "failed";
        run.source.processOutcome = run.phase;
        if (this.sourceObserver && run.source.enqueue) {
          try {
            run.source.finish = await this.sourceObserver(run, "finish");
          } catch {
            run.source.finish = {
              observedAt: new Date().toISOString(), head: null, branch: null, dirty: null,
              statusDigest: null, statusEntries: null, complete: false, errorCode: "source_finish_failed",
            };
          }
          run.source = qualifySource(run.source);
          if (run.phase === "passed" && run.source.attribution !== "observed_match") {
            run.phase = "failed";
            run.error = "Polecenie zakończyło się powodzeniem, ale źródło nie zostało potwierdzone.";
          }
        }
        if (run.phase === "failed" && !run.error) run.error = `Proces testowy zakończył się z kodem ${run.exitCode ?? run.signal ?? "unknown"}.`;
        await this.finish(run);
      } catch (error) {
        // Non-terminal: preserve the active slot and worktree exclusion until cleanup succeeds.
        run.error = `Nie potwierdzono sprzątania procesów: ${error instanceof Error ? error.message : String(error)}`;
        this.persistNow(run);
        this.onChange(run.projectId);
      } finally {
        active.completion = null;
      }
    })();
    return active.completion;
  }

  private async stopWithRetries(group: OwnedProcessGroup): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= PROCESS_GROUP_CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        await group.stop();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < PROCESS_GROUP_CLEANUP_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, PROCESS_GROUP_CLEANUP_RETRY_MS));
        }
      }
    }
    throw lastError;
  }

  private async waitForOutputClose(active: ActiveRun): Promise<void> {
    let timeout: NodeJS.Timeout | null = null;
    const closed = await Promise.race([
      active.closed.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), OUTPUT_CLOSE_GRACE_MS);
        timeout.unref();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (closed) return;
    active.child.stdout?.removeAllListeners("data");
    active.child.stderr?.removeAllListeners("data");
    active.child.stdout?.destroy();
    active.child.stderr?.destroy();
  }

  pruneLogs(): Promise<void> {
    const pruning = this.logs.pruneTests((id) => this.store.hasTestRun(id));
    // The writer coalesces overlapping scans; keep only one maintenance waiter.
    if (pruning !== this.pruneOperation) {
      this.pruneOperation = pruning;
      this.logMaintenance = pruning.catch((error: unknown) => {
        this.logs.controller("test_log.cleanup_failed", { error: String(error) });
      });
    }
    return this.logMaintenance;
  }

  private finish(run: TestRun): Promise<void> {
    const existing = this.finalizations.get(run.id);
    if (existing) return existing;
    const active = this.active.get(run.id);
    if (active) clearTimeout(active.timeout);
    this.cleanup(run.id);
    const completion = (async () => {
      try {
        await this.logs.finishTest(run.id);
      } catch (error) {
        const message = `Nie udało się zapisać lub zamknąć logu testu: ${String(error)}`;
        run.error = run.error ? `${run.error} ${message}` : message;
        if (run.phase === "passed") run.phase = "failed";
        this.logs.controller("test_log.finalization_failed", { runId: run.id, error: String(error) });
      }
      this.persistNow(run);
      this.active.delete(run.id);
      this.preparing.delete(run.id);
      this.logs.controller("test_run.finished", { runId: run.id, projectId: run.projectId, phase: run.phase, exitCode: run.exitCode });
      void this.pruneLogs();
    })().finally(() => {
      this.finalizations.delete(run.id);
      this.pump();
      this.onChange(run.projectId);
    });
    this.finalizations.set(run.id, completion);
    return completion;
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
    this.notifyOutput(run.projectId);
  }

  private updateQueuePositions(): void {
    const queued = this.store.listPendingTestRuns()
      .filter(({ id, phase }) => phase === "queued" && !this.finalizations.has(id))
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

  private notifyOutput(projectId: string): void {
    if (this.outputProjects.size < 128) this.outputProjects.add(projectId);
    if (this.outputNotification || this.closed) return;
    this.outputNotification = setTimeout(() => {
      this.outputNotification = null;
      if (!this.closed) {
        if (this.outputProjects.size >= 128) this.onChange();
        else for (const id of this.outputProjects) this.onChange(id);
      }
      this.outputProjects.clear();
    }, 500);
    this.outputNotification.unref();
  }
}
