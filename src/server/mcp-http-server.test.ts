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
    tlsMode: "off",
    tlsKeyPath: null,
    tlsCertPath: null,
    tlsCaPath: null,
    executable: "pnpm",
    args: ["run", "dev"],
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
  },
  reservation: null,
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
    const dashboard = vi.fn(async (): Promise<DashboardResponse> => ({ projects: [snapshot] }));
    const claimProject = vi.fn(async () => ({
      reservation,
      leaseToken: "never-return-this-lease-secret",
      snapshot: { ...snapshot, reservation },
      operationError: null,
    }));
    const releaseAgentClaim = vi.fn();
    const service = {
      dashboard,
      projectSnapshot: vi.fn(async () => snapshot),
      claimProject,
      renewAgentClaim: vi.fn(() => reservation),
      releaseAgentClaim,
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
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: "Bearer mcp-test-token-with-enough-entropy" } },
    });
    const client = new Client({ name: "worktree-switcher-test", version: "1.0.0" });
    await client.connect(transport);
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
      "list_projects",
      "get_project_status",
      "list_worktrees",
      "claim_project",
      "renew_project_claim",
      "release_project_claim",
    ]);

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
    await client.callTool({
      name: "release_project_claim",
      arguments: { projectId, reservationId },
    });
    expect(releaseAgentClaim).toHaveBeenCalledOnce();
    await client.close();
  });
});
