import type { McpStatus, ServerCapacityStatus, TestQueueStatus } from "@/shared/contracts";

export const EMPTY_CAPACITY: ServerCapacityStatus = { enabled: false, limit: 2, used: 0, available: null, holders: [] };
export const EMPTY_TEST_QUEUE: TestQueueStatus = { limit: 1, running: 0, queued: 0 };

export const EMPTY_MCP_STATUS: McpStatus = {
  phase: "unknown",
  endpoint: null,
  transport: "streamable-http",
  network: "loopback",
  authentication: "bearer",
  activeSessions: 0,
};
