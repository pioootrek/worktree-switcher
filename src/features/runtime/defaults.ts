import type { RuntimeResourceMetrics } from "@/shared/contracts";

export const EMPTY_RESOURCES: RuntimeResourceMetrics = { status: "idle", currentRssBytes: null, peakRssBytes: null, cpuPercent: null, processCount: null, sampledAt: null, sampleAgeSeconds: null, warningThresholdBytes: null, history: [] };
