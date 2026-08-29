import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { SqliteStateStore } from "./sqlite-store";

const directories: string[] = [];

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-store-"));
  directories.push(directory);
  return new SqliteStateStore(join(directory, "state.sqlite3"));
}

function projectInput(name: string, repositoryPath: string, port: number) {
  return { name, repositoryPath, port, executable: "pnpm", args: ["run", "dev"] };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SqliteStateStore", () => {
  it("allows only one active reservation per project and permits release by its owner", () => {
    const store = createStore();
    const project = store.addProject(projectInput("App", "/code/app", 3210));

    const first = store.acquireReservation({
      projectId: project.id,
      worktreePath: "/code/app",
      kind: "human",
      owner: "alice",
    });

    expect(store.getActiveReservation(project.id)).toEqual(first);
    expect(() => store.acquireReservation({
      projectId: project.id,
      worktreePath: "/code/app-feature",
      kind: "human",
      owner: "bob",
    })).toThrow("alice");
    expect(() => store.releaseReservation(project.id, "bob")).toThrow("właściciel");

    store.releaseReservation(project.id, "alice");
    expect(store.getActiveReservation(project.id)).toBeNull();
    store.close();
  });

  it("requires expiring agent leases", () => {
    const store = createStore();
    const project = store.addProject(projectInput("API", "/code/api", 3211));
    expect(() => store.acquireReservation({
      projectId: project.id,
      worktreePath: "/code/api",
      kind: "agent",
      owner: "agent:test",
    })).toThrow("co najmniej");
    store.close();
  });

  it("migrates the legacy pnpm command that passed --port after a separator", () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-store-"));
    directories.push(directory);
    const databasePath = join(directory, "state.sqlite3");
    const store = new SqliteStateStore(databasePath);
    const project = store.addProject(projectInput("Web", "/code/web", 3212));
    store.close();

    const database = new Database(databasePath);
    database.prepare("UPDATE projects SET args_json = ? WHERE id = ?")
      .run(JSON.stringify(["dev", "--", "--port", "3212"]), project.id);
    database.prepare("DELETE FROM schema_migrations WHERE version = 2").run();
    database.close();

    const migrated = new SqliteStateStore(databasePath);
    expect(migrated.getProject(project.id)?.args).toEqual(["run", "dev"]);
    migrated.close();
  });

  it("persists generated Next.js TLS settings with the launch command", () => {
    const store = createStore();
    const project = store.addProject(projectInput("Secure", "/code/secure", 3213));
    store.updateProjectLaunch(project.id, {
      tlsMode: "generated",
      tlsKeyPath: null,
      tlsCertPath: null,
      tlsCaPath: null,
      executable: "pnpm",
      args: ["run", "dev", "--experimental-https"],
    });
    expect(store.getProject(project.id)).toMatchObject({
      tlsMode: "generated",
      args: ["run", "dev", "--experimental-https"],
    });
    store.close();
  });

  it("adds TLS columns to a version 2 database", () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-store-v2-"));
    directories.push(directory);
    const databasePath = join(directory, "state.sqlite3");
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, 'now'), (2, 'now');
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, repository_path TEXT NOT NULL UNIQUE,
        port INTEGER NOT NULL UNIQUE, executable TEXT NOT NULL, args_json TEXT NOT NULL,
        healthcheck_path TEXT NOT NULL, startup_timeout_ms INTEGER NOT NULL,
        selected_worktree_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO projects VALUES (
        'legacy', 'Legacy', '/code/legacy', 3214, 'pnpm', '["run","dev"]',
        '/', 45000, NULL, 'now', 'now'
      );
    `);
    database.close();

    const migrated = new SqliteStateStore(databasePath);
    expect(migrated.getProject("legacy")).toMatchObject({ tlsMode: "off", tlsKeyPath: null });
    migrated.close();
  });
});
