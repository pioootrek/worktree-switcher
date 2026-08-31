import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteStateStore } from "./sqlite-store";
import { AllowlistedWorktreeCacheCleaner, FilesystemWorktreeDiskScanner, WorktreeStorageManager, type WorktreeDiskScanner } from "./worktree-storage";

const directories: string[] = [];

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
    const manager = new WorktreeStorageManager(store, scanner);
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
