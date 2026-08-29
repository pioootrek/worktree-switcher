import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface AppPaths {
  dataDirectory: string;
  databasePath: string;
  mcpTokenPath: string;
  stateDirectory: string;
  logDirectory: string;
}

export function resolveAppPaths(dataDirectory?: string, stateDirectory?: string): AppPaths {
  const base = resolve(
    dataDirectory ??
      process.env.WORKTREE_SWITCHER_DATA_DIR ??
      process.env.XDG_DATA_HOME ??
      join(homedir(), ".local", "share"),
  );
  const appDirectory = dataDirectory || process.env.WORKTREE_SWITCHER_DATA_DIR
    ? base
    : join(base, "worktree-switcher");
  const stateBase = resolve(
    stateDirectory ??
      process.env.WORKTREE_SWITCHER_STATE_DIR ??
      (dataDirectory ? join(dataDirectory, "state") : process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")),
  );
  const appStateDirectory = stateDirectory || process.env.WORKTREE_SWITCHER_STATE_DIR || dataDirectory
    ? stateBase
    : join(stateBase, "worktree-switcher");

  return {
    dataDirectory: appDirectory,
    databasePath: join(appDirectory, "state.sqlite3"),
    mcpTokenPath: join(appDirectory, "mcp-token"),
    stateDirectory: appStateDirectory,
    logDirectory: join(appStateDirectory, "logs"),
  };
}
