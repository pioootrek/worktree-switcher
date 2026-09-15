import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

import type { AuthenticatedPrincipal, IdentityService } from "@/server/modules/identity";
import { calculateHubImportPlanHash, planHubImport, type HubImportMapping, type HubImportPlan } from "./hub-import-plan";
import { KnowledgeError } from "./knowledge-error";

export type HubImportBatchStatus = "staging" | "published" | "failed";

export interface HubImportBatch {
  id: string;
  planId: string;
  planHash: string;
  sourceId: string;
  sourceRepository: string;
  sourceCommit: string;
  targetProjectId: string;
  targetProjectName: string;
  expectedTargetRevision: number | null;
  actorPrincipalId: string;
  status: HubImportBatchStatus;
  cursor: number;
  totalItems: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  error: string | null;
}

export interface HubImportExecutionStore {
  beginHubImport(input: Omit<HubImportBatch, "status" | "cursor" | "createdAt" | "updatedAt" | "publishedAt" | "error">, now: string): HubImportBatch;
  getHubImport(batchId: string): HubImportBatch | null;
  stageHubImportChunk(batchId: string, expectedCursor: number, mappings: HubImportMapping[], now: string): HubImportBatch;
  publishHubImport(batchId: string, now: string, attachmentDirectory?: string): HubImportBatch;
}

export interface ExecuteHubImportInput {
  plan: HubImportPlan;
  targetProjectId: string;
  targetProjectName: string;
  batchId?: string;
  chunkSize?: number;
  expectedTargetRevision?: number | null;
  attachmentDirectory?: string;
}

function validate(input: ExecuteHubImportInput): void {
  if (!input.targetProjectId.trim() || input.targetProjectId.trim().length > 160) throw new KnowledgeError("invalid_request", "Target project ID is required and must not exceed 160 characters.");
  if (!input.targetProjectName.trim() || input.targetProjectName.trim().length > 120) throw new KnowledgeError("invalid_request", "Target project name is required and must not exceed 120 characters.");
  if (input.expectedTargetRevision !== undefined && input.expectedTargetRevision !== null && (!Number.isInteger(input.expectedTargetRevision) || input.expectedTargetRevision < 1)) throw new KnowledgeError("invalid_request", "Expected target revision must be positive.");
  if (input.plan.guarantees.dataWritten !== false || !input.plan.validator.valid) throw new KnowledgeError("invalid_request", "Only a valid read-only Hub import plan can be executed.");
  if (calculateHubImportPlanHash(input.plan) !== input.plan.planHash || !input.plan.planId.endsWith(input.plan.planHash.slice(0, 16))) throw new KnowledgeError("revision_conflict", "Hub import plan hash does not match its contents.");
  const unsupported = input.plan.mappings.find(mapping => mapping.disposition === "mapped" && !["task", "memory", "historical_comment", "task_completion", "attachment"].includes(mapping.targetKind ?? ""));
  if (unsupported) throw new KnowledgeError("invalid_request", `Hub mapping is not executable yet: ${unsupported.targetKind ?? unsupported.sourceKind}.`);
  if(input.plan.mappings.some(mapping=>mapping.targetKind==="attachment")&&!input.attachmentDirectory) throw new KnowledgeError("invalid_request","Attachment directory is required for this Hub import.");
  if (input.plan.missing.some(item => item.blocking) || input.plan.conflicts.some(item => item.blocking) || input.plan.unresolvedRelations.some(item => item.blocking)) {
    throw new KnowledgeError("invalid_request", "Hub import plan contains blocking findings.");
  }
}

/** Durable K6b coordinator. Every call is resumable and stages at most chunkSize mappings. */
export function executeHubImport(
  store: HubImportExecutionStore,
  identity: Pick<IdentityService, "requireOwnerSession">,
  actor: AuthenticatedPrincipal,
  input: ExecuteHubImportInput,
  clock: () => string = () => new Date().toISOString(),
  verifyPlan: (plan: HubImportPlan) => HubImportPlan = plan => planHubImport({
    repository: plan.source.repository,
    commit: plan.source.commit,
    sourceId: plan.source.sourceId,
    validatorRepository: plan.validator.repository,
  }),
  readSourceFile: (plan: HubImportPlan, path: string) => Buffer = (plan,path) => {
    try{return execFileSync("git",["-C",plan.source.repository,"show",`${plan.source.commit}:${path}`],{encoding:null,maxBuffer:11*1024*1024});}
    catch{throw new KnowledgeError("invalid_request",`Unable to read approved import object: ${path}`);}
  },
): HubImportBatch {
  validate(input);
  identity.requireOwnerSession(actor);
  const verified = verifyPlan(input.plan);
  if (verified.planId !== input.plan.planId || verified.planHash !== input.plan.planHash) throw new KnowledgeError("revision_conflict", "Import source no longer matches the approved plan.");
  const now = clock();
  const stableId = `hub-import:${createHash("sha256").update(`${input.plan.planId}\0${input.targetProjectId}`).digest("hex").slice(0, 24)}`;
  let batch = store.beginHubImport({
    id: input.batchId ?? stableId,
    planId: input.plan.planId,
    planHash: input.plan.planHash,
    sourceId: input.plan.source.sourceId,
    sourceRepository: input.plan.source.repository,
    sourceCommit: input.plan.source.commit,
    targetProjectId: input.targetProjectId,
    targetProjectName: input.targetProjectName.trim(),
    expectedTargetRevision: input.expectedTargetRevision ?? null,
    actorPrincipalId: actor.principalId,
    totalItems: input.plan.mappings.length,
  }, now);
  if (batch.planId !== input.plan.planId || batch.planHash !== input.plan.planHash || batch.sourceId !== input.plan.source.sourceId || batch.sourceRepository !== input.plan.source.repository || batch.sourceCommit !== input.plan.source.commit
    || batch.targetProjectId !== input.targetProjectId || batch.targetProjectName !== input.targetProjectName.trim() || batch.expectedTargetRevision !== (input.expectedTargetRevision ?? null) || batch.actorPrincipalId !== actor.principalId || batch.totalItems !== input.plan.mappings.length) {
    throw new KnowledgeError("revision_conflict", "Stored import batch does not match the supplied plan.");
  }
  if (batch.status === "published") return batch;
  if (batch.status !== "staging") throw new KnowledgeError("invalid_request", "Import batch cannot be resumed.");
  const size = Math.max(1, Math.min(input.chunkSize ?? 100, 500));
  const mappings = input.plan.mappings.slice(batch.cursor, batch.cursor + size).map(mapping=>{
    if(mapping.targetKind!=="attachment") return mapping; const bytes=readSourceFile(input.plan,mapping.sourcePath);
    if(bytes.byteLength!==mapping.size||createHash("sha256").update(bytes).digest("hex")!==mapping.sourceSha256) throw new KnowledgeError("revision_conflict",`Import attachment no longer matches the approved plan: ${mapping.sourcePath}`);
    return {...mapping,originalPayload:{fileName:mapping.sourcePath.split("/").at(-1),mediaType:"application/octet-stream",dataBase64:bytes.toString("base64")}};
  });
  if (mappings.length) batch = store.stageHubImportChunk(batch.id, batch.cursor, mappings, clock());
  if (batch.cursor === batch.totalItems) batch = store.publishHubImport(batch.id, clock(),input.attachmentDirectory);
  return batch;
}

export function newImportTargetId(): string { return randomUUID(); }
