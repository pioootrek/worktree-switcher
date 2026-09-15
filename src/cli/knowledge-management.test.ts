import { describe, expect, it, vi } from "vitest";
import { KnowledgeError, type HubImportPlan } from "../server/modules/knowledge";
import { parseKnowledgeCommandArgs, runHubImportExecuteCommand, runHubImportPlanCommand } from "./knowledge-management";

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

describe("knowledge plan-import CLI", () => {
  const report = { formatVersion: 1, planId: "plan", planHash: "hash" } as HubImportPlan;

  it("validates flags and required option pairs", () => {
    expect(() => runHubImportPlanCommand(["plan-import", "--unknown", "x"], vi.fn(), vi.fn())).toThrow("Usage: knowledge plan-import");
    expect(() => runHubImportPlanCommand(["plan-import", "--repository", "/repo"], vi.fn(), vi.fn())).toThrow("--commit is required");
  });

  it("writes the report without a controller token and prefixes planner failures", () => {
    const write = vi.fn(), planner = vi.fn(() => report);
    runHubImportPlanCommand(["plan-import", "--repository", "/repo", "--commit", "a".repeat(40), "--source-id", "source", "--validator-repository", "/hub"], write, planner);
    expect(planner).toHaveBeenCalledWith({ repository: "/repo", commit: "a".repeat(40), sourceId: "source", validatorRepository: "/hub" }); expect(JSON.parse(write.mock.calls[0]![0])).toEqual(report);
    expect(() => runHubImportPlanCommand(["plan-import", "--repository", "/repo", "--commit", "a".repeat(40), "--source-id", "source", "--validator-repository", "/hub"], vi.fn(), () => { throw new KnowledgeError("limit_exceeded", "too large"); })).toThrow("limit_exceeded: too large");
  });
});

describe("knowledge execute-import CLI",()=>{
  it("rejects unknown flags before opening the controller database",()=>{
    expect(()=>runHubImportExecuteCommand(["execute-import","--unknown","x"],{} as never)).toThrow("Usage: knowledge execute-import");
  });
});
