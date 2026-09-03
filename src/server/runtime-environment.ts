export function inheritedRuntimeEnvironment(): Omit<NodeJS.ProcessEnv, "NODE_ENV">;
export function inheritedRuntimeEnvironment<Value extends string | undefined>(
  environment: Readonly<Record<string, Value>>,
): Record<string, Value>;
export function inheritedRuntimeEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => name !== "NODE_ENV"));
}
