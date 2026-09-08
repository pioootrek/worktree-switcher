import type { TestSourceComparison, TestSourceEvidence, TestSourceObservation } from "@/shared/contracts";

/** Observation points owned by the finite verification queue. */
export type TestSourceStage = "preflight" | "finish";
export type TestSourceObserver = (run: { projectId: string; worktreePath: string; presetId: string; cwd: string; executable: string; args: string[] }, stage: TestSourceStage) => Promise<TestSourceObservation>;

export function legacySourceEvidence(): TestSourceEvidence {
  return { version: 1, scope: "git-observations", enqueue: null, preflight: null, finish: null, queueComparison: "unknown", executionComparison: "unknown", attribution: "legacy_unknown", reasonCodes: ["legacy_evidence_unavailable"], processOutcome: null };
}

export function pendingSourceEvidence(enqueue: TestSourceObservation): TestSourceEvidence {
  return { version: 1, scope: "git-observations", enqueue, preflight: null, finish: null, queueComparison: "unknown", executionComparison: "unknown", attribution: "pending", reasonCodes: observationReasons(enqueue), processOutcome: null };
}

export function compareSource(left: TestSourceObservation | null, right: TestSourceObservation | null): TestSourceComparison {
  if (!left || !right) return "unknown";
  if ((left.head !== null && right.head !== null && left.head !== right.head)
    || (left.branch !== null && right.branch !== null && left.branch !== right.branch)
    || (left.statusDigest !== null && right.statusDigest !== null && left.statusDigest !== right.statusDigest)
    || (left.dirty !== null && right.dirty !== null && left.dirty !== right.dirty)) return "changed";
  return left.complete && right.complete ? "match" : "unknown";
}

function observationReasons(...observations: Array<TestSourceObservation | null>): string[] {
  const values = new Set<string>();
  for (const observation of observations) {
    if (!observation) continue;
    if (observation.dirty) values.add("dirty_source");
    if (!observation.complete) values.add(observation.errorCode ?? "source_evidence_incomplete");
  }
  return [...values].slice(0, 12);
}

export function qualifySource(evidence: TestSourceEvidence): TestSourceEvidence {
  const queueComparison = compareSource(evidence.enqueue, evidence.preflight);
  const executionComparison = compareSource(evidence.preflight, evidence.finish);
  const reasonCodes = new Set([...evidence.reasonCodes, ...observationReasons(evidence.enqueue, evidence.preflight, evidence.finish)]);
  if (queueComparison === "changed") reasonCodes.add("source_changed_before_start");
  if (executionComparison === "changed") reasonCodes.add("source_changed_during_execution");
  const complete = evidence.enqueue?.complete && evidence.preflight?.complete && evidence.finish?.complete;
  const clean = evidence.enqueue?.dirty === false && evidence.preflight?.dirty === false && evidence.finish?.dirty === false;
  const attribution = queueComparison === "changed" || executionComparison === "changed" ? "changed"
    : complete && clean && queueComparison === "match" && executionComparison === "match" ? "observed_match" : "uncertain";
  return { ...evidence, queueComparison, executionComparison, attribution, reasonCodes: [...reasonCodes].slice(0, 12) };
}
