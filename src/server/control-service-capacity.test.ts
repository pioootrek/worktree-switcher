import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project, RuntimeSnapshot, Worktree } from "@/shared/contracts";
import { ControlService } from "./control-service";
import type { GitWorktreeReader } from "./git-worktrees";
import type { ProcessManager } from "./process-manager";
import { SqliteStateStore } from "./sqlite-store";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function stoppedRuntime(): RuntimeSnapshot {
  return {
    phase: "stopped", pid: null, worktreePath: null, startedAt: null, error: null, failure: null, logs: [],
    resources: { status: "idle", currentRssBytes: null, peakRssBytes: null, cpuPercent: null, processCount: null, sampledAt: null, sampleAgeSeconds: null, warningThresholdBytes: null, history: [] },
  };
}

function fixture(count = 3, onStart: (project: Project) => Promise<void> = async () => undefined) {
  const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-capacity-"));
  directories.push(directory);
  const store = new SqliteStateStore(join(directory, "state.sqlite3"));
  const projects = Array.from({ length: count }, (_, index) => store.addProject({
    name: `Project ${index + 1}`,
    repositoryPath: `/code/project-${index + 1}`,
    port: 3300 + index,
    executable: "pnpm",
    args: ["run", "dev"],
  }));
  const worktrees = new Map(projects.map((project) => [project.repositoryPath, [{
    path: project.repositoryPath,
    head: `head-${project.id}`,
    shortHead: "abc1234",
    branch: "main",
    detached: false,
    locked: false,
    prunable: false,
    dirty: false,
  } satisfies Worktree]]));
  const runtimes = new Map(projects.map((project) => [project.id, stoppedRuntime()]));
  const start = vi.fn(async (project: Project, path: string) => {
    const runtime = runtimes.get(project.id)!;
    runtime.phase = "starting";
    runtime.worktreePath = path;
    try {
      await onStart(project);
      runtime.phase = "running";
      runtime.pid = 1000 + projects.indexOf(project);
    } catch (error) {
      runtime.phase = "failed";
      runtime.pid = null;
      throw error;
    }
  });
  const stop = vi.fn(async (projectId: string) => {
    const runtime = runtimes.get(projectId)!;
    runtime.phase = "stopping";
    runtime.phase = "stopped";
    runtime.pid = null;
  });
  const processes = {
    snapshot: (projectId: string) => ({ ...runtimes.get(projectId)! }),
    start,
    stop,
    stopAll: vi.fn(async () => undefined),
  } as unknown as ProcessManager;
  const git = {
    list: vi.fn(async (repositoryPath: string) => worktrees.get(repositoryPath) ?? []),
  } as unknown as GitWorktreeReader;
  return { service: new ControlService(store, git, processes), store, projects, runtimes, start, stop, worktrees };
}

describe("ControlService server capacity", () => {
  it("rejects a third server at capacity two and keeps existing servers when the limit is lowered", async () => {
    const { service, store, projects, start } = fixture();
    service.setServerCapacity({ enabled: true, limit: 2 });
    await service.operate(projects[0].id, "start");
    await service.operate(projects[1].id, "start");

    await expect(service.operate(projects[2].id, "start")).rejects.toThrow("limit 2");
    expect(start).toHaveBeenCalledTimes(2);
    expect(service.serverCapacity()).toMatchObject({ used: 2, available: 0 });

    service.setServerCapacity({ enabled: true, limit: 1 });
    expect(service.serverCapacity()).toMatchObject({ limit: 1, used: 2, available: 0 });
    expect(projects.slice(0, 2).map(({ id }) => service.serverCapacity().holders.some((holder) => holder.projectId === id)))
      .toEqual([true, true]);
    store.close();
  });

  it("atomically grants the last slot to only one concurrent start", async () => {
    let releaseStart!: () => void;
    const heldStart = new Promise<void>((resolve) => { releaseStart = resolve; });
    const { service, store, projects, runtimes, start } = fixture(2, async (project) => {
      if (project.id === projects[0].id) await heldStart;
    });
    service.setServerCapacity({ enabled: true, limit: 1 });

    const first = service.operate(projects[0].id, "start");
    await vi.waitFor(() => expect(runtimes.get(projects[0].id)?.phase).toBe("starting"));
    await expect(service.operate(projects[1].id, "start")).rejects.toThrow("limit 1");
    expect(start).toHaveBeenCalledTimes(1);
    releaseStart();
    await first;
    store.close();
  });

  it("retains one slot while switching a running project", async () => {
    const { service, store, projects, worktrees, start, stop } = fixture(1);
    const alternate = { ...worktrees.get(projects[0].repositoryPath)![0], path: `${projects[0].repositoryPath}-feature`, branch: "feature" };
    worktrees.get(projects[0].repositoryPath)!.push(alternate);
    service.setServerCapacity({ enabled: true, limit: 1 });
    await service.operate(projects[0].id, "start");

    await service.operate(projects[0].id, "switch", alternate.path);

    expect(stop).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledTimes(2);
    expect(service.serverCapacity()).toMatchObject({ used: 1, available: 0 });
    store.close();
  });

  it("releases a slot after a failed start", async () => {
    const { service, store, projects, start } = fixture(2, async (project) => {
      if (project.id === projects[0].id) throw new Error("broken start");
    });
    service.setServerCapacity({ enabled: true, limit: 1 });

    await expect(service.operate(projects[0].id, "start")).rejects.toThrow("broken start");
    await expect(service.operate(projects[1].id, "start")).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledTimes(2);
    expect(service.serverCapacity().holders.map(({ projectId }) => projectId)).toEqual([projects[1].id]);
    store.close();
  });
});
