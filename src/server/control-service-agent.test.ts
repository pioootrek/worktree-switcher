import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeSnapshot, Worktree } from "@/shared/contracts";
import { ControlService } from "./control-service";
import type { GitWorktreeReader } from "./git-worktrees";
import type { ProcessManager } from "./process-manager";
import { SqliteStateStore } from "./sqlite-store";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ControlService agent claims", () => {
  it("claims and starts a worktree while blocking human runtime operations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-agent-service-"));
    directories.push(directory);
    const store = new SqliteStateStore(join(directory, "state.sqlite3"));
    const project = store.addProject({
      name: "Web",
      repositoryPath: "/code/web",
      port: 3216,
      executable: "pnpm",
      args: ["run", "dev"],
    });
    const worktree: Worktree = {
      path: "/code/web-feature",
      head: "abc",
      shortHead: "abc",
      branch: "feature",
      detached: false,
      locked: false,
      prunable: false,
      dirty: false,
    };
    const runtime: RuntimeSnapshot = {
      phase: "stopped",
      pid: null,
      worktreePath: null,
      startedAt: null,
      error: null,
      failure: null,
      logs: [],
      resources: { status: "idle", currentRssBytes: null, peakRssBytes: null, cpuPercent: null, processCount: null, sampledAt: null, sampleAgeSeconds: null, warningThresholdBytes: null, history: [] },
    };
    const start = vi.fn(async (_project, path: string) => {
      runtime.phase = "running";
      runtime.worktreePath = path;
    });
    const stop = vi.fn(async () => {
      runtime.phase = "stopped";
      runtime.worktreePath = null;
    });
    const processes = { snapshot: () => ({ ...runtime }), start, stop } as unknown as ProcessManager;
    const git = { list: vi.fn(async () => [worktree]) } as unknown as GitWorktreeReader;
    const service = new ControlService(store, git, processes);

    const claim = await service.claimProject({
      projectId: project.id,
      worktreePath: worktree.path,
      owner: "agent:mcp:session-1",
      reason: "Run tests",
      idempotencyKey: "test-1",
    });
    expect(claim.operationError).toBeNull();
    expect(claim.reservation.worktreePath).toBe(worktree.path);
    expect(start).toHaveBeenCalledOnce();
    await expect(service.operate(project.id, "stop")).rejects.toThrow("agent:mcp:session-1");
    expect(stop).not.toHaveBeenCalled();

    service.releaseAgentClaim(project.id, claim.reservation.id, "agent:mcp:session-1", claim.leaseToken);
    await service.operate(project.id, "stop");
    expect(stop).toHaveBeenCalledOnce();
    store.close();
  });

  it("keeps the claim and returns an explicit error when server startup fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-agent-failure-"));
    directories.push(directory);
    const store = new SqliteStateStore(join(directory, "state.sqlite3"));
    const project = store.addProject({
      name: "Broken",
      repositoryPath: "/code/broken",
      port: 3217,
      executable: "pnpm",
      args: ["run", "dev"],
    });
    const worktree: Worktree = {
      path: "/code/broken",
      head: "def",
      shortHead: "def",
      branch: "main",
      detached: false,
      locked: false,
      prunable: false,
      dirty: false,
    };
    const runtime: RuntimeSnapshot = {
      phase: "failed",
      pid: null,
      worktreePath: worktree.path,
      startedAt: null,
      error: "Dependency missing",
      failure: null,
      logs: [],
      resources: { status: "idle", currentRssBytes: null, peakRssBytes: null, cpuPercent: null, processCount: null, sampledAt: null, sampleAgeSeconds: null, warningThresholdBytes: null, history: [] },
    };
    const processes = {
      snapshot: () => ({ ...runtime }),
      stop: vi.fn(async () => { runtime.phase = "stopped"; }),
      start: vi.fn(async () => { throw new Error("Dependency missing"); }),
    } as unknown as ProcessManager;
    const service = new ControlService(
      store,
      { list: vi.fn(async () => [worktree]) } as unknown as GitWorktreeReader,
      processes,
    );

    const claim = await service.claimProject({
      projectId: project.id,
      worktreePath: worktree.path,
      owner: "agent:mcp:session-2",
      reason: "Diagnose startup",
      idempotencyKey: "failure-1",
    });
    expect(claim.operationError).toBe("Dependency missing");
    expect(store.getActiveReservation(project.id)?.id).toBe(claim.reservation.id);
    store.close();
  });
});
