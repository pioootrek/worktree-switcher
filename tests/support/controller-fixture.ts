import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const exec = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const WAIT_MS = 15_000;
export type ServerMode = "normal" | "gate" | "early-exit" | "timeout" | "stubborn-descendant";
export interface FixtureProject { id: string; name: string; port: number; main: string; alternate: string }
export interface HttpResult<T> { status: number; ok: boolean; body: T & { error?: string } }
export interface FixtureMcpClient { call<T>(name: string, args?: Record<string, unknown>): Promise<T>; close(): Promise<void> }
export interface ControllerFixture {
  endpoint: string; accessUrl: string; projects: FixtureProject[];
  request<T>(path: string, init?: RequestInit): Promise<T>;
  requestResult<T>(path: string, init?: RequestInit): Promise<HttpResult<T>>;
  mcp(): Promise<FixtureMcpClient>;
  setMode(project: FixtureProject, mode: ServerMode, worktreePath?: string): Promise<void>;
  releaseGate(project: FixtureProject, worktreePath?: string): Promise<void>;
  ownedPids(project: FixtureProject, worktreePath?: string): Promise<number[]>;
  restart(): Promise<void>; stop(): Promise<void>; close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate fixture port."));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}
async function git(cwd: string, ...args: string[]): Promise<void> {
  await exec("git", args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" } });
}
async function createRepository(base: string, name: string): Promise<{ main: string; alternate: string }> {
  const main = join(base, name), alternate = join(base, `${name}-alternate`);
  await mkdir(main); await git(main, "init", "-b", "main");
  await writeFile(join(main, "package.json"), JSON.stringify({ scripts: { dev: "node server.mjs" } }));
  await writeFile(join(main, "identity.txt"), `${name}:main`); await writeFile(join(main, "mode.txt"), "normal");
  await writeFile(join(main, "server.mjs"), [
    'import { appendFileSync, existsSync, readFileSync } from "node:fs";', 'import { spawn } from "node:child_process";', 'import { createServer } from "node:http";', 'import { randomUUID } from "node:crypto";',
    'const identity = readFileSync(new URL("./identity.txt", import.meta.url), "utf8").trim();',
    'const mode = readFileSync(new URL("./mode.txt", import.meta.url), "utf8").trim();', 'const boot = randomUUID();',
    'appendFileSync(new URL("./process-evidence.log", import.meta.url), `parent ${process.pid}\n`);',
    'if (mode === "early-exit") process.exit(7);',
    'if (mode === "stubborn-descendant") { const child = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\",()=>{});setInterval(()=>{},1000)"], { detached: false, stdio: "ignore" }); appendFileSync(new URL("./process-evidence.log", import.meta.url), `descendant ${child.pid}\n`); }',
    'if (mode === "gate") while (!existsSync(new URL("./release.txt", import.meta.url))) await new Promise(r => setTimeout(r, 25));',
    'const server = createServer((request, response) => { if (mode === "timeout") { response.statusCode = 503; response.end("not ready"); return; } response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ identity, boot, pid: process.pid })); });',
    'if (mode === "timeout") process.on("SIGTERM", () => {});', 'server.listen(Number(process.env.PORT), "127.0.0.1");',
  ].join("\n"));
  await git(main, "add", "."); await git(main, "commit", "-m", "fixture main");
  await git(main, "worktree", "add", "-b", "alternate", alternate);
  await writeFile(join(alternate, "identity.txt"), `${name}:alternate`); await git(alternate, "add", "identity.txt"); await git(alternate, "commit", "-m", "fixture alternate");
  return { main, alternate };
}

export async function startControllerFixture(projectCount = 3): Promise<ControllerFixture> {
  const base = await mkdtemp(join(tmpdir(), "worktree-switcher-integration-"));
  const data = join(base, "data"), state = join(base, "state"); await Promise.all([mkdir(data), mkdir(state)]);
  const repositories = await Promise.all(Array.from({ length: projectCount }, (_, index) => createRepository(base, `project-${String.fromCharCode(97 + index)}`)));
  const ports = await Promise.all(Array.from({ length: projectCount + 2 }, () => freePort()));
  const controllerPort = ports.pop()!, mcpPort = ports.pop()!;
  let child: ChildProcess | undefined, endpoint = `http://127.0.0.1:${controllerPort}`, accessUrl = "", token = "";
  const start = async () => {
    let output = "";
    child = spawn(process.execPath, [join(repositoryRoot, "dist/cli/index.js"), "start", "--service-mode", "--host", "127.0.0.1", "--port", String(controllerPort), "--mcp-port", String(mcpPort), "--no-open", "--data-dir", data, "--state-dir", state, "--browse-root", base, "--web-root", join(repositoryRoot, "out")], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); }); child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
    const access = await waitFor(async () => { try { return JSON.parse(await readFile(join(state, "service-access.json"), "utf8")) as { accessUrl: string }; } catch { return null; } }, WAIT_MS, () => `Controller did not publish service access.\n${output}`);
    accessUrl = access.accessUrl; const parsed = new URL(accessUrl); token = new URLSearchParams(parsed.hash.slice(1)).get("token")!; endpoint = parsed.origin;
  };
  const stop = async () => {
    if (!child) return;
    const current = child;
    try { await closeFixtureChild(current); }
    finally { child = undefined; }
  };
  const requestResult = async <T>(path: string, init: RequestInit = {}): Promise<HttpResult<T>> => {
    const response = await fetch(`${endpoint}${path}`, { ...init, headers: { "content-type": "application/json", origin: endpoint, "x-worktree-switcher-token": token, ...init.headers } });
    return { status: response.status, ok: response.ok, body: await response.json() as T & { error?: string } };
  };
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => { const result = await requestResult<T>(path, init); if (!result.ok) throw new Error(result.body.error ?? `HTTP ${result.status}`); return result.body; };
  try {
    await start(); const projects: FixtureProject[] = [];
    for (let index = 0; index < repositories.length; index += 1) {
      const name = `project-${String.fromCharCode(97 + index)}`;
      const result = await request<{ project: { id: string } }>("/api/projects", { method: "POST", body: JSON.stringify({ name, repositoryPath: repositories[index]!.main, port: ports[index], launchPreset: "node" }) });
      projects.push({ id: result.project.id, name, port: ports[index]!, ...repositories[index]! });
    }
    const fixture: ControllerFixture = { endpoint, accessUrl, projects, request, requestResult,
      async mcp() {
        const mcpToken = (await readFile(join(data, "mcp-token"), "utf8")).trim(); const client = new Client({ name: `capacity-${randomUUID()}`, version: "1" });
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }));
        return { async call<T>(name: string, args: Record<string, unknown> = {}) {
          const result = await client.callTool({ name, arguments: args });
          const content = (result as { content?: unknown }).content;
          if (!Array.isArray(content)) throw new Error(`${name} returned no content`);
          const part = content.find((item: unknown): item is { type: "text"; text: string } =>
            typeof item === "object" && item !== null && (item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string");
          if (!part) throw new Error(`${name} returned no JSON`);
          const value = JSON.parse(part.text) as T & { error?: string };
          if ((result as { isError?: boolean }).isError) throw new Error(value.error ?? `${name} failed`);
          return value;
        }, close: () => client.close() };
      },
      async setMode(project, mode, worktreePath = project.main) { await writeFile(join(worktreePath, "mode.txt"), mode); await unlink(join(worktreePath, "release.txt")).catch(() => undefined); },
      async releaseGate(project, worktreePath = project.main) { await writeFile(join(worktreePath, "release.txt"), "go"); },
      async ownedPids(project, worktreePath = project.main) {
        const evidence = await readFile(join(worktreePath, "process-evidence.log"), "utf8").catch(() => "");
        return evidence.split("\n").flatMap((line) => { const pid = Number(line.split(" ")[1]); return Number.isInteger(pid) && pid > 0 ? [pid] : []; });
      },
      async restart() { await stop(); await start(); fixture.endpoint = endpoint; fixture.accessUrl = accessUrl; }, stop,
      async close() { try { await stop(); } finally { await rm(base, { recursive: true, force: true }); } },
    }; return fixture;
  } catch (error) { await stop().catch(() => undefined); await rm(base, { recursive: true, force: true }); throw error; }
}

export async function endpointIdentity(project: FixtureProject, expectedIdentity?: string): Promise<{ identity: string; boot: string; pid: number }> {
  return waitFor(async () => { try { const response = await fetch(`http://127.0.0.1:${project.port}`); if (!response.ok) return null; const identity = await response.json() as { identity: string; boot: string; pid: number }; return expectedIdentity && identity.identity !== expectedIdentity ? null : identity; } catch { return null; } }, 10_000, () => `Project ${project.name} did not become ready${expectedIdentity ? ` as ${expectedIdentity}` : ""}.`);
}
export async function endpointUnavailable(project: FixtureProject, timeoutMs = 10_000): Promise<void> {
  await waitFor(() => connectionRefused(project.port), timeoutMs, () => `Project ${project.name} listener closure remained unconfirmed.`);
}
async function connectionRefused(port: number): Promise<true | null> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (value: true | null) => { socket.destroy(); resolveProbe(value); };
    socket.setTimeout(500, () => finish(null));
    socket.once("connect", () => finish(null));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED" ? true : null));
  });
}
export async function closeFixtureChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode !== 0) throw new Error(`Fixture controller exited uncleanly (${child.exitCode ?? child.signalCode}).`);
    return;
  }
  child.kill("SIGTERM");
  try {
    await waitFor(() => child.exitCode !== null || child.signalCode !== null ? true : null, WAIT_MS, () => "Fixture controller did not shut down cleanly.");
  } catch (error) {
    child.kill("SIGKILL");
    await waitFor(() => child.exitCode !== null || child.signalCode !== null ? true : null, 5_000, () => "Fixture controller survived SIGKILL.");
    throw error;
  }
  if (child.exitCode !== 0) throw new Error(`Fixture controller exited uncleanly (${child.exitCode ?? child.signalCode}).`);
}
export async function waitFor<T>(read: () => T | null | Promise<T | null>, timeoutMs: number, error: () => string): Promise<T> { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = await read(); if (value !== null) return value; await new Promise((resolveWait) => setTimeout(resolveWait, 50)); } throw new Error(error()); }
