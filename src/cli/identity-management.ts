import type { AppPaths } from "../server/paths";
import { acquireControllerLock } from "../server/controller-lock";
import { IdentityService } from "../server/modules/identity";
import { SqliteStateStore } from "../server/sqlite-store";

export interface IdentityCommandDependencies {
  write?: (line: string) => void;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

export function runIdentityCommand(
  args: string[],
  paths: AppPaths,
  dependencies: IdentityCommandDependencies = {},
): void {
  const action = args[0];
  if (action !== "bootstrap-owner") {
    throw new Error("Available identity command: bootstrap-owner");
  }
  const lifetimeValue = option(args, "--lifetime-seconds");
  const sessionLifetimeSeconds = lifetimeValue === undefined ? undefined : Number(lifetimeValue);
  const label = option(args, "--label");
  const lock = acquireControllerLock(paths.controllerLockPath);
  let store: SqliteStateStore | null = null;
  try {
    store = new SqliteStateStore(paths.databasePath);
    const result = new IdentityService(store).bootstrapOwnerSession({ label, sessionLifetimeSeconds });
    (dependencies.write ?? console.log)(JSON.stringify({
      principalId: result.principalId,
      credential: result.credential,
      token: result.token,
    }, null, 2));
  } finally {
    store?.close();
    lock.release();
  }
}
