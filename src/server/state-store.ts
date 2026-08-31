import type { DevServerTlsMode, LaunchPreset, Project, Reservation, ServerCapacitySettings, WorktreeStorageHistoryPoint, WorktreeStorageSnapshot } from "@/shared/contracts";

export interface WorktreeStorageSample extends WorktreeStorageHistoryPoint {
  projectId: string;
  worktreePath: string;
  topDirectories: Array<{ name: string; bytes: number }>;
}

export interface NewProject {
  name: string;
  repositoryPath: string;
  port: number;
  launchPreset?: LaunchPreset;
}

export interface ProjectRegistration extends NewProject {
  executable: string;
  args: string[];
}

export interface ProjectLaunchUpdate {
  tlsMode: DevServerTlsMode;
  tlsKeyPath: string | null;
  tlsCertPath: string | null;
  tlsCaPath: string | null;
  executable: string;
  args: string[];
}

export interface ReservationRequest {
  projectId: string;
  worktreePath: string;
  kind: "human" | "agent";
  owner: string;
  reason?: string;
  ttlSeconds?: number;
  maximumLifetimeSeconds?: number;
  leaseTokenHash?: string;
  idempotencyKey?: string;
}

export interface StateStore {
  listProjects(): Project[];
  getProject(id: string): Project | null;
  addProject(input: ProjectRegistration): Project;
  updateProjectLaunch(projectId: string, input: ProjectLaunchUpdate): void;
  setSelectedWorktree(projectId: string, path: string): void;
  getServerCapacitySettings(): ServerCapacitySettings;
  setServerCapacitySettings(settings: ServerCapacitySettings): void;
  getWorktreeStorage(projectId: string, worktreePath: string): WorktreeStorageSnapshot | null;
  saveWorktreeStorage(sample: WorktreeStorageSample): void;
  recordProjectEvent(projectId: string, eventType: string, actor: string, details: unknown): void;
  getActiveReservation(projectId: string): Reservation | null;
  acquireReservation(input: ReservationRequest): Reservation;
  authorizeReservation(projectId: string, owner: string, leaseTokenHash?: string): Reservation | null;
  renewAgentReservation(projectId: string, reservationId: string, owner: string, leaseTokenHash: string, ttlSeconds: number): Reservation;
  releaseAgentReservation(projectId: string, reservationId: string, owner: string, leaseTokenHash: string): void;
  releaseReservation(projectId: string, owner: string, force?: boolean): void;
  close(): void;
}
