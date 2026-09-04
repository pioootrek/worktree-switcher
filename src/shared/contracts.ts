export type RuntimePhase = "stopped" | "starting" | "running" | "stopping" | "failed";
export type DevServerTlsMode = "off" | "generated" | "custom";
export type LaunchPreset = "auto" | "node" | "django";
export type TestAdapterKind = "node" | "django";
export type TestRunPhase = "queued" | "running" | "passed" | "failed" | "cancelled" | "timed_out" | "interrupted";

export interface TestPreset {
  id: string;
  name: string;
  adapter: TestAdapterKind;
  timeoutMs: number;
}

/** A discovered preset together with the test environment profile that would be applied. */
export interface DiscoveredTestPreset extends TestPreset {
  profile: string;
}

export interface WorktreeTestPresets {
  worktreePath: string;
  presets: DiscoveredTestPreset[];
  error: string | null;
}

export type TestEnvironmentMode = "clean" | "inherit-server-profile";

export interface TestEnvironmentPolicy {
  mode: TestEnvironmentMode;
  serverProfile: string | null;
}

export interface TestEnvironmentProfile {
  name: string;
  policy: TestEnvironmentPolicy;
  environment: Record<string, string>;
  nodeEnv: "development" | "production" | "test" | null;
  requiredVariables: string[];
}

export interface RedactedTestEnvironmentProfile extends Omit<TestEnvironmentProfile, "environment"> {
  variableNames: string[];
}

export interface TestRun {
  id: string;
  projectId: string;
  worktreePath: string;
  worktreeHead: string;
  worktreeBranch: string | null;
  worktreeDirty: boolean;
  presetId: string;
  presetName: string;
  adapter: TestAdapterKind;
  actor: string;
  phase: TestRunPhase;
  queuePosition: number | null;
  executable: string;
  args: string[];
  cwd: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  logs: string[];
  environmentMode: TestEnvironmentMode;
  environmentProfile: string;
  inheritedServerProfile: string | null;
  environmentVariableNames: string[];
}

export interface TestQueueSettings {
  limit: number;
}

export interface TestQueueStatus extends TestQueueSettings {
  running: number;
  queued: number;
}

export interface EnvironmentProfile {
  name: string;
  environment: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  repositoryPath: string;
  port: number;
  launchPreset: LaunchPreset;
  tlsMode: DevServerTlsMode;
  tlsKeyPath: string | null;
  tlsCertPath: string | null;
  tlsCaPath: string | null;
  executable: string;
  args: string[];
  environment: Record<string, string>;
  environmentProfiles: EnvironmentProfile[];
  selectedEnvironmentProfile: string;
  testEnvironmentProfiles: TestEnvironmentProfile[];
  testPresetProfiles: Record<string, string>;
  healthcheckPath: string;
  startupTimeoutMs: number;
  selectedWorktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Worktree {
  path: string;
  head: string;
  shortHead: string;
  branch: string | null;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  dirty: boolean;
}

export interface Reservation {
  id: string;
  projectId: string;
  worktreePath: string;
  kind: "human" | "agent";
  owner: string;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  maximumExpiresAt: string | null;
}

export interface RuntimeSnapshot {
  phase: RuntimePhase;
  pid: number | null;
  worktreePath: string | null;
  startedAt: string | null;
  error: string | null;
  failure: RuntimeFailure | null;
  logs: string[];
  resources: RuntimeResourceMetrics;
}

export type ResourceMetricsStatus = "idle" | "available" | "stale" | "unavailable" | "unsupported";

export interface ResourceHistoryPoint {
  sampledAt: string;
  rssBytes: number;
}

export interface RuntimeResourceMetrics {
  status: ResourceMetricsStatus;
  currentRssBytes: number | null;
  peakRssBytes: number | null;
  cpuPercent: number | null;
  processCount: number | null;
  sampledAt: string | null;
  sampleAgeSeconds: number | null;
  warningThresholdBytes: number | null;
  history: ResourceHistoryPoint[];
}

export interface RuntimeMetricsResponse {
  projects: Array<{ projectId: string; resources: RuntimeResourceMetrics }>;
}

export interface RuntimeFailure {
  code: "port_in_use" | "missing_dev_script" | "missing_dependency" | "invalid_arguments" | "missing_executable" | "resource_limit" | "startup_timeout" | "process_exit";
  title: string;
  message: string;
  suggestion: string;
  technicalDetails: string;
}

export interface ProjectSnapshot {
  project: Project;
  runtime: RuntimeSnapshot;
  reservation: Reservation | null;
  worktrees: Worktree[];
  storage: WorktreeStorageSnapshot[];
  testPresets: WorktreeTestPresets[];
  testRuns: TestRun[];
  discoveryError?: string;
}

export interface WorktreeStorageHistoryPoint {
  measuredAt: string;
  totalBytes: number;
  nextBytes: number;
  nextCacheBytes: number;
  nodeModulesBytes: number;
}

export interface WorktreeStorageDirectory {
  name: string;
  bytes: number;
}

export interface WorktreeStorageSnapshot {
  worktreePath: string;
  status: "unmeasured" | "pending" | "scanning" | "available" | "unavailable";
  totalBytes: number | null;
  nextBytes: number | null;
  nextCacheBytes: number | null;
  nodeModulesBytes: number | null;
  otherBytes: number | null;
  measuredAt: string | null;
  topDirectories: WorktreeStorageDirectory[];
  history: WorktreeStorageHistoryPoint[];
  error: string | null;
}

export type SafeCacheKind = "next";

export interface CacheDeletionResult {
  cache: SafeCacheKind;
  worktreePath: string;
  removed: boolean;
}

export interface DashboardResponse {
  projects: ProjectSnapshot[];
  capacity: ServerCapacityStatus;
  testQueue: TestQueueStatus;
}

export interface ServerCapacitySettings {
  enabled: boolean;
  limit: number;
}

export interface ServerCapacityHolder {
  projectId: string;
  projectName: string;
  phase: "starting" | "running" | "stopping";
}

export interface ServerCapacityStatus extends ServerCapacitySettings {
  used: number;
  available: number | null;
  holders: ServerCapacityHolder[];
}

export interface McpStatus {
  phase: "running" | "stopped" | "disabled" | "unknown";
  endpoint: string | null;
  transport: "streamable-http";
  network: "loopback";
  authentication: "bearer";
  activeSessions: number;
}

export interface ControllerDashboardResponse extends DashboardResponse {
  mcp: McpStatus;
}

export interface DirectoryListing {
  root: string;
  current: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
  files: Array<{ name: string; path: string }>;
}
