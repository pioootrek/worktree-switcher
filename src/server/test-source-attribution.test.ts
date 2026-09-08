import { describe, expect, it } from "vitest";
import type { TestSourceObservation } from "@/shared/contracts";
import { compareSource, pendingSourceEvidence, qualifySource } from "./test-source-attribution";

const observation = (overrides: Partial<TestSourceObservation> = {}): TestSourceObservation => ({
  observedAt: "2026-09-08T10:00:00.000Z", head: "aaa", branch: "main", dirty: false,
  statusDigest: "empty", statusEntries: 0, complete: true, errorCode: null, ...overrides,
});

describe("test source attribution", () => {
  it("qualifies only complete clean matching endpoint observations", () => {
    const source = pendingSourceEvidence(observation());
    source.preflight = observation();
    source.finish = observation();
    expect(qualifySource(source)).toMatchObject({ attribution: "observed_match", queueComparison: "match", executionComparison: "match" });
  });

  it("detects status changes at equal HEAD and keeps equal dirty samples uncertain", () => {
    expect(compareSource(observation(), observation({ dirty: true, statusDigest: "modified", statusEntries: 1 }))).toBe("changed");
    const source = pendingSourceEvidence(observation({ dirty: true, statusDigest: "modified", statusEntries: 1 }));
    source.preflight = observation({ dirty: true, statusDigest: "modified", statusEntries: 1 });
    source.finish = observation({ dirty: true, statusDigest: "modified", statusEntries: 1 });
    expect(qualifySource(source)).toMatchObject({ attribution: "uncertain", reasonCodes: ["dirty_source"] });
  });

  it("does not call unavailable fields a detected source change", () => {
    const unavailable = observation({ head: null, branch: null, dirty: null, statusDigest: null, statusEntries: null, complete: false, errorCode: "source_finish_failed" });
    expect(compareSource(observation(), unavailable)).toBe("unknown");
  });
});
