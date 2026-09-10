import { execFile } from "node:child_process";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  PrepareRemoteVerificationWorkspaceInput,
  RemoteVerificationWorkspace,
  RemoteVerificationWorkspacePreparer,
} from "@/server/modules/remote-verification";
import { GitCommandAdmission } from "@/server/git-worktrees";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export type RemoteVerificationWorkspaceErrorCode =
  | "invalid_input"
  | "source_unavailable"
  | "commit_unavailable"
  | "workspace_conflict"
  | "workspace_invalid"
  | "cleanup_failed";

export class RemoteVerificationWorkspaceError extends Error {
  constructor(readonly code: RemoteVerificationWorkspaceErrorCode, message: string) {
    super(message);
    this.name = "RemoteVerificationWorkspaceError";
  }
}

function executeGit(args: string[], signal: AbortSignal, timeout: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile("git", args, { encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024, signal }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(String(stdout));
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class SystemRemoteVerificationWorkspacePreparer implements RemoteVerificationWorkspacePreparer {
  private readonly root: string;

  constructor(
    workspaceRoot: string,
    private readonly admission: GitCommandAdmission,
  ) {
    this.root = resolve(workspaceRoot);
  }

  async prepare(input: PrepareRemoteVerificationWorkspaceInput): Promise<RemoteVerificationWorkspace> {
    const requestId = this.identifier(input.requestId, "Identyfikator zlecenia");
    const sourceRemote = this.identifier(input.sourceRemote, "Nazwa źródłowego remote");
    const commitSha = input.commitSha.trim().toLowerCase();
    if (!COMMIT_SHA.test(commitSha)) {
      throw new RemoteVerificationWorkspaceError("invalid_input", "Wymagany jest pełny identyfikator commita Git.");
    }

    const repositoryPath = await this.canonicalRepository(input.repositoryPath);
    const root = await this.ensureRoot();
    const target = join(root, requestId);
    if (await exists(target)) {
      throw new RemoteVerificationWorkspaceError("workspace_conflict", "Workspace zlecenia już istnieje.");
    }

    const remotes = (await this.git(["-C", repositoryPath, "remote"], 5_000))
      .split(/\r?\n/).filter(Boolean);
    if (!remotes.includes(sourceRemote)) {
      throw new RemoteVerificationWorkspaceError("source_unavailable", "Skonfigurowane źródło projektu nie jest dostępne na workerze.");
    }

    try {
      await this.git(["-C", repositoryPath, "fetch", "--no-tags", "--prune", "--", sourceRemote], 120_000);
    } catch {
      throw new RemoteVerificationWorkspaceError("source_unavailable", "Nie udało się pobrać skonfigurowanego źródła projektu.");
    }

    let resolvedCommit: string;
    try {
      resolvedCommit = (await this.git(["-C", repositoryPath, "rev-parse", "--verify", `${commitSha}^{commit}`], 5_000)).trim();
    } catch {
      throw new RemoteVerificationWorkspaceError("commit_unavailable", "Żądany commit nie jest dostępny w skonfigurowanym źródle.");
    }
    const containingRefs = (await this.git([
      "-C", repositoryPath, "for-each-ref", "--format=%(refname)", `--contains=${resolvedCommit}`,
      `refs/remotes/${sourceRemote}/`,
    ], 10_000)).trim();
    if (!containingRefs) {
      throw new RemoteVerificationWorkspaceError("commit_unavailable", "Żądany commit nie jest dostępny w skonfigurowanym źródle.");
    }

    let added = false;
    try {
      await this.git(["-C", repositoryPath, "worktree", "add", "--detach", target, resolvedCommit], 60_000);
      added = true;
      const executedCommitSha = (await this.git(["-C", target, "rev-parse", "HEAD"], 5_000)).trim().toLowerCase();
      const status = await this.git(["-C", target, "status", "--porcelain=v1", "--untracked-files=all"], 10_000);
      if (executedCommitSha !== commitSha || status.length > 0) {
        throw new RemoteVerificationWorkspaceError("workspace_invalid", "Przygotowany workspace nie odpowiada żądanemu commitowi.");
      }
      return {
        requestId,
        path: await realpath(target),
        repositoryPath,
        sourceRemote,
        requestedCommitSha: commitSha,
        executedCommitSha,
      };
    } catch (error) {
      if (added) {
        try {
          await this.removeWorktree(repositoryPath, target);
        } catch {
          throw new RemoteVerificationWorkspaceError("cleanup_failed", "Nie udało się posprzątać nieprawidłowego workspace zlecenia.");
        }
      } else if (await exists(target)) {
        await rm(target, { recursive: true, force: true });
      }
      if (error instanceof RemoteVerificationWorkspaceError) throw error;
      throw new RemoteVerificationWorkspaceError("workspace_invalid", "Nie udało się przygotować workspace dla zlecenia.");
    }
  }

  async cleanup(workspace: RemoteVerificationWorkspace): Promise<void> {
    const requestId = this.identifier(workspace.requestId, "Identyfikator zlecenia");
    const root = await this.ensureRoot();
    const target = join(root, requestId);
    if (resolve(workspace.path) !== target) {
      throw new RemoteVerificationWorkspaceError("invalid_input", "Workspace nie należy do katalogu zleceń kontrolera.");
    }
    const repositoryPath = await this.canonicalRepository(workspace.repositoryPath);
    const registered = (await this.git(["-C", repositoryPath, "worktree", "list", "--porcelain", "-z"], 10_000))
      .split("\0").some((entry) => entry === `worktree ${target}`);
    if (!registered && !await exists(target)) return;
    try {
      await this.removeWorktree(repositoryPath, target);
    } catch {
      throw new RemoteVerificationWorkspaceError("cleanup_failed", "Nie udało się bezpiecznie usunąć workspace zlecenia.");
    }
  }

  private identifier(value: string, label: string): string {
    if (typeof value !== "string" || !IDENTIFIER.test(value.trim())) {
      throw new RemoteVerificationWorkspaceError("invalid_input", `${label} ma nieprawidłowy format.`);
    }
    return value.trim();
  }

  private async canonicalRepository(path: string): Promise<string> {
    try {
      const canonical = await realpath(path);
      const topLevel = (await this.git(["-C", canonical, "rev-parse", "--show-toplevel"], 5_000)).trim();
      if (await realpath(topLevel) !== canonical) throw new Error("not root");
      return canonical;
    } catch {
      throw new RemoteVerificationWorkspaceError("invalid_input", "Skonfigurowana ścieżka projektu nie jest katalogiem głównym repozytorium Git.");
    }
  }

  private async ensureRoot(): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new RemoteVerificationWorkspaceError("invalid_input", "Katalog workspace zleceń musi być zwykłym katalogiem.");
    }
    return realpath(this.root);
  }

  private git(args: string[], timeout: number): Promise<string> {
    return this.admission.run("operational", (signal) => executeGit(args, signal, timeout));
  }

  private removeWorktree(repositoryPath: string, target: string): Promise<string> {
    return this.git(["-C", repositoryPath, "worktree", "remove", "--force", target], 30_000);
  }
}
