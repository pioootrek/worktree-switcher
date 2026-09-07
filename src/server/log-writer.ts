import { constants, lstatSync, mkdirSync } from "node:fs";
import { open, opendir, rename, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface LogWriter {
  controller(event: string, details?: Record<string, unknown>): void;
  project(projectId: string, line: string): void;
  openTest(runId: string): void;
  test(runId: string, line: string): void;
  finishTest(runId: string): Promise<void>;
  pruneTests(isRetained: (runId: string) => boolean): Promise<void>;
  close(): Promise<void>;
}

class RotatingLogFile {
  private file: FileHandle | null = null;
  private size = 0;
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  private closing: Promise<void> | null = null;

  constructor(private readonly path: string) {}

  write(line: string): void {
    if (this.closing) return;
    const content = `${new Date().toISOString()} ${line}\n`;
    this.pending = this.pending.then(async () => {
      if (this.failure) return;
      if (!this.file) {
        this.file = await open(this.path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
        this.size = (await this.file.stat()).size;
      }
      const bytes = Buffer.byteLength(content);
      if (this.size && this.size + bytes > MAX_FILE_BYTES) {
        await this.file.close();
        this.file = null;
        await rename(this.path, `${this.path}.1`);
        this.file = await open(this.path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
        this.size = 0;
      }
      await this.file.writeFile(content);
      this.size += bytes;
    }).catch((error: unknown) => {
      this.failure = error;
      console.error(`Nie udało się zapisać logu ${this.path}: ${String(error)}`);
    });
  }

  close(): Promise<void> {
    this.closing ??= this.pending.then(async () => {
      try {
        await this.file?.close();
      } finally {
        this.file = null;
      }
      if (this.failure) throw this.failure;
    });
    return this.closing;
  }
}

export class FileLogWriter implements LogWriter {
  private readonly projectFiles = new Map<string, RotatingLogFile>();
  private readonly testFiles = new Map<string, RotatingLogFile>();
  private readonly controllerFile: RotatingLogFile;
  private readonly finishing = new Map<string, Promise<void>>();
  private pruning: Promise<void> | null = null;
  private pruneAgain = false;
  private closing: Promise<void> | null = null;

  constructor(private readonly directory: string) {
    mkdirSync(join(directory, "projects"), { recursive: true, mode: 0o700 });
    mkdirSync(join(directory, "tests"), { recursive: true, mode: 0o700 });
    if (!lstatSync(join(directory, "tests")).isDirectory()) throw new Error("Katalog logów testów musi być zwykłym katalogiem.");
    this.controllerFile = new RotatingLogFile(join(directory, "controller.log"));
    this.controller("controller.started");
  }

  controller(event: string, details: Record<string, unknown> = {}): void {
    if (this.closing) return;
    this.controllerFile.write(`${event} ${JSON.stringify(details)}`);
  }

  project(projectId: string, line: string): void {
    if (this.closing) return;
    const safeId = projectId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
    let file = this.projectFiles.get(safeId);
    if (!file) {
      file = new RotatingLogFile(join(this.directory, "projects", `${safeId}.log`));
      this.projectFiles.set(safeId, file);
    }
    file.write(line);
  }

  openTest(runId: string): void {
    if (this.closing || this.testFiles.has(runId) || this.finishing.has(runId)) return;
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Nieprawidłowy identyfikator logu testu.");
    this.testFiles.set(runId, new RotatingLogFile(join(this.directory, "tests", `${runId}.log`)));
  }

  test(runId: string, line: string): void {
    // Only enqueue opens logs. Late output after finalization cannot reopen one.
    this.testFiles.get(runId)?.write(line);
  }

  finishTest(runId: string): Promise<void> {
    const pending = this.finishing.get(runId);
    if (pending) return pending;
    const file = this.testFiles.get(runId);
    if (!file) return Promise.resolve();
    this.testFiles.delete(runId);
    const completion = file.close().finally(() => this.finishing.delete(runId));
    this.finishing.set(runId, completion);
    return completion;
  }

  pruneTests(isRetained: (runId: string) => boolean): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.pruneAgain = true;
    // Defer entry so even synchronous failures clear an already assigned promise.
    this.pruning ??= Promise.resolve().then(async () => {
      try {
        do {
          this.pruneAgain = false;
          const root = join(this.directory, "tests");
          if (!lstatSync(root).isDirectory()) throw new Error("Katalog logów testów musi być zwykłym katalogiem.");
          const entries = await opendir(root);
          for await (const entry of entries) {
            // Manager-generated UUIDs only; never follow symlinks or recurse.
            const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.log(?:\.1)?$/.exec(entry.name);
            if (!entry.isFile() || !match) continue;
            const id = match[1];
            if (this.testFiles.has(id) || this.finishing.has(id) || isRetained(id)) continue;
            await unlink(join(root, entry.name)).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            });
          }
        } while (this.pruneAgain);
      } finally {
        // Clear ownership in the same continuation as the final loop check.
        // A request before promise settlement must start a fresh scan.
        this.pruning = null;
      }
    });
    return this.pruning;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.controller("controller.stopped");
    this.closing = (async () => {
      const results = await Promise.allSettled([
        this.pruning,
        this.controllerFile.close(),
        ...[...this.projectFiles.values()].map((file) => file.close()),
        ...[...this.testFiles.keys()].map((id) => this.finishTest(id)),
        ...this.finishing.values(),
      ]);
      this.projectFiles.clear();
      const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
      if (failures.length) throw new AggregateError(failures, "Nie udało się zamknąć logów.");
    })();
    return this.closing;
  }
}

export const nullLogWriter: LogWriter = {
  controller: () => undefined,
  project: () => undefined,
  openTest: () => undefined,
  test: () => undefined,
  finishTest: async () => undefined,
  pruneTests: async () => undefined,
  close: async () => undefined,
};
