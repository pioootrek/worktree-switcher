import type { DevServerTlsMode, Project, Reservation } from "@/shared/contracts";

export interface NewProject {
  name: string;
  repositoryPath: string;
  port: number;
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
  getActiveReservation(projectId: string): Reservation | null;
  acquireReservation(input: ReservationRequest): Reservation;
  authorizeReservation(projectId: string, owner: string, leaseTokenHash?: string): Reservation | null;
  renewAgentReservation(projectId: string, reservationId: string, owner: string, leaseTokenHash: string, ttlSeconds: number): Reservation;
  releaseAgentReservation(projectId: string, reservationId: string, owner: string, leaseTokenHash: string): void;
  releaseReservation(projectId: string, owner: string, force?: boolean): void;
  close(): void;
}
