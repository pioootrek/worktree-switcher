import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project, RuntimeSnapshot, TestEnvironmentProfile, Worktree } from "@/shared/contracts";
import { ControlService } from "./control-service";
import type { GitWorktreeReader } from "./git-worktrees";
import { nullLogWriter } from "./log-writer";
import type { ProcessManager } from "./process-manager";
import { SqliteStateStore } from "./sqlite-store";
import type { ProjectTestCommandResolver } from "./test-command";
import { resolveTestEnvironment, systemEnvironment } from "./test-environment";
import { TestJobManager } from "./test-job-manager";

const directories: string[] = [];
const managers: TestJobManager[] = [];
const stores: SqliteStateStore[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function stoppedRuntime(): RuntimeSnapshot {
  return {
    phase: "stopped", pid: null, worktreePath: null, startedAt: null, error: null, failure: null, logs: [],
    resources: { status: "idle", currentRssBytes: null, peakRssBytes: null, cpuPercent: null, processCount: null, sampledAt: null, sampleAgeSeconds: null, warningThresholdBytes: null, history: [] },
  };
}

function worktreeOf(path: string): Worktree {
  return { path, head: "abcdef123456", shortHead: "abcdef1", branch: "main", detached: false, locked: false, prunable: false, dirty: false };
}

function profile(overrides: Partial<TestEnvironmentProfile> = {}): TestEnvironmentProfile {
  return {
    name: "unit",
    policy: { mode: "clean", serverProfile: null },
    environment: {},
    nodeEnv: "test",
    requiredVariables: [],
    ...overrides,
  };
}

/** Reproduces the WinPath report: a QA server profile selected while unit tests run. */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-test-env-"));
  directories.push(directory);
  const store = new SqliteStateStore(join(directory, "state.sqlite3"));
  stores.push(store);
  const project = store.addProject({ name: "WinPath", repositoryPath: directory, port: 3400, executable: "pnpm", args: ["run", "dev"] });
  store.saveProjectEnvironmentProfile(project.id, {
    name: "qa-shots",
    environment: {
      PLAYWRIGHT_E2E: "1",
      GOOGLE_CALENDAR_E2E_FIXTURES: "1",
      QA_SHOTS_FROZEN_CLOCK_ISO: "2026-01-01T00:00:00.000Z",
    },
  }, "local-user");
  store.selectProjectEnvironmentProfile(project.id, "qa-shots", "local-user");
  const git = { list: vi.fn(async () => [worktreeOf(directory)]), canonicalRepositoryPath: vi.fn(async (path: string) => path) } as unknown as GitWorktreeReader;
  const processes = { snapshot: () => stoppedRuntime() } as unknown as ProcessManager;
  const testCommands = {
    resolve: vi.fn(() => ({
      preset: { id: "node:test", name: "test", adapter: "node" as const, timeoutMs: 10_000 },
      executable: process.execPath,
      args: ["-e", "console.log(JSON.stringify({ names: Object.keys(process.env).sort(), nodeEnv: process.env.NODE_ENV ?? null }))"],
      cwd: directory,
    })),
    discover: vi.fn(() => [{ id: "node:test", name: "test", adapter: "node" as const, timeoutMs: 10_000 }]),
  } as unknown as ProjectTestCommandResolver;
  const tests = new TestJobManager(store, nullLogWriter);
  managers.push(tests);
  const service = new ControlService(store, git, processes, undefined, undefined, undefined, undefined, testCommands, tests);
  return { directory, project: store.getProject(project.id)!, store, service, tests };
}

async function childEnvironment(store: SqliteStateStore, runId: string): Promise<{ names: string[]; nodeEnv: string | null }> {
  await vi.waitFor(() => expect(store.getTestRun(runId)?.phase).toBe("passed"), { timeout: 5_000 });
  const line = store.getTestRun(runId)!.logs.find((entry) => entry.startsWith("{"));
  if (!line) throw new Error(`Test child produced no environment dump: ${store.getTestRun(runId)!.logs.join(" | ")}`);
  return JSON.parse(line) as { names: string[]; nodeEnv: string | null };
}

describe("systemEnvironment", () => {
  it("keeps only allowlisted names and drops everything else", () => {
    expect(systemEnvironment({
      PATH: "/usr/bin", HOME: "/home/dev", LC_ALL: "C", TZ: "UTC",
      PLAYWRIGHT_E2E: "1", AWS_SECRET_ACCESS_KEY: "secret", NODE_OPTIONS: "--inspect", SSH_AUTH_SOCK: "/tmp/agent",
      UNDEFINED_ENTRY: undefined,
    })).toEqual({ PATH: "/usr/bin", HOME: "/home/dev", LC_ALL: "C", TZ: "UTC" });
  });
});

describe("resolveTestEnvironment", () => {
  const project = {
    id: "project-1",
    port: 3400,
    tlsMode: "off",
    environmentProfiles: [{ name: "qa-shots", environment: { PLAYWRIGHT_E2E: "1" } }],
  } as unknown as Project;

  it("keeps a clean profile free of the selected server profile", () => {
    const resolved = resolveTestEnvironment({
      project, worktree: worktreeOf("/code/web"), profile: profile(), controllerEnvironment: { PATH: "/usr/bin", PLAYWRIGHT_E2E: "1" },
    });
    expect(resolved.environment.PLAYWRIGHT_E2E).toBeUndefined();
    expect(resolved.environment.NODE_ENV).toBe("test");
    expect(resolved.mode).toBe("clean");
    expect(resolved.inheritedServerProfile).toBeNull();
    expect(resolved.variableNames).toContain("WORKTREE_SWITCHER_SERVER_URL");
  });

  it("inherits a named server profile only when the policy says so", () => {
    const resolved = resolveTestEnvironment({
      project,
      worktree: worktreeOf("/code/web"),
      profile: profile({ name: "e2e", policy: { mode: "inherit-server-profile", serverProfile: "qa-shots" }, nodeEnv: null }),
      controllerEnvironment: { PATH: "/usr/bin" },
    });
    expect(resolved.environment.PLAYWRIGHT_E2E).toBe("1");
    expect(resolved.environment.NODE_ENV).toBeUndefined();
    expect(resolved.inheritedServerProfile).toBe("qa-shots");
  });

  it("rejects inheritance without an explicit server profile name", () => {
    expect(() => resolveTestEnvironment({
      project,
      worktree: worktreeOf("/code/web"),
      profile: profile({ policy: { mode: "inherit-server-profile", serverProfile: null } }),
      controllerEnvironment: {},
    })).toThrow("wskazywać profil po nazwie");
  });

  it("rejects an unknown server profile and missing required variables", () => {
    expect(() => resolveTestEnvironment({
      project,
      worktree: worktreeOf("/code/web"),
      profile: profile({ policy: { mode: "inherit-server-profile", serverProfile: "missing" } }),
      controllerEnvironment: {},
    })).toThrow("nie istnieje");
    expect(() => resolveTestEnvironment({
      project,
      worktree: worktreeOf("/code/web"),
      profile: profile({ requiredVariables: ["E2E_RESET_DB_CONFIRM"] }),
      controllerEnvironment: {},
    })).toThrow("E2E_RESET_DB_CONFIRM");
  });
});

describe("test runs against a selected server profile", () => {
  it("runs the default unit preset without the selected server profile or controller variables", async () => {
    vi.stubEnv("WINPATH_CONTROLLER_SECRET", "leaked");
    const { store, project, service } = fixture();

    const run = await service.enqueueTest(project.id, project.repositoryPath, "node:test");
    const child = await childEnvironment(store, run.id);

    expect(child.names).not.toContain("PLAYWRIGHT_E2E");
    expect(child.names).not.toContain("GOOGLE_CALENDAR_E2E_FIXTURES");
    expect(child.names).not.toContain("QA_SHOTS_FROZEN_CLOCK_ISO");
    expect(child.names).not.toContain("WINPATH_CONTROLLER_SECRET");
    expect(child.nodeEnv).toBe("test");
    // The whole environment is accounted for; nothing undeclared survives.
    expect(child.names).toEqual([...new Set([
      ...Object.keys(systemEnvironment()),
      "NODE_ENV",
      "WORKTREE_SWITCHER",
      "WORKTREE_SWITCHER_PROJECT_ID",
      "WORKTREE_SWITCHER_SERVER_PORT",
      "WORKTREE_SWITCHER_SERVER_URL",
      "WORKTREE_SWITCHER_TEST_PROFILE",
      "WORKTREE_SWITCHER_WORKTREE_PATH",
    ])].sort());
    const stored = store.getTestRun(run.id)!;
    expect(stored.environmentMode).toBe("clean");
    expect(stored.environmentProfile).toBe("unit");
    expect(stored.inheritedServerProfile).toBeNull();
    expect(stored.environmentVariableNames).toEqual(child.names);
  });

  it("passes the server profile to a preset that explicitly opts in", async () => {
    const { store, project, service } = fixture();
    await service.saveTestEnvironmentProfile(project.id, {
      name: "e2e",
      environment: { E2E_RESET_DB_CONFIRM: "winpath_test" },
      mode: "inherit-server-profile",
      serverProfile: "qa-shots",
      nodeEnv: null,
      requiredVariables: ["PLAYWRIGHT_E2E"],
    });
    await service.assignTestPresetProfile(project.id, "node:test", "e2e");

    const run = await service.enqueueTest(project.id, project.repositoryPath, "node:test");
    const child = await childEnvironment(store, run.id);

    expect(child.names).toContain("PLAYWRIGHT_E2E");
    expect(child.names).toContain("E2E_RESET_DB_CONFIRM");
    expect(child.nodeEnv).toBeNull();
    const stored = store.getTestRun(run.id)!;
    expect(stored.environmentMode).toBe("inherit-server-profile");
    expect(stored.inheritedServerProfile).toBe("qa-shots");
  });

  it("keeps the queued result independent of which server profile is selected", async () => {
    const { store, project, service } = fixture();
    const before = await service.enqueueTest(project.id, project.repositoryPath, "node:test");
    const withQaProfile = await childEnvironment(store, before.id);

    store.saveProjectEnvironmentProfile(project.id, { name: "default", environment: {} }, "local-user");
    store.selectProjectEnvironmentProfile(project.id, "default", "local-user");
    const after = await service.enqueueTest(project.id, project.repositoryPath, "node:test");

    expect((await childEnvironment(store, after.id)).names).toEqual(withQaProfile.names);
  });

  it("rejects a test profile that inherits without naming a server profile", async () => {
    const { project, service } = fixture();
    await expect(service.saveTestEnvironmentProfile(project.id, {
      name: "broken", environment: {}, mode: "inherit-server-profile", serverProfile: null,
    })).rejects.toThrow("jawnej nazwy profilu serwera");
  });
});
