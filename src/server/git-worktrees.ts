import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";

import type { Worktree } from "@/shared/contracts";

export type GitCommandPriority = "operational" | "background";

interface AdmissionJob<T> {
  priority: GitCommandPriority;
  operation: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class GitCommandAdmission {
  private readonly operational: AdmissionJob<unknown>[] = [];
  private readonly background: AdmissionJob<unknown>[] = [];
  private readonly controllers = new Set<AbortController>();
  private running = 0;
  private closed = false;

  constructor(private readonly limit = 4, private readonly maxQueued = 128) {}

  run<T>(priority: GitCommandPriority, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Obsługa poleceń Git jest zamknięta."));
    const queue = priority === "operational" ? this.operational : this.background;
    if (queue.length >= this.maxQueued) {
      return Promise.reject(new Error("Kolejka poleceń Git jest zajęta. Spróbuj ponownie później."));
    }
    return new Promise<T>((resolve, reject) => {
      const job = { priority, operation, resolve, reject } as AdmissionJob<T>;
      queue.push(job as AdmissionJob<unknown>);
      this.pump();
    });
  }

  close(): void {
    this.closed = true;
    const error = new Error("Obsługa poleceń Git została zamknięta.");
    for (const job of [...this.operational.splice(0), ...this.background.splice(0)]) job.reject(error);
    for (const controller of this.controllers) controller.abort();
  }

  private pump(): void {
    while (!this.closed && this.running < this.limit) {
      const job = this.operational.shift() ?? this.background.shift();
      if (!job) return;
      this.running += 1;
      const controller = new AbortController();
      this.controllers.add(controller);
      void job.operation(controller.signal).then(job.resolve, job.reject).finally(() => {
        this.controllers.delete(controller);
        this.running -= 1;
        this.pump();
      });
    }
  }
}

function execute(
  executable: string,
  args: string[],
  options: { encoding: BufferEncoding; timeout: number; maxBuffer?: number; signal: AbortSignal },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, options, (error, stdout) => {
      if (error) reject(error);
      else resolve({ stdout: String(stdout) });
    });
  });
}

export interface GitWorktreeReader {
  canonicalRepositoryPath(path: string): Promise<string>;
  list(repositoryPath: string, options?: { priority?: GitCommandPriority }): Promise<Worktree[]>;
  close?(): void;
}
export function parseWorktreePorcelain(output: string): Omit<Worktree, "dirty">[] {
  const records = output.split("\0\0").filter(Boolean);
  return records.flatMap((record) => {
    const lines = record.split("\0").filter(Boolean);
    const fields = new Map<string, string>();
    const flags = new Set<string>();
    for (const line of lines) {
      const separator = line.indexOf(" ");
      if (separator === -1) flags.add(line);
      else fields.set(line.slice(0, separator), line.slice(separator + 1));
    }
    const path = fields.get("worktree");
    const head = fields.get("HEAD");
    if (!path || !head || flags.has("bare")) return [];
    const branchRef = fields.get("branch");
    return [{
      path,
      head,
      shortHead: head.slice(0, 8),
      branch: branchRef?.replace(/^refs\/heads\//, "") ?? null,
      detached: flags.has("detached"),
      locked: fields.has("locked") || flags.has("locked"),
      prunable: fields.has("prunable") || flags.has("prunable"),
    }];
  });
}

export class SystemGitWorktreeReader implements GitWorktreeReader {
  constructor(private readonly admission = new GitCommandAdmission()) {}

  async canonicalRepositoryPath(path: string): Promise<string> {
    const canonicalInput = await realpath(path);
    try {
      const { stdout } = await this.admission.run("operational", (signal) => execute(
        "git", ["-C", canonicalInput, "rev-parse", "--show-toplevel"],
        { encoding: "utf8", timeout: 5000, signal },
      ));
      return realpath(stdout.trim());
    } catch {
      throw new Error("Wybrana ścieżka nie jest repozytorium Git.");
    }
  }

  async list(repositoryPath: string, options: { priority?: GitCommandPriority } = {}): Promise<Worktree[]> {
    const priority = options.priority ?? "operational";
    const { stdout } = await this.admission.run(priority, (signal) => execute(
      "git", ["-C", repositoryPath, "worktree", "list", "--porcelain", "-z"],
      { encoding: "utf8", timeout: 8000, maxBuffer: 2 * 1024 * 1024, signal },
    ));
    const worktrees = parseWorktreePorcelain(stdout);
    return Promise.all(worktrees.map(async (worktree) => {
      let dirty = false;
      let statusError: string | undefined;
      try {
        const { stdout: status } = await this.admission.run(priority, (signal) => execute(
          "git", ["-C", worktree.path, "status", "--porcelain", "--untracked-files=normal"],
          { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024, signal },
        ));
        dirty = status.length > 0;
      } catch {
        dirty = true;
        statusError = "Nie udało się odczytać stanu worktree.";
      }
      return { ...worktree, dirty, ...(statusError ? { statusError } : {}) };
    }));
  }

  close(): void {
    this.admission.close();
  }
}
