import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NodeLaunchCommandResolver } from "./launch-command";

const directories: string[] = [];

function fixture(packageJson: object, lockfile?: string): string {
  const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-command-"));
  directories.push(directory);
  writeFileSync(join(directory, "package.json"), JSON.stringify(packageJson));
  if (lockfile) writeFileSync(join(directory, lockfile), "");
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("NodeLaunchCommandResolver", () => {
  it("uses PORT for Next.js and honors the declared package manager", () => {
    const directory = fixture({
      packageManager: "pnpm@11.5.2",
      scripts: { dev: "next dev --turbopack" },
      dependencies: { next: "16.2.11" },
    });

    expect(new NodeLaunchCommandResolver().resolve(directory, 3000)).toEqual({
      executable: "pnpm",
      args: ["run", "dev"],
      portMethod: "environment",
    });
  });

  it("passes --port to a Vite script using npm forwarding syntax", () => {
    const directory = fixture({ scripts: { dev: "vite" }, devDependencies: { vite: "8.0.0" } }, "package-lock.json");

    expect(new NodeLaunchCommandResolver().resolve(directory, 4173)).toEqual({
      executable: "npm",
      args: ["run", "dev", "--", "--port", "4173"],
      portMethod: "argument",
    });
  });

  it("detects a package manager from its lockfile", () => {
    const directory = fixture({ scripts: { dev: "node server.js" } }, "yarn.lock");
    expect(new NodeLaunchCommandResolver().resolve(directory, 4000).executable).toBe("yarn");
  });

  it("rejects projects without a dev script during registration", () => {
    const directory = fixture({ scripts: { build: "tsc" } });
    expect(() => new NodeLaunchCommandResolver().resolve(directory, 4000)).toThrow("skryptu dev");
  });
});
