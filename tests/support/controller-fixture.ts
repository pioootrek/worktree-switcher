import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

export interface FixtureProject {
  id: string;
  name: string;
  port: number;
  main: string;
  alternate: string;
}

export interface ControllerFixture {
  endpoint: string;
  accessUrl: string;
  projects: FixtureProject[];
  request<T>(path: string, init?: RequestInit): Promise<T>;
  close(): Promise<void>;
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
  await execFileAsync("git", args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" } });
}

async function createRepository(base: string, name: string): Promise<{ main: string; alternate: string }> {
  const main = join(base, name);
  const alternate = join(base, `${name}-alternate`);
  await mkdir(main);
  await git(main, "init", "-b", "main");
  await writeFile(join(main, "package.json"), JSON.stringify({ scripts: { dev: "node server.mjs" } }));
  await writeFile(join(main, "identity.txt"), `${name}:main`);
  await writeFile(join(main, "server.mjs"), [
    'import { readFileSync } from "node:fs";',
    'import { createServer } from "node:http";',
    'import { randomUUID } from "node:crypto";',
    'const identity = readFileSync(new URL("./identity.txt", import.meta.url), "utf8").trim();',
    'const boot = randomUUID();',
    'createServer((request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ identity, boot, pid: process.pid })); }).listen(Number(process.env.PORT), "127.0.0.1");',
  ].join("\n"));
  await git(main, "add", ".");
  await git(main, "commit", "-m", "fixture main");
  await git(main, "worktree", "add", "-b", "alternate", alternate);
  await writeFile(join(alternate, "identity.txt"), `${name}:alternate`);
  await git(alternate, "add", "identity.txt");
  await git(alternate, "commit", "-m", "fixture alternate");
  return { main, alternate };
}

export async function startControllerFixture(projectCount = 3): Promise<ControllerFixture> {
  const base = await mkdtemp(join(tmpdir(), "worktree-switcher-integration-"));
  const data = join(base, "data");
  const state = join(base, "state");
  await mkdir(data);
  await mkdir(state);
  const repositories = await Promise.all(Array.from({ length: projectCount }, (_, index) => createRepository(base, `project-${String.fromCharCode(97 + index)}`)));
  const ports = await Promise.all(Array.from({ length: projectCount + 1 }, () => freePort()));
  const controllerPort = ports.pop()!;
  let child: ChildProcess | undefined;
  try {
    child = spawn(process.execPath, [join(root, "dist/cli/index.js"), "start", "--host", "127.0.0.1", "--port", String(controllerPort), "--no-mcp", "--no-open", "--data-dir", data, "--state-dir", state, "--browse-root", base, "--web-root", join(root, "out")], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
    const accessUrl = await waitFor(() => output.match(/https?:\/\/[^\s]+#token=[^\s]+/)?.[0] ?? null, 15_000, () => `Controller did not publish an access URL.\n${output}`);
    const parsed = new URL(accessUrl);
    const token = new URLSearchParams(parsed.hash.slice(1)).get("token")!;
    const endpoint = parsed.origin;
    const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(`${endpoint}${path}`, { ...init, headers: { "content-type": "application/json", origin: endpoint, "x-worktree-switcher-token": token, ...init.headers } });
      const body = await response.json() as T & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      return body;
    };
    const projects: FixtureProject[] = [];
    for (let index = 0; index < repositories.length; index += 1) {
      const name = `project-${String.fromCharCode(97 + index)}`;
      const result = await request<{ project: { id: string } }>("/api/projects", { method: "POST", body: JSON.stringify({ name, repositoryPath: repositories[index]!.main, port: ports[index], launchPreset: "node" }) });
      projects.push({ id: result.project.id, name, port: ports[index]!, ...repositories[index]! });
    }
    return { endpoint, accessUrl, projects, request, close: async () => { await closeChild(child!); await rm(base, { recursive: true, force: true }); } };
  } catch (error) {
    if (child) await closeChild(child);
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

export async function endpointIdentity(project: FixtureProject, expectedIdentity?: string): Promise<{ identity: string; boot: string; pid: number }> {
  return waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${project.port}`);
      if (!response.ok) return null;
      const identity = await response.json() as { identity: string; boot: string; pid: number };
      return expectedIdentity && identity.identity !== expectedIdentity ? null : identity;
    }
    catch { return null; }
  }, 10_000, () => `Project ${project.name} did not become ready${expectedIdentity ? ` as ${expectedIdentity}` : ""}.`);
}

async function closeChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await waitFor(() => child.exitCode !== null ? true : null, 15_000, () => "Fixture controller did not shut down cleanly.");
}

async function waitFor<T>(read: () => T | null | Promise<T | null>, timeoutMs: number, error: () => string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(error());
}
