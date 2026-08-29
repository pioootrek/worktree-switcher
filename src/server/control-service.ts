import { basename, resolve } from "node:path";

import type { DashboardResponse, Project, ProjectSnapshot, Worktree } from "@/shared/contracts";
import type { GitWorktreeReader } from "./git-worktrees";
import { type LaunchCommandResolver, NodeLaunchCommandResolver } from "./launch-command";
import { type LogWriter, nullLogWriter } from "./log-writer";
import { ProcessManager } from "./process-manager";
import type { NewProject, ReservationRequest, StateStore } from "./state-store";

export class ControlService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: StateStore,
    private readonly git: GitWorktreeReader,
    private readonly processes: ProcessManager,
    private readonly logs: LogWriter = nullLogWriter,
    private readonly commands: LaunchCommandResolver = new NodeLaunchCommandResolver(),
  ) {}

  async dashboard(): Promise<DashboardResponse> {
    const projects = await Promise.all(this.store.listProjects().map((project) => this.snapshot(project)));
    return { projects };
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

  async operate(projectId: string, operation: "start" | "stop" | "restart" | "switch", worktreePath?: string): Promise<void> {
    try {
      await this.serialized(projectId, async () => {
        const project = this.requireProject(projectId);
        if (operation === "stop") {
          await this.processes.stop(projectId);
          this.logs.controller("project.stopped", { projectId });
          return;
        }
        const worktrees = await this.git.list(project.repositoryPath);
        const selected = this.resolveWorktree(project, worktrees, worktreePath);
        this.assertReservationAllows(projectId, selected.path);
        if (operation === "restart" || operation === "switch") await this.processes.stop(projectId);
        if (operation === "switch") this.store.setSelectedWorktree(projectId, selected.path);
        await this.processes.start(this.requireProject(projectId), selected.path);
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

  async reserve(input: ReservationRequest): Promise<void> {
    const project = this.requireProject(input.projectId);
    const worktrees = await this.git.list(project.repositoryPath);
    const selected = this.resolveWorktree(project, worktrees, input.worktreePath);
    this.store.acquireReservation({ ...input, worktreePath: selected.path });
    this.logs.controller("reservation.acquired", { projectId: input.projectId, worktreePath: selected.path, owner: input.owner });
  }

  release(projectId: string, force = false): void {
    this.requireProject(projectId);
    this.store.releaseReservation(projectId, "local-user", force);
    this.logs.controller(force ? "reservation.force_released" : "reservation.released", { projectId });
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

  private assertReservationAllows(projectId: string, worktreePath: string): void {
    const reservation = this.store.getActiveReservation(projectId);
    if (reservation && reservation.worktreePath !== worktreePath) {
      throw new Error(`Projekt jest zablokowany na ${basename(reservation.worktreePath)} przez ${reservation.owner}.`);
    }
  }

  private requireProject(id: string): Project {
    const project = this.store.getProject(id);
    if (!project) throw new Error("Nie znaleziono projektu.");
    return project;
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
