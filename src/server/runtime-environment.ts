export function inheritedRuntimeEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Next.js declares NODE_ENV as required even though a child-process environment may intentionally omit it.
  return Object.fromEntries(Object.entries(environment).filter(([name]) => name !== "NODE_ENV")) as NodeJS.ProcessEnv;
}
