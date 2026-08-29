#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { systemLocale, translate } from "../i18n/messages";
import { openBrowser } from "./browser";
import { writeCliLine } from "./output";
import { pairingUrl } from "./pairing-url";
import { ControlService } from "../server/control-service";
import { DirectoryBrowser } from "../server/directory-browser";
import { EventStream } from "../server/events";
import { FileLogWriter } from "../server/log-writer";
import { SystemGitWorktreeReader } from "../server/git-worktrees";
import { createControllerServer } from "../server/http-server";
import { resolveAppPaths } from "../server/paths";
import { ProcessManager } from "../server/process-manager";
import { SqliteStateStore } from "../server/sqlite-store";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const locale = systemLocale(process.env);
  const command = process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : "start";
  const paths = resolveAppPaths(option("--data-dir"), option("--state-dir"));
  if (command === "config" && process.argv[3] === "path") {
    console.log(paths.databasePath);
    return;
  }
  if (command !== "start") {
    console.error(translate(locale, "cli.commands"));
    process.exitCode = 1;
    return;
  }

  const host = option("--host") ?? "0.0.0.0";
  const port = Number(option("--port") ?? 47831);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(translate(locale, "cli.invalidPort"));
  const defaultWebRoot = resolve(fileURLToPath(new URL("../../out", import.meta.url)));
  const webRoot = resolve(option("--web-root") ?? defaultWebRoot);
  if (!existsSync(webRoot)) throw new Error(translate(locale, "cli.missingPanel", { path: webRoot }));

  const events = new EventStream();
  const logs = new FileLogWriter(paths.logDirectory);
  const store = new SqliteStateStore(paths.databasePath);
  const processes = new ProcessManager(events.publish, logs);
  const service = new ControlService(store, new SystemGitWorktreeReader(), processes, logs);
  const accessToken = randomBytes(32).toString("base64url");
  const sessionId = randomBytes(8).toString("hex");
  const controller = createControllerServer({
    service,
    directoryBrowser: new DirectoryBrowser(option("--browse-root") ?? homedir()),
    events,
    webRoot,
    host,
    port,
    accessToken,
  });

  await new Promise<void>((resolveListen, reject) => {
    controller.server.once("error", reject);
    controller.server.listen(port, host, resolveListen);
  });
  const browserHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const lanHost = host === "0.0.0.0" ? findLanAddress() ?? browserHost : host;
  const localAddress = pairingUrl(browserHost, port, accessToken, sessionId);
  const lanAddress = pairingUrl(lanHost, port, accessToken, sessionId);
  writeCliLine(translate(locale, "cli.listening", { host, port }));
  writeCliLine(translate(locale, "cli.accessLink", { url: lanAddress }));
  writeCliLine(translate(locale, "cli.logs", { path: paths.logDirectory }));
  writeCliLine(translate(locale, "cli.secret"));

  if (!process.argv.includes("--no-open")) openBrowser(localAddress);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    writeCliLine(translate(locale, "cli.stopping"));
    await controller.close();
    await service.shutdown();
  };
  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}

function findLanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
