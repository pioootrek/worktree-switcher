import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { acquireControllerLock } from "../server/controller-lock";
import { resolveAppPaths } from "../server/paths";
import { runIdentityCommand } from "./identity-management";

const directories: string[] = [];

function paths() {
  const root = mkdtempSync(join(tmpdir(), "worktree-switcher-identity-cli-"));
  directories.push(root);
  return resolveAppPaths(join(root, "data"), join(root, "state"));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("identity management CLI", () => {
  it("prints the first owner token once and never persists the raw value", () => {
    const appPaths = paths();
    const output: string[] = [];
    runIdentityCommand(["bootstrap-owner", "--label", "Local owner", "--lifetime-seconds", "300"], appPaths, {
      write: (line) => output.push(line),
    });

    expect(output).toHaveLength(1);
    const result = JSON.parse(output[0]!) as { principalId: string; credential: { expiresAt: string }; token: string };
    expect(result.token).toMatch(/^wts_[0-9a-f-]{36}_[0-9a-f]{64}$/);
    expect(Date.parse(result.credential.expiresAt)).toBeGreaterThan(Date.now());

    const database = new Database(appPaths.databasePath, { readonly: true });
    const persisted = JSON.stringify(database.prepare("SELECT * FROM principal_credentials").all())
      + JSON.stringify(database.prepare("SELECT * FROM controller_audit_events").all());
    expect(persisted).not.toContain(result.token);
    database.close();
    expect(() => runIdentityCommand(["bootstrap-owner"], appPaths)).toThrow("Właściciel został już zainicjalizowany");
  });

  it("respects the singleton lock instead of opening an offline database beside the controller", () => {
    const appPaths = paths();
    const lock = acquireControllerLock(appPaths.controllerLockPath);
    try {
      expect(() => runIdentityCommand(["bootstrap-owner"], appPaths)).toThrow("already running");
    } finally {
      lock.release();
    }
  });
});
