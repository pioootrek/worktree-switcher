import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Worktree } from "@/shared/contracts";
import { ControlService } from "./control-service";
import type { GitWorktreeReader } from "./git-worktrees";
import type { ProcessManager } from "./process-manager";
import { SqliteStateStore } from "./sqlite-store";
import type { WorktreeCacheCleaner, WorktreeStorageManager } from "./worktree-storage";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ControlService worktree storage", () => {
  it("queues only paths discovered for the registered repository", async () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-storage-service-"));
    directories.push(directory);
    const store = new SqliteStateStore(join(directory, "state.sqlite3"));
    const project = store.addProject({ name: "Web", repositoryPath: "/code/web", port: 3301, executable: "pnpm", args: ["run", "dev"] });
    const worktree: Worktree = {
      path: "/code/web",
      head: "abc",
      shortHead: "abc",
      branch: "main",
      detached: false,
      locked: false,
      prunable: false,
      dirty: false,
    };
    const git = { list: vi.fn(async () => [worktree]) } as unknown as GitWorktreeReader;
    const snapshot = vi.fn(() => ({ phase: "stopped", worktreePath: worktree.path }));
    const processes = { snapshot } as unknown as ProcessManager;
    const queue = vi.fn();
    const storage = { queue, isBusy: vi.fn(() => false) } as unknown as WorktreeStorageManager;
    const remove = vi.fn(async () => ({ cache: "next" as const, worktreePath: worktree.path, removed: true }));
    const cleaner = { remove } as unknown as WorktreeCacheCleaner;
    const service = new ControlService(store, git, processes, undefined, undefined, storage, cleaner);
    const recordProjectEvent = vi.spyOn(store, "recordProjectEvent");

    await service.refreshWorktreeStorage(project.id, worktree.path);
    expect(queue).toHaveBeenCalledWith(project.id, worktree.path, true);
    await expect(service.refreshWorktreeStorage(project.id, "/etc")).rejects.toThrow("nie należy");
    expect(queue).toHaveBeenCalledOnce();

    await expect(service.deleteWorktreeCache(project.id, worktree.path, "next")).resolves.toMatchObject({ removed: true });
    expect(remove).toHaveBeenCalledWith(worktree.path, "next");
    expect(queue).toHaveBeenLastCalledWith(project.id, worktree.path, true);
    expect(recordProjectEvent).toHaveBeenCalledWith(
      project.id,
      "worktree_cache.delete_succeeded",
      "local-user",
      expect.objectContaining({ cache: "next", removed: true }),
    );

    snapshot.mockReturnValue({ phase: "running", worktreePath: worktree.path });
    await expect(service.deleteWorktreeCache(project.id, worktree.path, "next")).rejects.toThrow("Zatrzymaj serwer");
    snapshot.mockReturnValue({ phase: "stopped", worktreePath: worktree.path });
    store.acquireReservation({ projectId: project.id, worktreePath: worktree.path, kind: "human", owner: "local-user" });
    await expect(service.deleteWorktreeCache(project.id, worktree.path, "next")).rejects.toThrow("Zwolnij blokadę");
    expect(remove).toHaveBeenCalledOnce();
    expect(recordProjectEvent).toHaveBeenCalledWith(
      project.id,
      "worktree_cache.delete_failed",
      "local-user",
      expect.objectContaining({ error: expect.stringContaining("Zwolnij blokadę") }),
    );
    store.close();
  });
});
