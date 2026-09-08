import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SqliteStateStore } from "./sqlite-store";
import { ProjectLifecycle } from "./modules/lifecycle";
import { AllowlistedWorktreeCacheCleaner, FilesystemWorktreeDiskScanner, WorktreeStorageManager, type WorktreeDiskScanner } from "./worktree-storage";

const directories: string[] = [];

function lifecycle(store: SqliteStateStore): ProjectLifecycle {
  return new ProjectLifecycle(store, { snapshot: vi.fn() });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("FilesystemWorktreeDiskScanner", () => {
  it("counts known caches and top-level directories without following symlinks", async () => {
    const root = mkdtempSync(join(tmpdir(), "worktree-storage-"));
    const external = mkdtempSync(join(tmpdir(), "worktree-storage-external-"));
    directories.push(root, external);
    mkdirSync(join(root, ".next", "cache"), { recursive: true });
    mkdirSync(join(root, "node_modules", "package"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, ".git", "objects"), { recursive: true });
    writeFileSync(join(root, ".next", "cache", "webpack.bin"), Buffer.alloc(32 * 1024));
    writeFileSync(join(root, ".next", "server.js"), Buffer.alloc(16 * 1024));
    writeFileSync(join(root, "node_modules", "package", "index.js"), Buffer.alloc(24 * 1024));
    writeFileSync(join(root, "src", "page.tsx"), Buffer.alloc(4 * 1024));
    writeFileSync(join(root, ".git", "objects", "pack"), Buffer.alloc(256 * 1024));
    writeFileSync(join(external, "large.bin"), Buffer.alloc(256 * 1024));
    symlinkSync(external, join(root, "external-link"));

    const sample = await new FilesystemWorktreeDiskScanner().scan(root);

    expect(sample.totalBytes).toBeGreaterThan(70 * 1024);
    expect(sample.nextBytes).toBeGreaterThan(sample.nextCacheBytes);
    expect(sample.nextCacheBytes).toBeGreaterThanOrEqual(32 * 1024);
    expect(sample.nodeModulesBytes).toBeGreaterThanOrEqual(24 * 1024);
    expect(sample.topDirectories.map(({ name }) => name)).toEqual(expect.arrayContaining([".next", "node_modules", "src"]));
    expect(sample.topDirectories.map(({ name }) => name)).not.toContain("external-link");
    expect(sample.topDirectories.map(({ name }) => name)).not.toContain(".git");
    expect(sample.totalBytes).toBeLessThan(200 * 1024);
  });

  it("serializes scans globally and persists their snapshots", async () => {
    const root = mkdtempSync(join(tmpdir(), "worktree-storage-manager-"));
    directories.push(root);
    const store = new SqliteStateStore(join(root, "state.sqlite3"));
    const project = store.addProject({ name: "App", repositoryPath: "/code/app", port: 3300, executable: "pnpm", args: ["run", "dev"] });
    let active = 0;
    let maximumActive = 0;
    const scanner: WorktreeDiskScanner = {
      scan: async (worktreePath) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { worktreePath, totalBytes: 100, nextBytes: 40, nextCacheBytes: 30, nodeModulesBytes: 20, topDirectories: [] };
      },
    };
    const manager = new WorktreeStorageManager(store, lifecycle(store), scanner);
    manager.queue(project.id, "/code/app", true);
    manager.queue(project.id, "/code/app-feature", true);
    const deadline = Date.now() + 2_000;
    while (!store.getWorktreeStorage(project.id, "/code/app-feature")) {
      if (Date.now() > deadline) throw new Error("Storage scans did not finish");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(maximumActive).toBe(1);
    expect(store.getWorktreeStorage(project.id, "/code/app")?.nextCacheBytes).toBe(30);
    await manager.close();
    store.close();
  });

  it("does not let failed-scan notifications immediately schedule the same scan again", async () => {
    const root = mkdtempSync(join(tmpdir(), "worktree-storage-cooldown-"));
    directories.push(root);
    const store = new SqliteStateStore(join(root, "state.sqlite3"));
    const first = store.addProject({ name: "One", repositoryPath: "/code/one", port: 3300, executable: "pnpm", args: [] });
    const second = store.addProject({ name: "Two", repositoryPath: "/code/two", port: 3301, executable: "pnpm", args: [] });
    const paths = new Map([[first.id, ["/code/one"]], [second.id, ["/code/two"]]]);
    const scan = vi.fn(async () => { throw new Error("fixture unavailable"); });
    const manager = new WorktreeStorageManager(store, lifecycle(store), { scan }, (projectId) => {
      manager.ensureFresh(projectId, paths.get(projectId) ?? []);
    });

    manager.ensureFresh(first.id, paths.get(first.id)!);
    manager.ensureFresh(second.id, paths.get(second.id)!);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(scan).toHaveBeenCalledTimes(2);

    manager.queue(first.id, "/code/one", true);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(3));
    await manager.close();
    store.close();
  });

  it("does not publish or invoke an automatic scan while maintenance owns the worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "worktree-storage-maintenance-"));
    directories.push(root);
    const store = new SqliteStateStore(join(root, "state.sqlite3"));
    const project = store.addProject({ name: "App", repositoryPath: "/code/app", port: 3300, executable: "pnpm", args: [] });
    const authority = lifecycle(store);
    const scan = vi.fn(async (worktreePath: string) => ({ worktreePath, totalBytes: 1, nextBytes: 0, nextCacheBytes: 0, nodeModulesBytes: 0, topDirectories: [] }));
    const manager = new WorktreeStorageManager(store, authority, { scan });
    const release = authority.acquireMaintenance(project.id, "/code/app");

    manager.ensureFresh(project.id, ["/code/app"]);

    expect(scan).not.toHaveBeenCalled();
    expect(manager.isBusy(project.id, "/code/app")).toBe(false);
    expect(manager.snapshots(project.id, ["/code/app"])[0].status).toBe("unmeasured");
    release?.();
    expect(manager.queue(project.id, "/code/app", true)).toBe(true);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledOnce());
    await manager.close();
    store.close();
  });

  it("rejects a facade lifecycle that differs from its scan authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "worktree-storage-lifecycle-"));
    directories.push(root);
    const store = new SqliteStateStore(join(root, "state.sqlite3"));
    const manager = new WorktreeStorageManager(store, lifecycle(store));

    expect(() => manager.assertLifecycle(lifecycle(store))).toThrow("must share one ProjectLifecycle");

    await manager.close();
    store.close();
  });

  it("removes only a regular .next directory and never follows a root symlink", async () => {
    const root = mkdtempSync(join(tmpdir(), "worktree-cache-cleaner-"));
    const external = mkdtempSync(join(tmpdir(), "worktree-cache-external-"));
    directories.push(root, external);
    mkdirSync(join(root, ".next", "cache"), { recursive: true });
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    writeFileSync(join(root, ".next", "cache", "data.bin"), "cache");
    writeFileSync(join(root, "node_modules", "keep.js"), "keep");
    const cleaner = new AllowlistedWorktreeCacheCleaner();

    await expect(cleaner.remove(root, "next")).resolves.toMatchObject({ removed: true });
    expect(existsSync(join(root, ".next"))).toBe(false);
    expect(existsSync(join(root, "node_modules", "keep.js"))).toBe(true);
    await expect(cleaner.remove(root, "next")).resolves.toMatchObject({ removed: false });

    writeFileSync(join(external, "keep.txt"), "external");
    symlinkSync(external, join(root, ".next"));
    await expect(cleaner.remove(root, "next")).rejects.toThrow("zwykłym katalogiem");
    expect(existsSync(join(external, "keep.txt"))).toBe(true);

    mkdirSync(join(external, ".next"), { recursive: true });
    writeFileSync(join(external, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    symlinkSync(external, join(root, "linked-worktree"));
    await expect(cleaner.remove(join(root, "linked-worktree"), "next")).rejects.toThrow("Worktree nie jest zwykłym katalogiem");
    expect(existsSync(join(external, ".next"))).toBe(true);

    rmSync(join(root, ".next"));
    mkdirSync(join(root, ".next"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { vite: "latest" } }));
    await expect(cleaner.remove(root, "next")).rejects.toThrow("tylko dla projektów Next.js");
    expect(existsSync(join(root, ".next"))).toBe(true);
  });
});
