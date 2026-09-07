import type { OperationActor } from "../lifecycle";

/** Profile changes already hold the project lock while stopping and restarting. */
export interface ProfileRuntime {
  operateLocked(projectId: string, operation: "start" | "stop", worktreePath: string | undefined, actor: OperationActor): Promise<void>;
}
