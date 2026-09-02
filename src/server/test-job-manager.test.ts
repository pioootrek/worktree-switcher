import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { TestCommand } from "./test-command";
import type { Worktree } from "@/shared/contracts";
import { nullLogWriter } from "./log-writer";
import { SqliteStateStore } from "./sqlite-store";
import { TestJobManager } from "./test-job-manager";

const directories: string[] = [];
const managers: TestJobManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-test-queue-"));
  directories.push(directory);
  const store = new SqliteStateStore(join(directory, "state.sqlite3"));
  const project = store.addProject({ name: "App", repositoryPath: directory, port: 3210, executable: "node", args: [] });
  const manager = new TestJobManager(store, nullLogWriter);
  managers.push(manager);
  const worktree = (path: string): Worktree => ({
    path, head: "abcdef123456", shortHead: "abcdef1", branch: "main", detached: false, locked: false, prunable: false, dirty: false,
  });
  const command = (delay: number): TestCommand => ({
    preset: { id: "node:test", name: "test", adapter: "node", timeoutMs: 5_000 },
    executable: process.execPath,
    args: ["-e", `setTimeout(() => process.exit(0), ${delay})`],
    cwd: directory,
  });
  return { store, project, manager, worktree, command };
}

describe("TestJobManager", () => {
  it("honors the global limit and runs at most one test per worktree", async () => {
    const { store, project, manager, worktree, command } = fixture();
    manager.setLimit(2);
    const first = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/a"), command: command(250), environment: {}, actor: "local-user" });
    const second = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/a"), command: command(10), environment: {}, actor: "local-user" });
    const third = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/b"), command: command(250), environment: {}, actor: "local-user" });

    await vi.waitFor(() => expect(manager.status()).toMatchObject({ running: 2, queued: 1 }));
    expect(store.getTestRun(first.id)?.phase).toBe("running");
    expect(store.getTestRun(second.id)?.phase).toBe("queued");
    expect(store.getTestRun(third.id)?.phase).toBe("running");
    await vi.waitFor(() => expect(store.getTestRun(second.id)?.phase).toBe("passed"), { timeout: 3_000 });
    await manager.shutdown();
    store.close();
    managers.splice(managers.indexOf(manager), 1);
  });

  it("does not stop active runs when the global limit is lowered", async () => {
    const { store, project, manager, worktree, command } = fixture();
    manager.setLimit(2);
    const first = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/a"), command: command(250), environment: {}, actor: "local-user" });
    const second = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/b"), command: command(250), environment: {}, actor: "local-user" });

    await vi.waitFor(() => expect(manager.status()).toMatchObject({ running: 2, queued: 0 }));
    manager.setLimit(1);
    const third = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/c"), command: command(10), environment: {}, actor: "local-user" });

    expect(store.getTestRun(first.id)?.phase).toBe("running");
    expect(store.getTestRun(second.id)?.phase).toBe("running");
    expect(store.getTestRun(third.id)?.phase).toBe("queued");
    await vi.waitFor(() => expect(store.getTestRun(third.id)?.phase).toBe("passed"), { timeout: 3_000 });
    await manager.shutdown();
    store.close();
    managers.splice(managers.indexOf(manager), 1);
  });

  it("cancels queued and running jobs and restricts agent cancellation to the author", async () => {
    const { store, project, manager, worktree, command } = fixture();
    const running = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/a"), command: command(2_000), environment: {}, actor: "agent:mcp:one" });
    const queued = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/b"), command: command(20), environment: {}, actor: "agent:mcp:one" });
    await vi.waitFor(() => expect(store.getTestRun(running.id)?.phase).toBe("running"));
    expect(() => manager.cancel(running.id, "agent:mcp:other")).toThrow("autor");
    expect(manager.cancel(queued.id, "agent:mcp:one").phase).toBe("cancelled");
    expect(manager.cancel(running.id, "agent:mcp:one").phase).toBe("cancelled");
    await vi.waitFor(() => expect(manager.status().running).toBe(0));
    expect(store.getTestRun(running.id)?.phase).toBe("cancelled");
    await manager.shutdown();
    store.close();
    managers.splice(managers.indexOf(manager), 1);
  });

  it("deduplicates agent retries by actor and idempotency key", async () => {
    const { store, project, manager, worktree, command } = fixture();
    const input = { projectId: project.id, worktree: worktree("/tmp/a"), command: command(20), environment: {}, actor: "agent:mcp:one", idempotencyKey: "attempt-1" };
    const first = manager.enqueue(input);
    expect(manager.enqueue(input).id).toBe(first.id);
    expect(() => manager.enqueue({ ...input, command: { ...input.command, preset: { ...input.command.preset, id: "node:build" } } })).toThrow("idempotencji");
    manager.cancel(first.id, "local-user");
    await manager.shutdown();
    store.close();
    managers.splice(managers.indexOf(manager), 1);
  });

  it("terminates a run after its preset timeout", async () => {
    const { store, project, manager, worktree, command } = fixture();
    const slow = command(2_000);
    slow.preset.timeoutMs = 30;
    const run = manager.enqueue({ projectId: project.id, worktree: worktree("/tmp/a"), command: slow, environment: {}, actor: "local-user" });
    await vi.waitFor(() => expect(store.getTestRun(run.id)?.phase).toBe("timed_out"), { timeout: 2_000 });
    await manager.shutdown();
    store.close();
    managers.splice(managers.indexOf(manager), 1);
  });
});
