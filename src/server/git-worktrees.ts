import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type { Worktree } from "@/shared/contracts";

const execFileAsync = promisify(execFile);

export interface GitWorktreeReader {
  canonicalRepositoryPath(path: string): Promise<string>;
  list(repositoryPath: string): Promise<Worktree[]>;
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
  async canonicalRepositoryPath(path: string): Promise<string> {
    const canonicalInput = await realpath(path);
    try {
      const { stdout } = await execFileAsync("git", ["-C", canonicalInput, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        timeout: 5000,
      });
      return realpath(stdout.trim());
    } catch {
      throw new Error("Wybrana ścieżka nie jest repozytorium Git.");
    }
  }

  async list(repositoryPath: string): Promise<Worktree[]> {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryPath, "worktree", "list", "--porcelain", "-z"],
      { encoding: "utf8", timeout: 8000, maxBuffer: 2 * 1024 * 1024 },
    );
    const worktrees = parseWorktreePorcelain(stdout);
    return Promise.all(worktrees.map(async (worktree) => {
      let dirty = false;
      try {
        const { stdout: status } = await execFileAsync(
          "git",
          ["-C", worktree.path, "status", "--porcelain", "--untracked-files=normal"],
          { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 },
        );
        dirty = status.length > 0;
      } catch {
        dirty = true;
      }
      return { ...worktree, dirty };
    }));
  }
}
