import { createHash, randomBytes } from "node:crypto";
import { basename, resolve } from "node:path";

import type { DashboardResponse, Project, ProjectSnapshot, Reservation, ServerCapacitySettings, ServerCapacityStatus, Worktree } from "@/shared/contracts";
import type { GitWorktreeReader } from "./git-worktrees";
import { type LaunchCommandResolver, type NextTlsConfiguration, NodeLaunchCommandResolver } from "./launch-command";
import { type LogWriter, nullLogWriter } from "./log-writer";
import { ProcessManager } from "./process-manager";
import type { NewProject, ReservationRequest, StateStore } from "./state-store";

const AGENT_LEASE_DEFAULT_SECONDS = 30 * 60;
const AGENT_LEASE_MAX_SECONDS = 8 * 60 * 60;

interface OperationActor {
  owner: string;
  leaseToken?: string;
}

export interface AgentClaimRequest {
  projectId: string;
  worktreePath: string;
  owner: string;
  reason: string;
  idempotencyKey: string;
  ttlSeconds?: number;
}

export interface AgentClaimResult {
  reservation: Reservation;
  leaseToken: string;
  snapshot: ProjectSnapshot;
  operationError: string | null;
}

function leaseTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class ControlService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly pendingStarts = new Set<string>();

  constructor(
    private readonly store: StateStore,
    private readonly git: GitWorktreeReader,
    private readonly processes: ProcessManager,
    private readonly logs: LogWriter = nullLogWriter,
    private readonly commands: LaunchCommandResolver = new NodeLaunchCommandResolver(),
  ) {}

  async dashboard(): Promise<DashboardResponse> {
    const projects = await Promise.all(this.store.listProjects().map((project) => this.snapshot(project)));
    return { projects, capacity: this.capacityStatus(projects) };
  }

  serverCapacity(): ServerCapacityStatus {
    return this.capacityStatus();
  }

  setServerCapacity(settings: ServerCapacitySettings): ServerCapacityStatus {
    if (typeof settings.enabled !== "boolean" || !Number.isInteger(settings.limit) || settings.limit < 1 || settings.limit > 64) {
      throw new Error("Limit serwerów musi być liczbą całkowitą od 1 do 64.");
    }
    this.store.setServerCapacitySettings(settings);
    this.logs.controller("server_capacity.updated", { ...settings });
    return this.capacityStatus();
  }

  async addProject(input: NewProject): Promise<Project> {
    if (!input.name.trim()) throw new Error("Nazwa projektu jest wymagana.");
    if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) {
      throw new Error("Port musi być liczbą od 1024 do 65535.");
    }
    const repositoryPath = await this.git.canonicalRepositoryPath(resolve(input.repositoryPath));
    const worktrees = await this.git.list(repositoryPath);
    const selected = worktrees[0];
    if (!selected) throw new Error("Repozytorium nie ma dostępnego worktree.");
    const command = this.commands.resolve(selected.path, input.port);
    const project = this.store.addProject({
      ...input,
      name: input.name.trim(),
      repositoryPath,
      executable: command.executable,
      args: command.args,
    });
    this.store.setSelectedWorktree(project.id, selected.path);
    this.logs.controller("project.added", {
      projectId: project.id,
      repositoryPath,
      port: input.port,
      executable: command.executable,
      args: command.args,
      portMethod: command.portMethod,
    });
    return this.requireProject(project.id);
  }

  async operate(
    projectId: string,
    operation: "start" | "stop" | "restart" | "switch",
    worktreePath?: string,
    actor: OperationActor = { owner: "local-user" },
  ): Promise<void> {
    try {
      await this.serialized(projectId, async () => {
        const project = this.requireProject(projectId);
        if (operation === "stop") {
          this.assertReservationAllows(
            projectId,
            this.processes.snapshot(projectId).worktreePath ?? project.selectedWorktreePath,
            actor,
          );
          await this.processes.stop(projectId);
          this.logs.controller("project.stopped", { projectId });
          return;
        }
        const worktrees = await this.git.list(project.repositoryPath);
        const selected = this.resolveWorktree(project, worktrees, worktreePath);
        this.assertReservationAllows(projectId, selected.path, actor);
        this.acquireCapacity(project);
        try {
          if (operation === "restart" || operation === "switch") await this.processes.stop(projectId);
          if (operation === "switch") this.store.setSelectedWorktree(projectId, selected.path);
          await this.processes.start(this.requireProject(projectId), selected.path);
        } finally {
          this.pendingStarts.delete(projectId);
        }
        this.logs.controller(`project.${operation}`, { projectId, worktreePath: selected.path });
      });
    } catch (error) {
      this.logs.controller("project.operation_failed", {
        projectId,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async setProjectTls(projectId: string, input: NextTlsConfiguration): Promise<void> {
    await this.serialized(projectId, async () => {
      const project = this.requireProject(projectId);
      const phase = this.processes.snapshot(projectId).phase;
      if (phase === "running" || phase === "starting" || phase === "stopping") {
        throw new Error("Zatrzymaj serwer przed zmianą ustawień HTTPS.");
      }
      const worktrees = await this.git.list(project.repositoryPath);
      const selected = this.resolveWorktree(project, worktrees);
      this.assertReservationAllows(projectId, selected.path, { owner: "local-user" });
      const command = this.commands.resolve(selected.path, project.port, input);
      this.store.updateProjectLaunch(projectId, {
        tlsMode: command.tls.mode,
        tlsKeyPath: command.tls.keyPath,
        tlsCertPath: command.tls.certPath,
        tlsCaPath: command.tls.caPath,
        executable: command.executable,
        args: command.args,
      });
      this.logs.controller("project.tls_changed", {
        projectId,
        mode: command.tls.mode,
        keyPath: command.tls.keyPath,
        certPath: command.tls.certPath,
        caPath: command.tls.caPath,
      });
    });
  }

  async reserve(input: ReservationRequest): Promise<void> {
    await this.serialized(input.projectId, async () => {
      const project = this.requireProject(input.projectId);
      const worktrees = await this.git.list(project.repositoryPath);
      const selected = this.resolveWorktree(project, worktrees, input.worktreePath);
      this.store.acquireReservation({ ...input, worktreePath: selected.path });
      this.logs.controller("reservation.acquired", { projectId: input.projectId, worktreePath: selected.path, owner: input.owner });
    });
  }

  async release(projectId: string, force = false): Promise<void> {
    await this.serialized(projectId, async () => {
      this.requireProject(projectId);
      this.store.releaseReservation(projectId, "local-user", force);
      this.logs.controller(force ? "reservation.force_released" : "reservation.released", { projectId });
    });
  }

  async claimProject(input: AgentClaimRequest, existingLeaseToken?: string): Promise<AgentClaimResult> {
    return this.serialized(input.projectId, async () => {
      const ttlSeconds = input.ttlSeconds ?? AGENT_LEASE_DEFAULT_SECONDS;
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > AGENT_LEASE_DEFAULT_SECONDS) {
        throw new Error(`Agent lease TTL must be between 30 and ${AGENT_LEASE_DEFAULT_SECONDS} seconds.`);
      }
      if (!input.owner.startsWith("agent:mcp:")) throw new Error("Invalid MCP agent owner.");
      if (!input.reason.trim()) throw new Error("A claim reason is required.");
      if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 120) throw new Error("Invalid idempotency key.");

      const project = this.requireProject(input.projectId);
      const worktrees = await this.git.list(project.repositoryPath);
      const selected = this.resolveWorktree(project, worktrees, input.worktreePath);
      const leaseToken = existingLeaseToken ?? randomBytes(32).toString("base64url");
      const reservation = this.store.acquireReservation({
        projectId: input.projectId,
        worktreePath: selected.path,
        kind: "agent",
        owner: input.owner,
        reason: input.reason.trim(),
        ttlSeconds,
        maximumLifetimeSeconds: AGENT_LEASE_MAX_SECONDS,
        leaseTokenHash: leaseTokenHash(leaseToken),
        idempotencyKey: input.idempotencyKey,
      });

      let operationError: string | null = null;
      try {
        this.assertReservationAllows(input.projectId, selected.path, { owner: input.owner, leaseToken });
        const runtime = this.processes.snapshot(input.projectId);
        if (runtime.phase !== "running" || runtime.worktreePath !== selected.path) {
          this.acquireCapacity(project);
          try {
            if (runtime.phase !== "stopped") await this.processes.stop(input.projectId);
            if (project.selectedWorktreePath !== selected.path) this.store.setSelectedWorktree(input.projectId, selected.path);
            await this.processes.start(this.requireProject(input.projectId), selected.path);
          } finally {
            this.pendingStarts.delete(input.projectId);
          }
        }
      } catch (error) {
        operationError = error instanceof Error ? error.message : String(error);
        this.logs.controller("agent.claim_switch_failed", {
          projectId: input.projectId,
          reservationId: reservation.id,
          owner: input.owner,
          error: operationError,
        });
      }
      this.logs.controller("agent.claimed", {
        projectId: input.projectId,
        reservationId: reservation.id,
        owner: input.owner,
        worktreePath: selected.path,
      });
      return {
        reservation,
        leaseToken,
        snapshot: await this.snapshot(this.requireProject(input.projectId)),
        operationError,
      };
    });
  }

  renewAgentClaim(projectId: string, reservationId: string, owner: string, leaseToken: string, ttlSeconds = AGENT_LEASE_DEFAULT_SECONDS): Reservation {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > AGENT_LEASE_DEFAULT_SECONDS) {
      throw new Error(`Agent lease TTL must be between 30 and ${AGENT_LEASE_DEFAULT_SECONDS} seconds.`);
    }
    const reservation = this.store.renewAgentReservation(
      projectId,
      reservationId,
      owner,
      leaseTokenHash(leaseToken),
      ttlSeconds,
    );
    this.logs.controller("agent.claim_renewed", { projectId, reservationId, owner, expiresAt: reservation.expiresAt });
    return reservation;
  }

  releaseAgentClaim(projectId: string, reservationId: string, owner: string, leaseToken: string): void {
    this.store.releaseAgentReservation(projectId, reservationId, owner, leaseTokenHash(leaseToken));
    this.logs.controller("agent.claim_released", { projectId, reservationId, owner });
  }

  async projectSnapshot(projectId: string): Promise<ProjectSnapshot> {
    return this.snapshot(this.requireProject(projectId));
  }

  async shutdown(): Promise<void> {
    await this.processes.stopAll();
    this.store.close();
    await this.logs.close();
  }

  private async snapshot(project: Project): Promise<ProjectSnapshot> {
    try {
      return {
        project,
        runtime: this.processes.snapshot(project.id),
        reservation: this.store.getActiveReservation(project.id),
        worktrees: await this.git.list(project.repositoryPath),
      };
    } catch (error) {
      return {
        project,
        runtime: this.processes.snapshot(project.id),
        reservation: this.store.getActiveReservation(project.id),
        worktrees: [],
        discoveryError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private resolveWorktree(project: Project, worktrees: Worktree[], requested?: string): Worktree {
    const path = requested ?? project.selectedWorktreePath ?? worktrees[0]?.path;
    const selected = worktrees.find((worktree) => worktree.path === path);
    if (!selected) throw new Error("Worktree nie należy do zarejestrowanego repozytorium lub już nie istnieje.");
    if (selected.prunable) throw new Error("Nie można uruchomić uszkodzonego worktree oznaczonego jako prunable.");
    return selected;
  }

  private assertReservationAllows(projectId: string, worktreePath: string | null, actor: OperationActor): void {
    const reservation = this.store.authorizeReservation(
      projectId,
      actor.owner,
      actor.leaseToken ? leaseTokenHash(actor.leaseToken) : undefined,
    );
    if (reservation && reservation.worktreePath !== worktreePath) {
      throw new Error(`Projekt jest zablokowany na ${basename(reservation.worktreePath)} przez ${reservation.owner}.`);
    }
  }

  private requireProject(id: string): Project {
    const project = this.store.getProject(id);
    if (!project) throw new Error("Nie znaleziono projektu.");
    return project;
  }

  private acquireCapacity(project: Project): void {
    const status = this.capacityStatus();
    if (status.holders.some(({ projectId }) => projectId === project.id)) {
      this.pendingStarts.add(project.id);
      return;
    }
    if (status.enabled && status.used >= status.limit) {
      const holders = status.holders.map(({ projectName }) => projectName).join(", ");
      throw new Error(`Osiągnięto limit ${status.limit} uruchomionych serwerów. Aktywne: ${holders || "brak"}.`);
    }
    this.pendingStarts.add(project.id);
  }

  private capacityStatus(snapshots?: ProjectSnapshot[]): ServerCapacityStatus {
    const settings = this.store.getServerCapacitySettings();
    const projects: Array<Pick<ProjectSnapshot, "project" | "runtime">> = snapshots
      ?? this.store.listProjects().map((project) => ({
        project,
        runtime: this.processes.snapshot(project.id),
      }));
    const holders = projects.flatMap(({ project, runtime }) => {
      const pending = this.pendingStarts.has(project.id);
      if (!pending && runtime.phase !== "starting" && runtime.phase !== "running" && runtime.phase !== "stopping") return [];
      const phase: ServerCapacityStatus["holders"][number]["phase"] = runtime.phase === "running" || runtime.phase === "stopping"
        ? runtime.phase
        : "starting";
      return [{
        projectId: project.id,
        projectName: project.name,
        phase,
      }];
    });
    return {
      ...settings,
      used: holders.length,
      available: settings.enabled ? Math.max(0, settings.limit - holders.length) : null,
      holders,
    };
  }

  private async serialized<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.locks.set(projectId, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(projectId) === current) this.locks.delete(projectId);
    }
  }
}
