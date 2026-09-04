import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardResponse, ProjectSnapshot, Reservation } from "@/shared/contracts";
import type { ControlService } from "./control-service";
import { createMcpControllerServer, type McpControllerServer } from "./mcp-http-server";

const controllers: McpControllerServer[] = [];

const projectId = "09ca1e75-1f7a-4bb5-a607-a0af3a785260";
const reservationId = "a3a76c68-c531-4dc8-838a-88416746a581";
const snapshot: ProjectSnapshot = {
  project: {
    id: projectId,
    name: "Web",
    repositoryPath: "/code/web",
    port: 3000,
    launchPreset: "node",
    tlsMode: "off",
    tlsKeyPath: null,
    tlsCertPath: null,
    tlsCaPath: null,
    executable: "pnpm",
    args: ["run", "dev"],
    environment: {},
    environmentProfiles: [{ name: "default", environment: {} }],
    selectedEnvironmentProfile: "default",
    testEnvironmentProfiles: [],
    testPresetProfiles: {},
    healthcheckPath: "/",
    startupTimeoutMs: 45_000,
    selectedWorktreePath: "/code/web",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  },
  runtime: {
    phase: "running",
    pid: 123,
    worktreePath: "/code/web",
    startedAt: "2026-08-29T00:00:00.000Z",
    error: null,
    failure: null,
    logs: [],
    resources: { status: "available", currentRssBytes: 128_000_000, peakRssBytes: 140_000_000, cpuPercent: 12.5, processCount: 3, sampledAt: "2026-08-29T00:00:05.000Z", sampleAgeSeconds: 0, warningThresholdBytes: null, history: [] },
  },
  reservation: null,
  storage: [{
    worktreePath: "/code/web",
    status: "available",
    totalBytes: 1_000_000,
    nextBytes: 400_000,
    nextCacheBytes: 300_000,
    nodeModulesBytes: 200_000,
    otherBytes: 400_000,
    measuredAt: "2026-08-30T08:00:00.000Z",
    topDirectories: [{ name: ".next", bytes: 400_000 }],
    history: [],
    error: null,
  }],
  testPresets: [{ worktreePath: "/code/web", presets: [{ id: "node:test", name: "test", adapter: "node", timeoutMs: 900_000, profile: "unit" }], error: null }],
  testRuns: [],
  worktrees: [{
    path: "/code/web",
    head: "abc",
    shortHead: "abc",
    branch: "main",
    detached: false,
    locked: false,
    prunable: false,
    dirty: false,
  }],
};

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.close()));
});

describe("MCP loopback server", () => {
  it("authenticates clients, exposes project tools, and keeps lease tokens out of tool results", async () => {
    const reservation: Reservation = {
      id: reservationId,
      projectId,
      worktreePath: "/code/web",
      kind: "agent",
      owner: "agent:mcp:test",
      reason: "Test",
      createdAt: "2026-08-29T00:00:00.000Z",
      expiresAt: "2026-08-29T00:30:00.000Z",
      maximumExpiresAt: "2026-08-29T08:00:00.000Z",
    };
    const capacity = { enabled: true, limit: 2, used: 1, available: 1, holders: [{ projectId, projectName: "Web", phase: "running" as const }] };
    const testQueue = { limit: 1, running: 0, queued: 0 };
    const dashboard = vi.fn(async (): Promise<DashboardResponse> => ({ projects: [snapshot], capacity, testQueue }));
    const claimProject = vi.fn(async () => ({
      reservation,
      leaseToken: "never-return-this-lease-secret",
      snapshot: { ...snapshot, reservation },
      operationError: null,
    }));
    const releaseAgentClaim = vi.fn();
    const setProjectEnvironment = vi.fn(() => ({ ...snapshot.project, environment: { PLAYWRIGHT_E2E: "1" } }));
    const saveEnvironmentProfile = vi.fn(async () => snapshot.project);
    const selectEnvironmentProfile = vi.fn(async () => snapshot.project);
    const deleteEnvironmentProfile = vi.fn(() => snapshot.project);
    const testEnvironmentProfiles = vi.fn(() => ({
      profiles: [{ name: "e2e", policy: { mode: "inherit-server-profile" as const, serverProfile: "qa-shots" }, nodeEnv: null, requiredVariables: [], variableNames: ["E2E_RESET_DB_CONFIRM"] }],
      presetProfiles: { "node:test": "e2e" },
      systemVariableNames: ["PATH"],
    }));
    const saveTestEnvironmentProfile = vi.fn(async () => snapshot.project);
    const assignTestPresetProfile = vi.fn(async () => snapshot.project);
    const queuedRun = { id: "f70af07d-d065-41a7-8918-c61ca5a2b833", phase: "queued" as const };
    const enqueueTest = vi.fn(async () => queuedRun);
    const testRun = vi.fn(() => queuedRun);
    const cancelTest = vi.fn(() => ({ ...queuedRun, phase: "cancelled" as const }));
    const service = {
      dashboard,
      serverCapacity: vi.fn(() => capacity),
      testQueueStatus: vi.fn(() => testQueue),
      projectSnapshot: vi.fn(async () => snapshot),
      enqueueTest,
      testRun,
      cancelTest,
      claimProject,
      renewAgentClaim: vi.fn(() => reservation),
      releaseAgentClaim,
      setProjectEnvironment,
      saveEnvironmentProfile,
      selectEnvironmentProfile,
      deleteEnvironmentProfile,
      testEnvironmentProfiles,
      saveTestEnvironmentProfile,
      assignTestPresetProfile,
    } as unknown as ControlService;
    const controller = createMcpControllerServer({ service, port: 0, accessToken: "mcp-test-token-with-enough-entropy" });
    controllers.push(controller);
    await new Promise<void>((resolve, reject) => {
      controller.server.once("error", reject);
      controller.server.listen(0, "127.0.0.1", resolve);
    });
    const address = controller.server.address() as AddressInfo;
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);

    expect((await fetch(endpoint)).status).toBe(401);
    expect((await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer mcp-test-token-with-enough-entropy",
        Origin: "http://attacker.invalid",
      },
    })).status).toBe(403);
    const staleSession = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer mcp-test-token-with-enough-entropy",
        "Content-Type": "application/json",
        "Mcp-Session-Id": "session-lost-after-controller-restart",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(staleSession.status).toBe(404);
    expect(await staleSession.json()).toMatchObject({ error: { message: "MCP session not found." } });
    const missingSession = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer mcp-test-token-with-enough-entropy",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(missingSession.status).toBe(400);
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: "Bearer mcp-test-token-with-enough-entropy" } },
    });
    const client = new Client({ name: "worktree-switcher-test", version: "1.0.0" });
    await client.connect(transport);
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
      "list_projects",
      "get_server_capacity",
      "get_test_queue",
      "get_project_status",
      "get_project_storage",
      "list_worktrees",
      "list_test_presets",
      "run_test",
      "get_test_run",
      "cancel_test_run",
      "set_project_environment",
      "list_environment_profiles",
      "save_environment_profile",
      "select_environment_profile",
      "delete_environment_profile",
      "list_test_environment_profiles",
      "save_test_environment_profile",
      "delete_test_environment_profile",
      "assign_test_preset_profile",
      "claim_project",
      "renew_project_claim",
      "release_project_claim",
    ]);

    const capacityResult = await client.callTool({ name: "get_server_capacity", arguments: {} });
    const capacityText = (capacityResult as { content: Array<{ type: "text"; text: string }> }).content[0].text;
    expect(JSON.parse(capacityText)).toMatchObject({ enabled: true, limit: 2, used: 1, available: 1 });

    const testQueueResult = await client.callTool({ name: "get_test_queue", arguments: {} });
    const testQueueText = (testQueueResult as { content: Array<{ type: "text"; text: string }> }).content[0].text;
    expect(JSON.parse(testQueueText)).toEqual(testQueue);

    const testPresetsResult = await client.callTool({ name: "list_test_presets", arguments: { projectId } });
    expect(JSON.stringify(testPresetsResult)).toContain("node:test");
    await client.callTool({
      name: "run_test",
      arguments: { projectId, worktreePath: "/code/web", presetId: "node:test", idempotencyKey: "test-job-1" },
    });
    expect(enqueueTest).toHaveBeenCalledWith(projectId, "/code/web", "node:test", {
      owner: expect.stringMatching(/^agent:mcp:/), leaseToken: undefined,
    }, "test-job-1");
    await client.callTool({ name: "get_test_run", arguments: { runId: queuedRun.id } });
    expect(testRun).toHaveBeenCalledWith(queuedRun.id);
    await client.callTool({ name: "cancel_test_run", arguments: { runId: queuedRun.id } });
    expect(cancelTest).toHaveBeenCalledWith(queuedRun.id, { owner: expect.stringMatching(/^agent:mcp:/) });

    const profilesResult = await client.callTool({ name: "list_test_environment_profiles", arguments: { projectId } });
    const profilesText = (profilesResult as { content: Array<{ type: "text"; text: string }> }).content[0].text;
    expect(profilesText).toContain("E2E_RESET_DB_CONFIRM");
    expect(profilesText).not.toContain("winpath_test");
    await client.callTool({
      name: "save_test_environment_profile",
      arguments: { projectId, name: "e2e", environment: { E2E_RESET_DB_CONFIRM: "winpath_test" }, mode: "inherit-server-profile", serverProfile: "qa-shots" },
    });
    expect(saveTestEnvironmentProfile).toHaveBeenCalledWith(projectId, expect.objectContaining({
      name: "e2e", mode: "inherit-server-profile", serverProfile: "qa-shots",
    }), expect.objectContaining({ owner: expect.stringMatching(/^agent:mcp:/) }));
    await client.callTool({ name: "assign_test_preset_profile", arguments: { projectId, presetId: "node:test", name: null } });
    expect(assignTestPresetProfile).toHaveBeenCalledWith(projectId, "node:test", null, expect.objectContaining({
      owner: expect.stringMatching(/^agent:mcp:/),
    }));

    const statusResult = await client.callTool({ name: "get_project_status", arguments: { projectId } });
    const statusText = (statusResult as { content: Array<{ type: "text"; text: string }> }).content[0].text;
    expect(JSON.parse(statusText).runtime.resources).toMatchObject({
      status: "available",
      currentRssBytes: 128_000_000,
      peakRssBytes: 140_000_000,
      cpuPercent: 12.5,
      processCount: 3,
    });
    const storageResult = await client.callTool({ name: "get_project_storage", arguments: { projectId } });
    const storageText = (storageResult as { content: Array<{ type: "text"; text: string }> }).content[0].text;
    expect(JSON.parse(storageText)[0]).toMatchObject({ worktreePath: "/code/web", nextCacheBytes: 300_000 });

    await client.callTool({
      name: "set_project_environment",
      arguments: { projectId, environment: { PLAYWRIGHT_E2E: "1" } },
    });
    expect(setProjectEnvironment).toHaveBeenCalledWith(projectId, { PLAYWRIGHT_E2E: "1" }, {
      owner: expect.stringMatching(/^agent:mcp:/),
      leaseToken: undefined,
    });

    const profiles = await client.callTool({ name: "list_environment_profiles", arguments: { projectId } });
    expect(JSON.stringify(profiles)).toContain("default");
    await client.callTool({ name: "save_environment_profile", arguments: { projectId, name: "e2e", environment: { PLAYWRIGHT_E2E: "1" } } });
    expect(saveEnvironmentProfile).toHaveBeenCalledWith(projectId, "e2e", { PLAYWRIGHT_E2E: "1" }, {
      owner: expect.stringMatching(/^agent:mcp:/),
      leaseToken: undefined,
    });
    await client.callTool({ name: "select_environment_profile", arguments: { projectId, name: "e2e" } });
    expect(selectEnvironmentProfile).toHaveBeenCalled();
    await client.callTool({ name: "delete_environment_profile", arguments: { projectId, name: "e2e" } });
    expect(deleteEnvironmentProfile).toHaveBeenCalled();

    const claim = await client.callTool({
      name: "claim_project",
      arguments: {
        projectId,
        worktreePath: "/code/web",
        reason: "Run tests",
        idempotencyKey: "test-run-1",
      },
    });
    expect(JSON.stringify(claim)).not.toContain("never-return-this-lease-secret");
    expect(JSON.stringify(claim)).toContain("leaseHeld");
    await client.callTool({ name: "save_environment_profile", arguments: { projectId, name: "claimed", environment: { PLAYWRIGHT_E2E: "2" } } });
    expect(saveEnvironmentProfile).toHaveBeenLastCalledWith(projectId, "claimed", { PLAYWRIGHT_E2E: "2" }, {
      owner: expect.stringMatching(/^agent:mcp:/),
      leaseToken: "never-return-this-lease-secret",
    });
    await client.callTool({
      name: "release_project_claim",
      arguments: { projectId, reservationId },
    });
    expect(releaseAgentClaim).toHaveBeenCalledOnce();
    await client.close();
  });
});
