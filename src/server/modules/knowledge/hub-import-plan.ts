import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { KnowledgeError } from "./knowledge-error";

export const PINNED_HUB_VALIDATOR_COMMIT = "22afb656c74b2fde84cb92f1aefcf8b427697cc6";
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const ITEM_DIRECTORIES = new Set(["feature", "fix", "rework", "security"]);
const DERIVED_NAMES = new Set(["index.json"]);
const OVERRIDES = new Set(["schema.json", "done-schema.json", "note-schema.json", "docs-header-schema.json"]);

export interface HubImportPlanOptions {
  repository: string;
  commit: string;
  sourceId: string;
  validatorRepository: string;
}

export interface HubImportMapping {
  sourcePath: string;
  sourceKind: "task" | "task_note" | "done" | "note" | "attachment" | "document" | "configuration" | "schema" | "derived";
  targetKind: "task" | "historical_comment" | "task_completion" | "memory" | "attachment" | "external_source" | "import_metadata" | null;
  legacyId: string | null;
  disposition: "mapped" | "source_only" | "skipped";
  sourceSha256: string;
  size: number;
  mappedFields: string[];
  sourceOnlyFields: string[];
  originalPayload?: unknown;
}

export interface HubImportPlan {
  formatVersion: 1;
  planId: string;
  planHash: string;
  source: { sourceId: string; repository: string; commit: string; backlogPath: "docs/backlog" };
  validator: { repository: string; commit: string; command: string[]; valid: boolean; diagnostics: string[] };
  counts: {
    files: number; bytes: number; tasks: number; embeddedNotes: number; done: number; notes: number; attachments: number; documents: number;
    configurations: number; schemas: number; derived: number; mapped: number; sourceOnly: number; skipped: number;
    missing: number; conflicts: number; unresolvedRelations: number;
  };
  mappings: HubImportMapping[];
  missing: Array<{ sourcePath: string; reference: string; blocking: boolean; reason: string }>;
  conflicts: Array<{ sourcePath: string; legacyId: string | null; blocking: boolean; reason: string }>;
  unresolvedRelations: Array<{ sourcePath: string; relation: string; targetLegacyId: string; blocking: boolean }>;
  guarantees: { dataWritten: false; sourceReadFromCommit: true; importedRepositoryScriptsExecuted: false };
}

interface SourceFile { path: string; bytes: Buffer }
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function git(repository: string, args: string[], encoding: BufferEncoding | "buffer" = "utf8"): string | Buffer {
  try { return execFileSync("git", ["-C", repository, ...args], { encoding: encoding === "buffer" ? null : encoding, maxBuffer: MAX_TOTAL_BYTES + 1024 * 1024 }); }
  catch { throw new KnowledgeError("invalid_request", "Unable to read the requested Git source."); }
}
function safeTarget(root: string, relative: string): string {
  if (!relative || relative.startsWith("/") || relative.includes("\\") || relative.split("/").includes("..")) throw new KnowledgeError("invalid_request", "Source commit contains an unsafe path.");
  const target = resolve(root, ...relative.split("/"));
  if (target === resolve(root) || !target.startsWith(resolve(root) + sep)) throw new KnowledgeError("invalid_request", "Source commit contains an unsafe path.");
  return target;
}
function readCommit(repository: string, commit: string): SourceFile[] {
  const raw = git(repository, ["ls-tree", "-r", "-z", commit, "--", "docs"]) as string;
  const entries = raw.split("\0").filter(Boolean);
  if (entries.length > MAX_FILES) throw new KnowledgeError("limit_exceeded", "Hub source contains too many files.");
  let total = 0;
  return entries.map(entry => {
    const match = /^(\d+)\s+blob\s+[a-f0-9]+\t(.+)$/.exec(entry);
    if (!match || match[1] === "120000") throw new KnowledgeError("invalid_request", "Hub source contains an unsupported Git entry.");
    const path = match[2]!;
    const bytes = git(repository, ["show", `${commit}:${path}`], "buffer") as Buffer;
    total += bytes.byteLength;
    if (bytes.byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new KnowledgeError("limit_exceeded", "Hub source exceeds import planning limits.");
    return { path, bytes };
  });
}
function json(file: SourceFile, failures: HubImportPlan["missing"]): Record<string, unknown> | null {
  try { const value = JSON.parse(file.bytes.toString("utf8")); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch { failures.push({ sourcePath: file.path, reference: file.path, blocking: true, reason: "invalid_json" }); return null; }
}
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function mapping(file: SourceFile, sourceKind: HubImportMapping["sourceKind"], targetKind: HubImportMapping["targetKind"], legacyId: string | null,
  disposition: HubImportMapping["disposition"], payload?: Record<string, unknown>, supported: string[] = []): HubImportMapping {
  const keys = payload ? Object.keys(payload).sort() : [];
  return { sourcePath: file.path, sourceKind, targetKind, legacyId, disposition, sourceSha256: sha(file.bytes), size: file.bytes.byteLength,
    mappedFields: keys.filter(key => supported.includes(key)), sourceOnlyFields: keys.filter(key => !supported.includes(key)), ...(payload ? { originalPayload: payload } : {}) };
}

function verifyValidator(repository: string): { root: string } {
  let root: string;
  try { root = realpathSync(repository); } catch { throw new KnowledgeError("invalid_request", "Trusted Hub validator repository does not exist."); }
  const head = String(git(root, ["rev-parse", "HEAD"])).trim();
  const dirty = String(git(root, ["status", "--porcelain", "--untracked-files=all"])).trim();
  if (head !== PINNED_HUB_VALIDATOR_COMMIT || dirty) throw new KnowledgeError("invalid_request", `Trusted Hub validator must be a clean checkout of ${PINNED_HUB_VALIDATOR_COMMIT}.`);
  const script = join(root, "bin", "hub.py");
  if (!existsSync(script) || lstatSync(script).isSymbolicLink()) throw new KnowledgeError("invalid_request", "Trusted Hub validator entry point is unavailable.");
  return { root };
}

/** Read-only K6a plan. It materializes a commit in a temporary directory and never opens the controller database. */
export function planHubImport(options: HubImportPlanOptions): HubImportPlan {
  if (!/^[a-f0-9]{40}$/.test(options.commit)) throw new KnowledgeError("invalid_request", "Import source must be an exact 40-character commit SHA.");
  if (!options.sourceId.trim() || options.sourceId.length > 200) throw new KnowledgeError("invalid_request", "Import source ID is required.");
  const repository = realpathSync(options.repository);
  const resolvedCommit = String(git(repository, ["rev-parse", "--verify", `${options.commit}^{commit}`])).trim();
  if (resolvedCommit !== options.commit) throw new KnowledgeError("invalid_request", "Import source commit could not be resolved exactly.");
  const trusted = verifyValidator(options.validatorRepository);
  const files = readCommit(repository, resolvedCommit).sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some(file => file.path === "docs/backlog/config.json")) throw new KnowledgeError("invalid_request", "Source commit has no docs/backlog/config.json.");
  const temporary = mkdtempSync(join(tmpdir(), "worktree-switcher-hub-plan-"));
  let validatorValid = false; let diagnostics: string[] = [];
  try {
    for (const file of files) { const target = safeTarget(temporary, file.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, file.bytes, { mode: 0o600 }); }
    const command = [join(trusted.root, "bin", "hub.py"), "validate", "--backlog-dir", join(temporary, "docs", "backlog")];
    const result = spawnSync("python3", command, { cwd: temporary, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error) throw new KnowledgeError("invalid_request", "Pinned Hub validator could not be executed.");
    validatorValid = result.status === 0;
    diagnostics = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.split("\n").map(line => line.trim()).filter(Boolean).slice(0, 500);
  } finally { rmSync(temporary, { recursive: true, force: true }); }

  const mappings: HubImportMapping[] = [], missing: HubImportPlan["missing"] = [], conflicts: HubImportPlan["conflicts"] = [], unresolvedRelations: HubImportPlan["unresolvedRelations"] = [];
  const legacyPaths = new Map<string, string>(); const knownIds = new Set<string>();
  const backlogJson = files.filter(file => file.path.startsWith("docs/backlog/") && file.path.endsWith(".json"));
  for (const file of backlogJson) {
    const relative = file.path.slice("docs/backlog/".length), parts = relative.split("/");
    if (parts.length === 2 && (ITEM_DIRECTORIES.has(parts[0]!) || parts[0] === "done")) { const payload = json(file, missing); if (payload && typeof payload.id === "string") knownIds.add(payload.id); }
    if (parts.length === 3 && parts[0] === "notes" && parts[2] === "note.json") { const payload = json(file, missing); if (payload && typeof payload.id === "string") knownIds.add(payload.id); }
  }
  const register = (item: HubImportMapping) => { mappings.push(item); if (item.legacyId) { const previous = legacyPaths.get(item.legacyId); if (previous && previous !== item.sourcePath) conflicts.push({ sourcePath: item.sourcePath, legacyId: item.legacyId, blocking: true, reason: `duplicate_legacy_id:${previous}` }); else legacyPaths.set(item.legacyId, item.sourcePath); } };
  for (const file of files) {
    const relative = file.path.startsWith("docs/backlog/") ? file.path.slice("docs/backlog/".length) : null;
    const parts = relative?.split("/") ?? [];
    if (relative && parts.length === 2 && ITEM_DIRECTORIES.has(parts[0]!)) {
      const payload = json(file, missing); if (!payload) continue; const id = typeof payload.id === "string" ? payload.id : null;
      register(mapping(file, "task", "task", id, "mapped", payload, ["id","title","problem","status","priority","type","area","scope","validation","risk","risk_acceptance","created","source","notes","links"]));
      if (Array.isArray(payload.notes)) payload.notes.forEach((note, index) => {
        if (!note || typeof note !== "object" || Array.isArray(note)) return;
        const notePayload = note as Record<string, unknown>, bytes = Buffer.from(canonical(notePayload));
        register({ sourcePath: `${file.path}#notes/${index}`, sourceKind: "task_note", targetKind: "historical_comment", legacyId: id ? `${id}:note:${index}` : null,
          disposition: "mapped", sourceSha256: sha(bytes), size: bytes.byteLength, mappedFields: Object.keys(notePayload).filter(key => ["author","date","text"].includes(key)).sort(),
          sourceOnlyFields: Object.keys(notePayload).filter(key => !["author","date","text"].includes(key)).sort(), originalPayload: notePayload });
      });
      const links = payload.links && typeof payload.links === "object" ? payload.links as Record<string, unknown> : {};
      for (const target of stringArray(links.related_ids)) if (!knownIds.has(target)) unresolvedRelations.push({ sourcePath: file.path, relation: "related_ids", targetLegacyId: target, blocking: false });
    } else if (relative && parts.length === 2 && parts[0] === "done") {
      const payload = json(file, missing); if (!payload) continue; const id = typeof payload.id === "string" ? payload.id : null;
      register(mapping(file, "done", "task_completion", id, "mapped", payload, ["id","item_id","title","date","summary","changed","validation","source","item_snapshot","followup_ids"]));
      if (typeof payload.item_id === "string" && !knownIds.has(payload.item_id)) unresolvedRelations.push({ sourcePath: file.path, relation: "item_id", targetLegacyId: payload.item_id, blocking: false });
      for (const target of stringArray(payload.followup_ids)) if (!knownIds.has(target)) unresolvedRelations.push({ sourcePath: file.path, relation: "followup_ids", targetLegacyId: target, blocking: false });
    } else if (relative && parts.length === 3 && parts[0] === "notes" && parts[2] === "note.json") {
      const payload = json(file, missing); if (!payload) continue; const id = typeof payload.id === "string" ? payload.id : null;
      register(mapping(file, "note", "memory", id, "mapped", payload, ["id","title","body","author","created","last_reviewed","status","tags","files","schema_version"]));
      const noteRoot = parts.slice(0, 2).join("/") + "/";
      const discovered = new Set(files.filter(candidate => candidate.path.startsWith(`docs/backlog/${noteRoot}`) && candidate.path !== file.path).map(candidate => candidate.path.slice(`docs/backlog/${noteRoot}`.length)));
      for (const declared of stringArray(payload.files)) if (!discovered.has(declared)) missing.push({ sourcePath: file.path, reference: declared, blocking: true, reason: "declared_attachment_missing" });
    } else if (relative && parts[0] === "notes" && parts.length > 2 && parts.at(-1) !== "note.json") {
      register(mapping(file, "attachment", "attachment", null, "mapped"));
    } else if (relative && parts.length === 1 && parts[0] === "config.json") {
      const payload = json(file, missing); if (payload) register(mapping(file, "configuration", "import_metadata", null, "source_only", payload));
    } else if (relative && parts.length === 1 && OVERRIDES.has(parts[0]!)) {
      const payload = json(file, missing); if (payload) register(mapping(file, "schema", "import_metadata", null, "source_only", payload));
    } else if (relative && DERIVED_NAMES.has(relative)) {
      const payload = json(file, missing); if (payload) register(mapping(file, "derived", null, null, "skipped", payload));
    } else if (file.path.startsWith("docs/") && file.path.endsWith(".md")) {
      register(mapping(file, "document", "external_source", null, "source_only"));
    }
  }
  if (!validatorValid) missing.push({ sourcePath: "docs/backlog", reference: PINNED_HUB_VALIDATOR_COMMIT, blocking: true, reason: "hub_validation_failed" });
  const kinds = (kind: HubImportMapping["sourceKind"]) => mappings.filter(item => item.sourceKind === kind).length;
  const base = {
    formatVersion: 1 as const,
    source: { sourceId: options.sourceId, repository, commit: resolvedCommit, backlogPath: "docs/backlog" as const },
    validator: { repository: trusted.root, commit: PINNED_HUB_VALIDATOR_COMMIT, command: ["bin/hub.py", "validate", "--backlog-dir", "<temporary>/docs/backlog"], valid: validatorValid, diagnostics },
    counts: { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0), tasks: kinds("task"), embeddedNotes: kinds("task_note"), done: kinds("done"), notes: kinds("note"), attachments: kinds("attachment"), documents: kinds("document"), configurations: kinds("configuration"), schemas: kinds("schema"), derived: kinds("derived"), mapped: mappings.filter(item => item.disposition === "mapped").length, sourceOnly: mappings.filter(item => item.disposition === "source_only").length, skipped: mappings.filter(item => item.disposition === "skipped").length, missing: missing.length, conflicts: conflicts.length, unresolvedRelations: unresolvedRelations.length },
    mappings, missing, conflicts, unresolvedRelations,
    guarantees: { dataWritten: false as const, sourceReadFromCommit: true as const, importedRepositoryScriptsExecuted: false as const },
  };
  const planHash = sha(canonical(base));
  return { ...base, planId: `hub:${options.sourceId}:${resolvedCommit}:${planHash.slice(0, 16)}`, planHash };
}
