import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync as realExecFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
const validatorRoots = new Set<string>();
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn((file: string, args: string[], options: Record<string, unknown>) => {
      const root = args[1];
      if (file === "git" && validatorRoots.has(root) && args[2] === "rev-parse") return "22afb656c74b2fde84cb92f1aefcf8b427697cc6\n";
      if (file === "git" && validatorRoots.has(root) && args[2] === "status") return "";
      return actual.execFileSync(file, args, options);
    }),
    spawnSync: vi.fn(() => ({ status: 0, stdout: "Backlog validation passed.\n", stderr: "" })),
  };
});

import { PINNED_HUB_VALIDATOR_COMMIT, planHubImport } from "./hub-import-plan";
import { runHubImportPlanCommand } from "../../../cli/knowledge-management";

function repository(): { root: string; commit: string; marker: string } {
  const root = mkdtempSync(join(tmpdir(), "hub-import-source-")); roots.push(root);
  cpSync(join(process.cwd(), "tests", "fixtures", "knowledge-hub"), root, { recursive: true });
  for (const name of ["schema.json", "done-schema.json", "note-schema.json", "docs-header-schema.json"]) writeFileSync(join(root, "docs", "backlog", name), "{\n  \"type\": \"object\"\n}\n");
  const marker = join(root, "imported-script-ran");
  mkdirSync(join(root, "bin"), { recursive: true }); writeFileSync(join(root, "bin", "hub.py"), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`);
  realExecFileSync("git", ["init", "-q"], { cwd: root });
  realExecFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "add", "."], { cwd: root });
  realExecFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture"], { cwd: root });
  return { root, commit: realExecFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), marker };
}
function validator(): string {
  const root = mkdtempSync(join(tmpdir(), "hub-validator-")); roots.push(root); validatorRoots.add(root);
  mkdirSync(join(root, "bin"), { recursive: true }); writeFileSync(join(root, "bin", "hub.py"), "# trusted fixture\n");
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); validatorRoots.clear(); });

describe("K6a Hub import planning", () => {
  it("reports every source family, custom schemas, missing relations and stable provenance without writing data", () => {
    const source = repository(), trusted = validator();
    const state = join(source.root, "controller.sqlite3"); writeFileSync(state, "unchanged");
    const options = { repository: source.root, commit: source.commit, sourceId: "fixture-repository", validatorRepository: trusted };
    const first = planHubImport(options), second = planHubImport(options);
    expect(first.validator).toMatchObject({ commit: PINNED_HUB_VALIDATOR_COMMIT, valid: true });
    expect(first.counts).toMatchObject({ tasks: 1, embeddedNotes: 1, done: 1, notes: 1, attachments: 2, documents: 1, schemas: 4, derived: 1, unresolvedRelations: 2, missing: 0, conflicts: 0 });
    expect(first.mappings.find(item => item.legacyId === "NOTE-20260913-synthetic-memory")).toMatchObject({ targetKind: "memory", sourceOnlyFields: expect.arrayContaining(["fixture_extension"]) });
    expect(first.mappings.filter(item => item.sourceKind === "attachment").map(item => item.sourcePath)).toEqual(expect.arrayContaining([
      "docs/backlog/notes/NOTE-20260913-synthetic-memory/evidence/declared.txt",
      "docs/backlog/notes/NOTE-20260913-synthetic-memory/evidence/nested/discovered-only.txt",
    ]));
    expect(first.unresolvedRelations).toEqual(expect.arrayContaining([
      { sourcePath: "docs/backlog/feature/FEAT-20260913-synthetic-open.json", relation: "related_ids", targetLegacyId: "FEAT-20260913-missing-target", blocking: false },
      { sourcePath: "docs/backlog/done/DONE-20260913-synthetic-finished.json", relation: "item_id", targetLegacyId: "FEAT-20260912-synthetic-finished", blocking: false },
    ]));
    expect(first.guarantees).toEqual({ dataWritten: false, sourceReadFromCommit: true, importedRepositoryScriptsExecuted: false });
    expect(first.planHash).toBe(second.planHash); expect(first.planId).toBe(second.planId);
    expect(readFileSync(state, "utf8")).toBe("unchanged"); expect(existsSync(source.marker)).toBe(false);
  });

  it("reads the committed tree despite dirty checkout changes and exposes the offline CLI", () => {
    const source = repository(), trusted = validator(); writeFileSync(join(source.root, "docs", "backlog", "feature", "FEAT-20260913-synthetic-open.json"), "not committed");
    const lines: string[] = [];
    runHubImportPlanCommand(["plan-import", "--repository", source.root, "--commit", source.commit, "--source-id", "fixture", "--validator-repository", trusted], line => lines.push(line));
    const report = JSON.parse(lines[0]!);
    expect(report.source.commit).toBe(source.commit); expect(report.validator.valid).toBe(true); expect(report.counts.tasks).toBe(1);
  });

  it("rejects a ref name and any validator other than the clean pinned checkout", () => {
    const source = repository(), trusted = validator();
    expect(() => planHubImport({ repository: source.root, commit: "HEAD", sourceId: "fixture", validatorRepository: trusted })).toThrow("exact 40-character commit SHA");
    validatorRoots.delete(trusted);
    expect(() => planHubImport({ repository: source.root, commit: source.commit, sourceId: "fixture", validatorRepository: trusted })).toThrow("Unable to read the requested Git source");
  });
});
