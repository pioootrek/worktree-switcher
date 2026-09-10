import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GitCommandAdmission, SystemGitWorktreeReader } from "@/server/git-worktrees";
import { SystemRemoteVerificationWorkspacePreparer } from "./remote-verification-workspace";

const directories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function fixture(): {
  firstCommit: string;
  remote: string;
  root: string;
  seed: string;
  worker: string;
  workspaceRoot: string;
} {
  const root = mkdtempSync(join(tmpdir(), "worktree-switcher-remote-workspace-"));
  directories.push(root);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const worker = join(root, "worker");
  const workspaceRoot = join(root, "run-workspaces");

  execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  git(seed, "config", "user.email", "test@example.invalid");
  git(seed, "config", "user.name", "Test");
  writeFileSync(join(seed, "revision.txt"), "first\n");
  git(seed, "add", "revision.txt");
  git(seed, "commit", "-qm", "first");
  const firstCommit = git(seed, "rev-parse", "HEAD");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "-u", "origin", "main");
  execFileSync("git", ["clone", "-q", remote, worker]);

  writeFileSync(join(seed, "revision.txt"), "second\n");
  git(seed, "commit", "-qam", "second");
  git(seed, "push", "-q", "origin", "main");
  return { firstCommit, remote, root, seed, worker, workspaceRoot };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SystemRemoteVerificationWorkspacePreparer", () => {
  it("executes the requested remote commit after its branch advances without moving the development checkout", async () => {
    const setup = fixture();
    mkdirSync(setup.workspaceRoot);
    writeFileSync(join(setup.workspaceRoot, "unrelated.txt"), "keep\n");
    writeFileSync(join(setup.worker, "local-edit.txt"), "do not touch\n");
    const developmentHead = git(setup.worker, "rev-parse", "HEAD");
    const preparer = new SystemRemoteVerificationWorkspacePreparer(setup.workspaceRoot, new GitCommandAdmission());

    const workspace = await preparer.prepare({
      requestId: "request-1",
      repositoryPath: setup.worker,
      sourceRemote: "origin",
      commitSha: setup.firstCommit,
    });

    expect(workspace.executedCommitSha).toBe(setup.firstCommit);
    expect(git(workspace.path, "rev-parse", "HEAD")).toBe(setup.firstCommit);
    expect(git(workspace.path, "branch", "--show-current")).toBe("");
    expect(git(workspace.path, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(workspace.path, "revision.txt"), "utf8")).toBe("first\n");
    expect(git(setup.worker, "rev-parse", "HEAD")).toBe(developmentHead);
    expect(readFileSync(join(setup.worker, "local-edit.txt"), "utf8")).toBe("do not touch\n");
    const discovered = await new SystemGitWorktreeReader().list(setup.worker);
    expect(discovered.map(({ path }) => path)).toEqual([setup.worker]);

    rmSync(workspace.path, { recursive: true, force: true });
    await preparer.cleanup(workspace);
    const recreated = await preparer.prepare({
      requestId: "request-1",
      repositoryPath: setup.worker,
      sourceRemote: "origin",
      commitSha: setup.firstCommit,
    });
    await preparer.cleanup(recreated);
    await preparer.cleanup(recreated);
    expect(existsSync(workspace.path)).toBe(false);
    expect(readFileSync(join(setup.workspaceRoot, "unrelated.txt"), "utf8")).toBe("keep\n");
  });

  it("rejects a missing source and an unavailable commit without falling back to branch HEAD", async () => {
    const setup = fixture();
    const preparer = new SystemRemoteVerificationWorkspacePreparer(setup.workspaceRoot, new GitCommandAdmission());

    await expect(preparer.prepare({
      requestId: "request-missing-source",
      repositoryPath: setup.worker,
      sourceRemote: "upstream",
      commitSha: setup.firstCommit,
    })).rejects.toMatchObject({ code: "source_unavailable" });
    await expect(preparer.prepare({
      requestId: "request-missing-commit",
      repositoryPath: setup.worker,
      sourceRemote: "origin",
      commitSha: "f".repeat(40),
    })).rejects.toMatchObject({ code: "commit_unavailable" });
    expect(existsSync(join(setup.workspaceRoot, "request-missing-source"))).toBe(false);
    expect(existsSync(join(setup.workspaceRoot, "request-missing-commit"))).toBe(false);
  });

  it("rejects a commit that exists locally but is not reachable from the authorized remote", async () => {
    const setup = fixture();
    git(setup.worker, "config", "user.email", "test@example.invalid");
    git(setup.worker, "config", "user.name", "Test");
    writeFileSync(join(setup.worker, "local-only.txt"), "local\n");
    git(setup.worker, "add", "local-only.txt");
    git(setup.worker, "commit", "-qm", "local only");
    const localCommit = git(setup.worker, "rev-parse", "HEAD");
    const preparer = new SystemRemoteVerificationWorkspacePreparer(setup.workspaceRoot, new GitCommandAdmission());

    await expect(preparer.prepare({
      requestId: "request-local-only",
      repositoryPath: setup.worker,
      sourceRemote: "origin",
      commitSha: localCommit,
    })).rejects.toMatchObject({ code: "commit_unavailable" });
    expect(existsSync(join(setup.workspaceRoot, "request-local-only"))).toBe(false);
  });

  it("rejects path-like request identifiers and refuses cleanup outside its owned root", async () => {
    const setup = fixture();
    const preparer = new SystemRemoteVerificationWorkspacePreparer(setup.workspaceRoot, new GitCommandAdmission());

    await expect(preparer.prepare({
      requestId: "../escape",
      repositoryPath: setup.worker,
      sourceRemote: "origin",
      commitSha: setup.firstCommit,
    })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(preparer.cleanup({
      requestId: "request-1",
      path: setup.worker,
      repositoryPath: setup.worker,
      sourceRemote: "origin",
      requestedCommitSha: setup.firstCommit,
      executedCommitSha: setup.firstCommit,
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(existsSync(setup.worker)).toBe(true);
  });

  it("maps an unavailable Git admission boundary to a stable error code", async () => {
    const setup = fixture();
    const admission = new GitCommandAdmission();
    admission.close();
    const preparer = new SystemRemoteVerificationWorkspacePreparer(setup.workspaceRoot, admission);

    await expect(preparer.prepare({
      requestId: "request-closed",
      repositoryPath: setup.worker,
      sourceRemote: "origin",
      commitSha: setup.firstCommit,
    })).rejects.toMatchObject({ code: "operation_unavailable" });
  });
});
