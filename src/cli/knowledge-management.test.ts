import { describe, expect, it } from "vitest";
import { parseKnowledgeCommandArgs } from "./knowledge-management";

describe("knowledge CLI global paths", () => {
  it("extracts path flags around an operation without changing its JSON input", () => {
    const input = JSON.stringify({ projectId: "project", description: "--data-dir", idempotencyKey: "key" });
    expect(parseKnowledgeCommandArgs(["--data-dir", "/tmp/custom data", "create_task", "--json", input, "--state-dir", "/tmp/custom state"]))
      .toEqual({ args: ["create_task", "--json", input], dataDir: "/tmp/custom data", stateDir: "/tmp/custom state" });
  });

  it("keeps input-file values opaque", () => {
    expect(parseKnowledgeCommandArgs(["create_task", "--input-file", "--data-dir", "--state-dir", "/tmp/state"]))
      .toEqual({ args: ["create_task", "--input-file", "--data-dir"], stateDir: "/tmp/state" });
  });

  it.each([["projects", "--data-dir"], ["projects", "--state-dir", "--json", "{}"]])("rejects a missing global path in %j", (...args) => {
    expect(() => parseKnowledgeCommandArgs(args)).toThrow("requires a directory path");
  });
});
