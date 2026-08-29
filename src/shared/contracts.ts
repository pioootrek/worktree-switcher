export type RuntimePhase = "stopped" | "starting" | "running" | "stopping" | "failed";
export type DevServerTlsMode = "off" | "generated" | "custom";

export interface Project {
  id: string;
  name: string;
  repositoryPath: string;
  port: number;
  tlsMode: DevServerTlsMode;
  tlsKeyPath: string | null;
  tlsCertPath: string | null;
  tlsCaPath: string | null;
  executable: string;
  args: string[];
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
}

export interface RuntimeSnapshot {
  phase: RuntimePhase;
  pid: number | null;
  worktreePath: string | null;
  startedAt: string | null;
  error: string | null;
  failure: RuntimeFailure | null;
  logs: string[];
}

export interface RuntimeFailure {
  code: "port_in_use" | "missing_dev_script" | "invalid_arguments" | "missing_executable" | "resource_limit" | "startup_timeout" | "process_exit";
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
  discoveryError?: string;
}

export interface DashboardResponse {
  projects: ProjectSnapshot[];
}

export interface DirectoryListing {
  root: string;
  current: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
  files: Array<{ name: string; path: string }>;
}
