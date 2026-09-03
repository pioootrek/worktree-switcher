export function inheritedRuntimeEnvironment(): NodeJS.ProcessEnv;
export function inheritedRuntimeEnvironment<Value extends string | undefined>(
  environment: Readonly<Record<string, Value>>,
): Record<string, Value>;
export function inheritedRuntimeEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  // Next.js declares NODE_ENV as required even though the returned child-process environment intentionally omits it.
  return Object.fromEntries(Object.entries(environment).filter(([name]) => name !== "NODE_ENV"));
}
