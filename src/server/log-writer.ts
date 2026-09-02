import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from "node:fs";
import { join } from "node:path";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface LogWriter {
  controller(event: string, details?: Record<string, unknown>): void;
  project(projectId: string, line: string): void;
  test(runId: string, line: string): void;
  close(): Promise<void>;
}

class RotatingLogFile {
  private stream: WriteStream;
  private size: number;
  private streamError: Error | null = null;

  constructor(private readonly path: string) {
    this.rotateExistingFile();
    this.size = existsSync(path) ? statSync(path).size : 0;
    this.stream = this.open();
  }

  write(line: string): void {
    const content = `${new Date().toISOString()} ${line}\n`;
    const bytes = Buffer.byteLength(content);
    if (this.size + bytes > MAX_FILE_BYTES) this.rotate();
    this.stream.write(content);
    this.size += bytes;
  }

  close(): Promise<void> {
    if (this.streamError || this.stream.destroyed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.stream.once("error", onError);
      this.stream.end(() => {
        this.stream.off("error", onError);
        resolve();
      });
    });
  }

  private open(): WriteStream {
    const stream = createWriteStream(this.path, { flags: "a", mode: 0o600 });
    stream.on("error", (error) => {
      this.streamError = error;
      console.error(`Nie udało się zapisać logu ${this.path}: ${error.message}`);
    });
    return stream;
  }

  private rotate(): void {
    this.stream.end();
    this.moveToPrevious();
    this.size = 0;
    this.stream = this.open();
  }

  private rotateExistingFile(): void {
    if (existsSync(this.path) && statSync(this.path).size >= MAX_FILE_BYTES) this.moveToPrevious();
  }

  private moveToPrevious(): void {
    if (existsSync(this.path)) renameSync(this.path, `${this.path}.1`);
  }
}

export class FileLogWriter implements LogWriter {
  private readonly projectFiles = new Map<string, RotatingLogFile>();
  private readonly testFiles = new Map<string, RotatingLogFile>();
  private readonly controllerFile: RotatingLogFile;

  constructor(private readonly directory: string) {
    mkdirSync(join(directory, "projects"), { recursive: true, mode: 0o700 });
    mkdirSync(join(directory, "tests"), { recursive: true, mode: 0o700 });
    this.controllerFile = new RotatingLogFile(join(directory, "controller.log"));
    this.controller("controller.started");
  }

  controller(event: string, details: Record<string, unknown> = {}): void {
    this.controllerFile.write(`${event} ${JSON.stringify(details)}`);
  }

  project(projectId: string, line: string): void {
    const safeId = projectId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
    let file = this.projectFiles.get(safeId);
    if (!file) {
      file = new RotatingLogFile(join(this.directory, "projects", `${safeId}.log`));
      this.projectFiles.set(safeId, file);
    }
    file.write(line);
  }

  test(runId: string, line: string): void {
    const key = runId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
    let file = this.testFiles.get(key);
    if (!file) {
      file = new RotatingLogFile(join(this.directory, "tests", `${key}.log`));
      this.testFiles.set(key, file);
    }
    file.write(line);
  }

  async close(): Promise<void> {
    this.controller("controller.stopped");
    await Promise.all([
      this.controllerFile.close(),
      ...[...this.projectFiles.values(), ...this.testFiles.values()].map((file) => file.close()),
    ]);
  }
}

export const nullLogWriter: LogWriter = {
  controller: () => undefined,
  project: () => undefined,
  test: () => undefined,
  close: async () => undefined,
};
