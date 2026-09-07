import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Worktree } from "@/shared/contracts";
import type { GitWorktreeReader } from "../../git-worktrees";
import { ProcessManager } from "../../process-manager";
import { SqliteStateStore } from "../../sqlite-store";
import type { WorktreeStorageManager } from "../../worktree-storage";
import { DashboardQueryService, type DashboardQueryOptions } from "./dashboard-query";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(options: DashboardQueryOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-dashboard-query-"));
  directories.push(directory);
  const store = new SqliteStateStore(join(directory, "state.sqlite3"));
  const project = store.addProject({ name: "Web", repositoryPath: "/code/web", port: 3301, executable: "pnpm", args: ["run", "dev"] });
  const worktree: Worktree = {
    path: "/code/web",
    head: "abcdef123456",
    shortHead: "abcdef12",
    branch: "main",
    detached: false,
    locked: false,
    prunable: false,
    dirty: false,
  };
  const list = vi.fn(async () => [worktree]);
  const git = { list } as unknown as GitWorktreeReader;
  const ensureFresh = vi.fn();
  const snapshots = vi.fn(() => []);
  const storage = { ensureFresh, snapshots } as unknown as WorktreeStorageManager;
  const discoverPresets = vi.fn((_project, worktreePath: string) => ({ worktreePath, presets: [], error: null }));
  let now = 1_000;
  const service = new DashboardQueryService({
    store,
    git,
    processes: new ProcessManager(),
    storage,
    discoverPresets,
    capacity: () => ({ enabled: false, limit: 2, used: 0, available: null, holders: [] }),
    testQueue: () => ({ limit: 1, running: 0, queued: 0 }),
  }, { ...options, now: () => now, freshnessMs: options.freshnessMs ?? 30 });
  return { discoverPresets, ensureFresh, list, now: (value: number) => { now = value; }, project, service, store, worktree };
}

describe("DashboardQueryService", () => {
  it("shares cold discovery and never rescans warm metadata merely because it expired", async () => {
    const { discoverPresets, ensureFresh, list, now, service, store } = fixture();
    const [first, second] = await Promise.all([service.dashboard(), service.dashboard()]);
    expect(first.projects[0].worktrees).toHaveLength(1);
    expect(second.projects[0].worktrees).toHaveLength(1);
    expect(list).toHaveBeenCalledOnce();
    expect(discoverPresets).toHaveBeenCalledOnce();
    expect(ensureFresh).toHaveBeenCalledOnce();

    now(50_000);
    const stale = await service.dashboard();
    expect(stale.projects[0].metadata?.status).toBe("stale");
    expect(list).toHaveBeenCalledOnce();
    expect(discoverPresets).toHaveBeenCalledOnce();
    expect(ensureFresh).toHaveBeenCalledOnce();
    store.close();
  });

  it("retains last good display data when an explicit refresh fails", async () => {
    const { list, project, service, store, worktree } = fixture();
    await service.dashboard();
    list.mockRejectedValueOnce(new Error("fixture unavailable"));
    const snapshot = await service.refresh(project);
    expect(snapshot.worktrees).toEqual([worktree]);
    expect(snapshot.metadata).toMatchObject({ status: "stale", error: "fixture unavailable" });
    expect(snapshot.discoveryError).toBe("fixture unavailable");
    store.close();
  });

  it("marks partial status failures as stale and conservatively dirty", async () => {
    const { list, service, store, worktree } = fixture();
    list.mockResolvedValueOnce([{ ...worktree, dirty: true, statusError: "Nie udało się odczytać stanu worktree." }]);
    const snapshot = (await service.dashboard()).projects[0];
    expect(snapshot.worktrees[0]).toMatchObject({ dirty: true, statusError: expect.any(String) });
    expect(snapshot.metadata).toMatchObject({ status: "stale", error: expect.any(String) });
    store.close();
  });

  it("does not let a refresh that was invalidated in flight present itself as fresh", async () => {
    const { list, project, service, store, worktree } = fixture();
    let resolve!: (worktrees: Worktree[]) => void;
    list.mockImplementationOnce(() => new Promise((complete) => { resolve = complete; }));
    const refreshing = service.refresh(project);
    await Promise.resolve();
    service.invalidate(project.repositoryPath);
    resolve([worktree]);
    const snapshot = await refreshing;
    expect(snapshot.metadata?.status).toBe("stale");
    store.close();
  });

  it("returns a controlled unavailable projection when every bounded cache slot is in flight", async () => {
    const { list, service, store, worktree } = fixture({ maxEntries: 1 });
    store.addProject({ name: "API", repositoryPath: "/code/api", port: 3302, executable: "node", args: [] });
    let resolve!: (worktrees: Worktree[]) => void;
    list.mockImplementationOnce(() => new Promise((complete) => { resolve = complete; }));
    const dashboard = service.dashboard();
    await Promise.resolve();
    expect(list).toHaveBeenCalledOnce();
    resolve([worktree]);
    const result = await dashboard;
    expect(result.projects.filter(({ metadata }) => metadata?.status === "unavailable")).toHaveLength(1);
    expect(result.projects.find(({ metadata }) => metadata?.status === "unavailable")?.discoveryError).toContain("zajęta");
    expect(list).toHaveBeenCalledOnce();
    store.close();
  });

  it("serves runtime-only live reads and project summaries without Git, preset, storage scheduling or test history", async () => {
    const { discoverPresets, ensureFresh, list, project, service, store } = fixture();
    const listTestRuns = vi.spyOn(store, "listTestRuns");
    const live = service.live([project.id], ["runtime"]);
    const summaries = service.projectSummaries();
    expect(live.projects).toHaveLength(1);
    expect(live.projects[0].testRuns).toBeUndefined();
    expect(summaries[0].project.testEnvironmentProfiles.length).toBeGreaterThan(0);
    expect(summaries[0].project.testEnvironmentProfiles.every((profile) => !("environment" in profile))).toBe(true);
    expect(listTestRuns).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(discoverPresets).not.toHaveBeenCalled();
    expect(ensureFresh).not.toHaveBeenCalled();
    store.close();
  });
});
