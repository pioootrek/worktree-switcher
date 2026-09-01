import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveAppPaths } from "../server/paths";
import { findAvailablePort, openProjectGateway, runDoctorCommand, runProjectCommand } from "./project-management";
import { writeServiceAccess } from "./service-access";

const directories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function createNodeRepository(withDevScript = true): string {
  const repository = temporaryDirectory("worktree-switcher-cli-repo-");
  execFileSync("git", ["init", "--quiet", repository]);
  writeFileSync(join(repository, "package.json"), JSON.stringify({
    name: "fixture-app",
    scripts: withDevScript ? { dev: "next dev" } : {},
    dependencies: { next: "16.3.3" },
  }));
  return repository;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("project management CLI", () => {
  it("adds, lists, and removes a project through the offline control service", async () => {
    const repository = createNodeRepository();
    const dataDirectory = temporaryDirectory("worktree-switcher-cli-data-");
    const stateDirectory = temporaryDirectory("worktree-switcher-cli-state-");
    const paths = resolveAppPaths(dataDirectory, stateDirectory);
    const output: string[] = [];
    const gateway = await openProjectGateway(paths, "en");
    try {
      await runProjectCommand(["add", repository], gateway, "en", {
        isPortAvailable: async (port) => port === 3001,
        write: (line) => output.push(line),
      });
      const dashboard = await gateway.dashboard();
      expect(dashboard.projects[0].project).toMatchObject({
        name: repository.split("/").at(-1),
        port: 3001,
        launchPreset: "node",
        executable: "npm",
        args: ["run", "dev"],
      });

      await runProjectCommand(["list", "--json"], gateway, "en", { write: (line) => output.push(line) });
      expect(JSON.parse(output.at(-1)!)).toMatchObject([{ port: 3001, runtimePhase: "stopped" }]);

      const projectId = dashboard.projects[0].project.id;
      await runProjectCommand(["remove", projectId], gateway, "en", { write: (line) => output.push(line) });
      expect((await gateway.dashboard()).projects).toEqual([]);
      expect(output.at(-1)).toContain("Removed project");
    } finally {
      await gateway.close();
    }
  });

  it("rejects invalid repositories and missing dev scripts without partial records", async () => {
    const dataDirectory = temporaryDirectory("worktree-switcher-cli-invalid-data-");
    const stateDirectory = temporaryDirectory("worktree-switcher-cli-invalid-state-");
    const gateway = await openProjectGateway(resolveAppPaths(dataDirectory, stateDirectory), "en");
    try {
      const plainDirectory = temporaryDirectory("worktree-switcher-cli-plain-");
      await expect(runProjectCommand(["add", plainDirectory, "--port", "3100"], gateway, "en"))
        .rejects.toThrow("repozytorium Git");
      await expect(runProjectCommand(["add", createNodeRepository(false), "--port", "3101"], gateway, "en"))
        .rejects.toThrow("skryptu dev");
      expect((await gateway.dashboard()).projects).toEqual([]);
    } finally {
      await gateway.close();
    }
  });

  it("reports a healthy fresh installation", async () => {
    const dataDirectory = temporaryDirectory("worktree-switcher-cli-doctor-data-");
    const stateDirectory = temporaryDirectory("worktree-switcher-cli-doctor-state-");
    const gateway = await openProjectGateway(resolveAppPaths(dataDirectory, stateDirectory), "en");
    const output: string[] = [];
    try {
      expect(await runDoctorCommand(gateway, "en", (line) => output.push(line))).toBe(true);
      expect(output).toContain("Worktree Switcher is ready.");
      expect(output.some((line) => line.includes("registered projects: 0"))).toBe(true);
    } finally {
      await gateway.close();
    }
  });

  it("routes project commands through a running controller access record", async () => {
    const dataDirectory = temporaryDirectory("worktree-switcher-cli-online-data-");
    const stateDirectory = temporaryDirectory("worktree-switcher-cli-online-state-");
    const paths = resolveAppPaths(dataDirectory, stateDirectory);
    const requests: Array<{ method: string | undefined; url: string | undefined; token: string | undefined }> = [];
    const server = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url, token: request.headers["x-worktree-switcher-token"] as string | undefined });
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET") {
        response.end(JSON.stringify({ projects: [], capacity: { enabled: false, limit: 2, used: 0, available: null, holders: [] } }));
      } else {
        response.end(JSON.stringify({ project: { id: "project-1", name: "Remote App" } }));
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    writeServiceAccess(paths.serviceAccessPath, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      version: "0.0.1",
      dashboardEndpoint: endpoint,
      mcpEndpoint: null,
      accessUrl: `${endpoint}/#token=controller-token`,
      logDirectory: paths.logDirectory,
    });

    const gateway = await openProjectGateway(paths, "en");
    try {
      expect(gateway.mode).toBe("controller");
      await runProjectCommand(["list"], gateway, "en", { write: () => undefined });
      await runProjectCommand(["remove", "project-1"], gateway, "en", { write: () => undefined });
      expect(requests).toEqual([
        { method: "GET", url: "/api/dashboard", token: "controller-token" },
        { method: "DELETE", url: "/api/projects/project-1", token: "controller-token" },
      ]);
    } finally {
      await gateway.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("selects the first free unconfigured port", async () => {
    const checked: number[] = [];
    const port = await findAvailablePort(new Set([3000]), async (candidate) => {
      checked.push(candidate);
      return candidate === 3002;
    });
    expect(port).toBe(3002);
    expect(checked).toEqual([3001, 3002]);
  });
});
