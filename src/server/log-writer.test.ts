import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileLogWriter } from "./log-writer";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("FileLogWriter", () => {
  it("stores controller and project output in separate files", async () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-logs-"));
    directories.push(directory);
    const logs = new FileLogWriter(directory);
    logs.controller("project.switch", { projectId: "project-1" });
    logs.project("project-1", "ready on port 3000");
    logs.test("run-1", "3 tests passed");
    await logs.close();

    expect(readFileSync(join(directory, "controller.log"), "utf8")).toContain("project.switch");
    expect(readFileSync(join(directory, "projects", "project-1.log"), "utf8")).toContain("ready on port 3000");
    expect(readFileSync(join(directory, "tests", "run-1.log"), "utf8")).toContain("3 tests passed");
  });
});
