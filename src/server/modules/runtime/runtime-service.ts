import type { GitWorktreeReader } from "@/server/git-worktrees";
import { type LaunchCommandResolver, type NextTlsConfiguration } from "@/server/launch-command";
import { type LogWriter } from "@/server/log-writer";
import type { ProcessManager } from "@/server/process-manager";
import type { StateStore } from "@/server/state-store";
import type { ClaimedRuntimeAction, ClaimedRuntimeReceipt } from "@/shared/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { RuntimeCapacity } from "../lifecycle";
import { type LifecycleAccess, type OperationActor } from "../lifecycle";

export class RuntimeService {
  constructor(
    private readonly store: Pick<StateStore, "setSelectedWorktree" | "updateProjectLaunch" | "recordProjectEvent">,
    private readonly git: Pick<GitWorktreeReader, "list">,
    private readonly processes: Pick<ProcessManager, "snapshot" | "start" | "stop">,
    private readonly logs: Pick<LogWriter, "controller">,
    private readonly commands: LaunchCommandResolver,
    private readonly lifecycle: LifecycleAccess & Pick<RuntimeCapacity, "acquireCapacity" | "releaseCapacity" | "capacityStatus">,
  ) {}

  async operateClaimed(
    projectId: string,
    reservationId: string,
    action: ClaimedRuntimeAction,
    actor: OperationActor,
    signal?: AbortSignal,
    sessionClosed: () => boolean = () => false,
  ): Promise<ClaimedRuntimeReceipt> {
    return this.lifecycle.serialized(projectId, async () => {
      if (signal?.aborted || sessionClosed()) throw new Error("The runtime operation was cancelled before it started.");
      const operationId = randomUUID();
      const project = this.lifecycle.requireProject(projectId);
      const claim = this.lifecycle.requireAgentClaim(projectId, reservationId, actor);
      const actorRef = `mcp:${createHash("sha256").update(actor.owner).digest("hex").slice(0, 12)}`;
      this.store.recordProjectEvent(projectId, "agent.runtime_accepted", actorRef, { operationId, reservationId, action });
      this.logs.controller("agent.runtime_accepted", { operationId, projectId, reservationId, action, actor: actorRef });
      const initial = this.processes.snapshot(projectId);

      let outcome: ClaimedRuntimeReceipt["outcome"] = "completed";
      let operationError: ClaimedRuntimeReceipt["error"] = null;
      try {
        if (initial.pid && initial.worktreePath !== claim.worktreePath) {
          throw new Error("The managed runtime does not match the claimed worktree.");
        }
        if (action === "stop") {
          if (!initial.pid && initial.phase !== "starting" && initial.phase !== "stopping") outcome = "noop";
          else await this.processes.stop(projectId);
        } else if (action === "start" && initial.phase === "running" && initial.worktreePath === claim.worktreePath) {
          outcome = "noop";
        } else {
          const worktrees = await this.git.list(project.repositoryPath);
          const selected = this.lifecycle.resolveWorktree(project, worktrees, claim.worktreePath);
          this.lifecycle.requireAgentClaim(projectId, reservationId, actor);
          this.lifecycle.acquireCapacity(project);
          try {
            if (action === "restart" && initial.pid) {
              await this.processes.stop(projectId);
              this.lifecycle.requireAgentClaim(projectId, reservationId, actor);
            } else if (action === "start" && (initial.pid || initial.phase === "starting" || initial.phase === "stopping")) {
              throw new Error("The managed runtime is busy or still owns a process.");
            }
            const launch = this.commands.resolve(selected.path, project.port, project.launchPreset, {
              mode: project.tlsMode, keyPath: project.tlsKeyPath, certPath: project.tlsCertPath, caPath: project.tlsCaPath,
            });
            if (project.executable !== launch.executable || JSON.stringify(project.args) !== JSON.stringify(launch.args)) {
              this.store.updateProjectLaunch(projectId, {
                tlsMode: launch.tls.mode, tlsKeyPath: launch.tls.keyPath, tlsCertPath: launch.tls.certPath,
                tlsCaPath: launch.tls.caPath, executable: launch.executable, args: launch.args,
              });
            }
            await this.processes.start(this.lifecycle.requireProject(projectId), selected.path, () => {
              if (sessionClosed()) throw new Error("The runtime operation was cancelled before it started.");
              this.lifecycle.requireAgentClaim(projectId, reservationId, actor);
            });
          } finally {
            this.lifecycle.releaseCapacity(projectId);
          }
        }
      } catch (error) {
        outcome = "failed";
        operationError = this.safeOperationError(error, projectId);
      }
      const runtime = this.processes.snapshot(projectId);
      let leaseHeld = false;
      try { this.lifecycle.requireAgentClaim(projectId, reservationId, actor); leaseHeld = true; } catch { /* report current authority */ }
      const capacity = this.lifecycle.capacityStatus();
      const receipt: ClaimedRuntimeReceipt = {
        schemaVersion: 1, operationId, action, projectId, reservationId, outcome, replayed: false,
        observedAt: new Date().toISOString(), port: project.port, claimedWorktreePath: claim.worktreePath,
        runtime: { phase: runtime.phase, worktreePath: runtime.worktreePath, startedAt: runtime.startedAt },
        error: operationError, leaseHeld,
        occupiesCapacity: capacity.holders.some((holder) => holder.projectId === projectId),
        capacity: { enabled: capacity.enabled, limit: capacity.limit, used: capacity.used, available: capacity.available },
      };
      this.logs.controller(`agent.runtime_${outcome}`, {
        operationId, projectId, reservationId, action, outcome, actor: "mcp-agent", errorCode: operationError?.code ?? null,
      });
      this.store.recordProjectEvent(projectId, `agent.runtime_${outcome}`, actorRef, {
        operationId, reservationId, action, outcome, errorCode: operationError?.code ?? null,
      });
      return receipt;
    });
  }

  private safeOperationError(error: unknown, projectId: string): { code: string; message: string } {
    const message = error instanceof Error ? error.message : String(error);
    const runtimeCode = this.processes.snapshot(projectId).failure?.code;
    if (runtimeCode) return { code: runtimeCode, message: "The managed runtime operation failed." };
    if (message.includes("does not match the claimed worktree")) return { code: "runtime_worktree_mismatch", message: "The managed runtime does not match the claimed worktree." };
    if (message.includes("limit")) return { code: "capacity_exhausted", message: "Managed server capacity is exhausted." };
    if (message.includes("worktree")) return { code: "worktree_unavailable", message: "The claimed worktree is unavailable." };
    if (message.includes("busy") || message.includes("owns a process")) return { code: "runtime_busy", message: "The managed runtime is busy." };
    return { code: "runtime_operation_failed", message: "The managed runtime operation failed." };
  }

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
