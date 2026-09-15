import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { acquireControllerLock } from "../src/server/controller-lock";
import { createControllerBackup, restoreControllerBackup } from "../src/server/controller-backup";
import { SqliteStateStore } from "../src/server/infrastructure/sqlite/sqlite-state-store";
import { IdentityService } from "../src/server/modules/identity";
import { executeHubImport, exportKnowledgeProject, importKnowledgeProject, planHubImport } from "../src/server/modules/knowledge";

// Explicit inputs keep host paths and the live controller out of this exercise.
const [repository, commit, validatorRepository, destination] = process.argv.slice(2);
if (!repository || !commit || !validatorRepository || !destination || process.argv.length !== 6) {
  throw new Error("Usage: tsx scripts/knowledge-pilot.ts <repository> <commit SHA> <validator repository> <new destination>");
}
const root = resolve(destination);
mkdirSync(root, { mode: 0o700 }); // Never reuse or overwrite a previous pilot.
const save = (name: string, value: unknown) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const checks: string[] = [];
const projectId = "k7a-worktree-switcher";
const database = join(root, "data/state.sqlite3");
const attachments = join(root, "data/knowledge-attachments");
const implementation = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
const plan = planHubImport({ repository, commit, sourceId: "worktree-switcher", validatorRepository });
save("plan.json", plan);
save("pilot.json", { implementation, sourceDirty, repository: resolve(repository), commit, projectId, liveWrites: false });
const lock = acquireControllerLock(join(root, "state/controller.lock"));
let store = new SqliteStateStore(database);
try {
  const owner = new IdentityService(store).bootstrapOwnerSession({ sessionLifetimeSeconds: 1800 });
  writeFileSync(join(root, "owner-token"), owner.token, { mode: 0o600 });
  await store.backup(join(root, "identity-baseline.sqlite3"));
  const input = { plan, targetProjectId: projectId, targetProjectName: "Worktree Switcher — PILOT COPY", chunkSize: 32, attachmentDirectory: attachments };
  let batch;
  do {
    const identity = new IdentityService(store);
    batch = executeHubImport(store, identity, identity.authenticateBearer(owner.token), input);
    if (batch.status === "staging") assert.equal(store.getKnowledgeProject(projectId), null);
    console.log(JSON.stringify({ stage: "import", cursor: batch.cursor, total: batch.totalItems, status: batch.status }));
    store.close();
    store = new SqliteStateStore(database);
  } while (batch.status === "staging");
  checks.push("staging invisible; cursor survives connection reopen; complete publication");
  const snapshot = store.exportKnowledgeProject(projectId)!;
  assert.equal(snapshot.tasks.length, plan.counts.tasks + plan.counts.done);
  assert.equal(snapshot.memories.length, plan.counts.notes);
  assert.equal(snapshot.replies.length, plan.counts.embeddedNotes);
  assert.equal(snapshot.attachments.length, plan.counts.attachments);
  assert.equal(snapshot.importSources.length, plan.mappings.length);
  for (const mapping of plan.mappings) {
    const source = snapshot.importSources.find(row => row.source_path === mapping.sourcePath)!;
    assert.equal(source.source_sha256, mapping.sourceSha256);
    if (mapping.originalPayload !== undefined) assert.deepEqual(JSON.parse(String(source.original_payload_json)), mapping.originalPayload);
  }
  for (const attachment of snapshot.attachments) {
    const hash = String(attachment.sha256);
    const bytes = readFileSync(join(attachments, hash.slice(0, 2), hash));
    assert.equal(bytes.length, attachment.size);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  }
  checks.push("counts, original payloads, source hashes and attachment bytes match the plan");
  const identity = new IdentityService(store), actor = identity.authenticateBearer(owner.token);
  executeHubImport(store, identity, actor, input);
  assert.deepEqual(store.exportKnowledgeProject(projectId), snapshot);
  checks.push("identical import is a no-op");
  exportKnowledgeProject(store, identity, projectId, join(root, "project-export"), attachments, actor, { applicationVersion: implementation });
  // Logical exports intentionally exclude credentials: provide the same identity baseline separately.
  copyFileSync(join(root, "identity-baseline.sqlite3"), join(root, "logical-restore.sqlite3"));
  const restored = new SqliteStateStore(join(root, "logical-restore.sqlite3"));
  try {
    const restoredIdentity = new IdentityService(restored);
    importKnowledgeProject(restored, restoredIdentity, join(root, "project-export"), join(root, "logical-attachments"), restoredIdentity.authenticateBearer(owner.token));
    assert.deepEqual(restored.exportKnowledgeProject(projectId), snapshot);
  } finally { restored.close(); }
  checks.push("logical export/restore matches the full snapshot with a separate identity baseline");
  await createControllerBackup(store, join(root, "controller-backup"), { applicationVersion: implementation, attachmentDirectory: attachments });
  restoreControllerBackup(join(root, "controller-backup"), join(root, "physical-restore.sqlite3"), join(root, "physical-attachments"));
  const physical = new SqliteStateStore(join(root, "physical-restore.sqlite3"));
  try { assert.deepEqual(physical.exportKnowledgeProject(projectId), snapshot); } finally { physical.close(); }
  checks.push("controller backup/restore matches the full knowledge snapshot");
  const knownArchived = new Set(plan.mappings.filter(m => m.sourceKind === "done").map(m => (m.originalPayload as Record<string, unknown>)?.item_id));
  const report = { implementation, sourceDirty, sourceCommit: commit, planId: plan.planId, checks, counts: Object.fromEntries(Object.entries(snapshot).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length])), unresolvedRelations: plan.unresolvedRelations, unresolvedWithArchivedTarget: plan.unresolvedRelations.filter(r => knownArchived.has(r.targetLegacyId)).length, cutoverApproved: false };
  save("report.json", report);
  console.log(JSON.stringify({ stage: "complete", checks, counts: report.counts, unresolved: report.unresolvedRelations.length }));
} catch (error) {
  save("failure.json", { checks, error: error instanceof Error ? error.message : String(error) });
  throw error;
} finally { store.close(); lock.release(); }
