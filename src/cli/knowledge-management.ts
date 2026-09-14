import { readFileSync, statSync } from "node:fs";
import type { AppPaths } from "../server/paths";
import { knowledgeSchemas, type KnowledgeOperation, type KnowledgeFailure } from "../shared/contracts/knowledge";
import { localDashboardEndpoint, readServiceAccess } from "./service-access";

export async function runKnowledgeCommand(args: string[], paths: AppPaths, dependencies: {
  write?: (line: string) => void;
  environment?: Readonly<Record<string, string | undefined>>;
} = {}): Promise<void> {
  const operation = args[0];
  if (!operation || !Object.hasOwn(knowledgeSchemas, operation)) throw new Error(`Usage: knowledge <${Object.keys(knowledgeSchemas).join("|")}> [--json '<input> ' | --input-file <path>]`);
  if (args.length !== 1 && !(args.length === 3 && ["--json", "--input-file"].includes(args[1]!))) throw new Error("Use --json or --input-file with one JSON object.");
  let source = "{}";
  if (args[1] === "--input-file") {
    if (statSync(args[2]!).size > 65536) throw new Error("limit_exceeded: Knowledge input exceeds 64 KiB.");
    source = readFileSync(args[2]!, "utf8");
  } else if (args[1] === "--json") source = args[2]!;
  let input: unknown;
  try { input = JSON.parse(source); } catch { throw new Error("invalid_request: Invalid JSON."); }
  const parsed = knowledgeSchemas[operation as KnowledgeOperation].safeParse(input);
  if (!parsed.success) throw new Error("invalid_request: Invalid knowledge input.");
  const body = JSON.stringify({ operation, input: parsed.data });
  if (Buffer.byteLength(body) > 65536) throw new Error("limit_exceeded: Knowledge request exceeds 64 KiB.");
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
