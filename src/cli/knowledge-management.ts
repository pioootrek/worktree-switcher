import { readFileSync, statSync } from "node:fs";
import type { AppPaths } from "../server/paths";
import { knowledgeSchemas, type KnowledgeOperation, type KnowledgeFailure } from "../shared/contracts/knowledge";
import { localDashboardEndpoint, readServiceAccess } from "./service-access";
import { planHubImport } from "../server/modules/knowledge";

function option(args: string[], name: string): string {
  const index = args.indexOf(name), value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} is required.`);
  return value;
}

export function runHubImportPlanCommand(args: string[], write: (line: string) => void = console.log): void {
  const allowed = new Set(["--repository", "--commit", "--source-id", "--validator-repository"]);
  for (let index = 1; index < args.length; index += 2) if (!allowed.has(args[index]!) || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error("Usage: knowledge plan-import --repository <path> --commit <sha> --source-id <id> --validator-repository <path>");
  write(JSON.stringify(planHubImport({ repository: option(args, "--repository"), commit: option(args, "--commit"), sourceId: option(args, "--source-id"), validatorRepository: option(args, "--validator-repository") }), null, 2));
}

/** Extract global path options before the operation's strict argument validation. */
export function parseKnowledgeCommandArgs(raw: string[]): { args: string[]; dataDir?: string; stateDir?: string } {
  const result: { args: string[]; dataDir?: string; stateDir?: string } = { args: [] };
  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === "--data-dir" || arg === "--state-dir") {
      const value = raw[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a directory path.`);
      result[arg === "--data-dir" ? "dataDir" : "stateDir"] = value;
    } else {
      result.args.push(arg);
      // Input values are opaque; a file name must never become a global flag.
      if ((arg === "--json" || arg === "--input-file") && index + 1 < raw.length) result.args.push(raw[++index]);
    }
  }
  return result;
}

export async function runKnowledgeCommand(args: string[], paths: AppPaths, dependencies: {
  write?: (line: string) => void;
  environment?: Readonly<Record<string, string | undefined>>;
} = {}): Promise<void> {
  if (args[0] === "plan-import") { runHubImportPlanCommand(args, dependencies.write); return; }
  const operation = args[0];
  if (!operation || !Object.hasOwn(knowledgeSchemas, operation)) throw new Error(`Usage: knowledge <${Object.keys(knowledgeSchemas).join("|")}> [--json '<input> ' | --input-file <path>]`);
  if (args.length !== 1 && !(args.length === 3 && ["--json", "--input-file"].includes(args[1]!))) throw new Error("Use --json or --input-file with one JSON object.");
  let source = "{}";
  if (args[1] === "--input-file") {
    if (statSync(args[2]!).size > 14_100_000) throw new Error("limit_exceeded: Knowledge input exceeds the maximum operation size.");
    source = readFileSync(args[2]!, "utf8");
  } else if (args[1] === "--json") source = args[2]!;
  let input: unknown;
  try { input = JSON.parse(source); } catch { throw new Error("invalid_request: Invalid JSON."); }
  const parsed = knowledgeSchemas[operation as KnowledgeOperation].safeParse(input);
  if (!parsed.success) throw new Error("invalid_request: Invalid knowledge input.");
  const body = JSON.stringify({ operation, input: parsed.data });
  if (Buffer.byteLength(body) > (operation === "create_attachment" ? 14_100_000 : 65536)) throw new Error("limit_exceeded: Knowledge request exceeds its operation limit.");
  const environment = dependencies.environment ?? process.env;
  const token = environment.WORKTREE_SWITCHER_KNOWLEDGE_TOKEN ?? environment.WORKTREE_SWITCHER_OWNER_TOKEN;
  if (!token) throw new Error("Set WORKTREE_SWITCHER_KNOWLEDGE_TOKEN to a scoped agent token or owner session.");
  const access = readServiceAccess(paths.serviceAccessPath);
  if (!access) throw new Error("Controller unavailable. Knowledge CLI requires the running service.");
  const response = await fetch(`${localDashboardEndpoint(access).replace(/\/$/, "")}/api/knowledge`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body, redirect: "error", signal: AbortSignal.timeout(30000),
  });
  const result = await response.json() as KnowledgeFailure;
  if (!response.ok) throw new Error(JSON.stringify(result));
  (dependencies.write ?? console.log)(JSON.stringify(result, null, 2));
}
