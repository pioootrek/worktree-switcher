import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

const args = ["--import", "tsx", "src/cli/index.ts", "start", "--web-root", "out"];
const pilotRoot = process.env.WORKTREE_SWITCHER_PILOT_ROOT;
if (pilotRoot) {
  const root = resolve(pilotRoot);
  const port = Number(process.env.PORT);
  const mcpPort = Number(process.env.WORKTREE_SWITCHER_PILOT_MCP_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(mcpPort) || mcpPort < 1024 || mcpPort > 65535 || port === mcpPort) throw new Error("Pilot requires managed HTTP placement and a separate MCP port.");
  const marker = JSON.parse(readFileSync(join(root, "pilot.json"), "utf8"));
  if (marker.liveWrites !== false || !existsSync(join(root, "report.json"))) throw new Error("Prepare and verify the isolated pilot before starting its dashboard.");
  args.push("--data-dir", join(root, "data"), "--state-dir", join(root, "state"), "--host", "127.0.0.1", "--port", String(port), "--mcp-port", String(mcpPort), "--no-open", "--service-mode");
}
args.push(...process.argv.slice(2));
const child = spawn(process.execPath, args, { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
