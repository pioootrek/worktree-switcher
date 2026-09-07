import type { GitWorktreeReader } from "@/server/git-worktrees";
import { type LaunchCommandResolver, type NextTlsConfiguration } from "@/server/launch-command";
import { type LogWriter } from "@/server/log-writer";
import type { ProcessManager } from "@/server/process-manager";
import type { StateStore } from "@/server/state-store";
import type { RuntimeCapacity } from "../lifecycle";
import { type LifecycleAccess, type OperationActor } from "../lifecycle";

export class RuntimeService {
  constructor(
    private readonly store: Pick<StateStore, "setSelectedWorktree" | "updateProjectLaunch">,
    private readonly git: Pick<GitWorktreeReader, "list">,
    private readonly processes: Pick<ProcessManager, "snapshot" | "start" | "stop">,
    private readonly logs: Pick<LogWriter, "controller">,
    private readonly commands: LaunchCommandResolver,
    private readonly lifecycle: LifecycleAccess & Pick<RuntimeCapacity, "acquireCapacity" | "releaseCapacity">,
  ) {}

  async operate(
    projectId: string,
    operation: "start" | "stop" | "restart" | "switch",
    worktreePath?: string,
    actor: OperationActor = { owner: "local-user" },
  ): Promise<void> {
    try {
      await this.lifecycle.serialized(projectId, () => this.operateLocked(projectId, operation, worktreePath, actor));
    } catch (error) {
      this.logs.controller("project.operation_failed", {
        projectId,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async operateLocked(
    projectId: string,
    operation: "start" | "stop" | "restart" | "switch",
    worktreePath: string | undefined,
    actor: OperationActor,
  ): Promise<void> {
    const project = this.lifecycle.requireProject(projectId);
    if (operation === "stop") {
      this.lifecycle.assertReservationAllows(
        projectId,
        this.processes.snapshot(projectId).worktreePath ?? project.selectedWorktreePath,
        actor,
      );
      await this.processes.stop(projectId);
      this.logs.controller("project.stopped", { projectId });
      return;
    }
    const worktrees = await this.git.list(project.repositoryPath);
    const selected = this.lifecycle.resolveWorktree(project, worktrees, worktreePath);
    this.lifecycle.assertReservationAllows(projectId, selected.path, actor);
    this.lifecycle.acquireCapacity(project);
    try {
      if (operation === "restart" || operation === "switch") await this.processes.stop(projectId);
      if (operation === "switch") this.store.setSelectedWorktree(projectId, selected.path);
      const launch = this.commands.resolve(selected.path, project.port, project.launchPreset, {
        mode: project.tlsMode,
        keyPath: project.tlsKeyPath,
        certPath: project.tlsCertPath,
        caPath: project.tlsCaPath,
      });
      if (project.executable !== launch.executable || JSON.stringify(project.args) !== JSON.stringify(launch.args)) {
        this.store.updateProjectLaunch(projectId, {
          tlsMode: launch.tls.mode,
          tlsKeyPath: launch.tls.keyPath,
          tlsCertPath: launch.tls.certPath,
          tlsCaPath: launch.tls.caPath,
          executable: launch.executable,
          args: launch.args,
        });
      }
      await this.processes.start(this.lifecycle.requireProject(projectId), selected.path);
    } finally {
      this.lifecycle.releaseCapacity(projectId);
    }
    this.logs.controller(`project.${operation}`, { projectId, worktreePath: selected.path });
  }

  async setProjectTls(projectId: string, input: NextTlsConfiguration): Promise<void> {
    await this.lifecycle.serialized(projectId, async () => {
      const project = this.lifecycle.requireProject(projectId);
      const phase = this.processes.snapshot(projectId).phase;
      if (phase === "running" || phase === "starting" || phase === "stopping") {
        throw new Error("Zatrzymaj serwer przed zmianą ustawień HTTPS.");
      }
      const worktrees = await this.git.list(project.repositoryPath);
      const selected = this.lifecycle.resolveWorktree(project, worktrees);
      this.lifecycle.assertReservationAllows(projectId, selected.path, { owner: "local-user" });
      if (project.launchPreset === "django") throw new Error("HTTPS zarządzany przez Switcher jest obecnie obsługiwany tylko dla Next.js.");
      const command = this.commands.resolve(selected.path, project.port, project.launchPreset, input);
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
}
