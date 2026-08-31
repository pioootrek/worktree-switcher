import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { Project } from "@/shared/contracts";
import { ProcessManager } from "./process-manager";

const managers: ProcessManager[] = [];

function project(port: number): Project {
  const now = new Date().toISOString();
  return {
    id: "fixture",
    name: "Fixture",
    repositoryPath: process.cwd(),
    port,
    launchPreset: "node",
    tlsMode: "off",
    tlsKeyPath: null,
    tlsCertPath: null,
    tlsCaPath: null,
    executable: process.execPath,
    args: ["-e", "require('node:http').createServer((_,r)=>r.end('ok')).listen(Number(process.env.PORT),'127.0.0.1')"],
    healthcheckPath: "/",
    startupTimeoutMs: 5000,
    selectedWorktreePath: process.cwd(),
    createdAt: now,
    updatedAt: now,
  };
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stopAll()));
});

describe("ProcessManager", () => {
  it("starts a healthy server and stops its owned process group", async () => {
    const manager = new ProcessManager();
    managers.push(manager);
    const fixture = project(await unusedPort());
    await manager.start(fixture, process.cwd());
    expect(manager.snapshot(fixture.id).phase).toBe("running");
    await manager.stop(fixture.id);
    expect(manager.snapshot(fixture.id).phase).toBe("stopped");
  });

  it("does not kill an unrelated process occupying the port", async () => {
    const server = createServer((_, response) => response.end("foreign"));
    const lanAddress = Object.values(networkInterfaces())
      .flatMap((addresses) => addresses ?? [])
      .find((address) => address.family === "IPv4" && !address.internal)?.address ?? "127.0.0.1";
    await new Promise<void>((resolve) => server.listen(0, lanAddress, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    const manager = new ProcessManager();
    managers.push(manager);

    await expect(manager.start(project(address.port), process.cwd())).rejects.toThrow("inny serwer");
    expect(server.listening).toBe(true);
    expect(manager.snapshot("fixture").failure?.title).toBe(`Port ${address.port} jest już używany`);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});
