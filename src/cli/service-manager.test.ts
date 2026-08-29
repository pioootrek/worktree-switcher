import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderLaunchAgent, renderSystemdUnit, type ServiceCommandRunner, UserServiceManager } from "./service-manager";

const directories: string[] = [];
const installOptions = {
  nodePath: "/opt/node/bin/node",
  entrypointPath: "/opt/worktree switcher/dist/cli/index.js",
  workingDirectory: "/opt/worktree switcher",
  startArguments: ["--service-mode", "--no-open", "--data-dir", "/home/me/data%dir"],
  stateDirectory: "/home/me/state",
  refresh: false,
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("user service definitions", () => {
  it("renders a bounded user systemd service without secrets", () => {
    const unit = renderSystemdUnit(installOptions);
    expect(unit).toContain('ExecStart="/opt/node/bin/node" "/opt/worktree switcher/dist/cli/index.js" "start"');
    expect(unit).toContain("WorkingDirectory=/opt/worktree\\x20switcher");
    expect(unit).toContain('"/home/me/data%%dir"');
    expect(unit).toContain("Restart=on-failure\nRestartSec=5");
    expect(unit).toContain("KillMode=control-group");
    expect(unit).toContain('Environment="PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin"');
    expect(unit).not.toContain("token=");
  });

  it("renders a LaunchAgent with XML-safe argument arrays and private log paths", () => {
    const plist = renderLaunchAgent({ ...installOptions, startArguments: ["--browse-root", "/Users/me/a&b"] });
    expect(plist).toContain("<string>/Users/me/a&amp;b</string>");
    expect(plist).toContain("<key>SuccessfulExit</key><false/>");
    expect(plist).toContain("<key>AbandonProcessGroup</key>\n  <false/>");
    expect(plist).toContain("/home/me/state/logs/service.stderr.log");
    expect(plist).toContain("<key>PATH</key><string>/opt/node/bin:/usr/local/bin:/usr/bin:/bin</string>");
    expect(plist).not.toContain("token=");
  });
});

describe("UserServiceManager", () => {
  it("installs idempotently and requires refresh when the executable changes", () => {
    const home = mkdtempSync(join(tmpdir(), "worktree-switcher-service-"));
    directories.push(home);
    const calls: string[][] = [];
    const runner: ServiceCommandRunner = {
      run(command, args) {
        calls.push([command, ...args]);
        return { status: 0, stdout: "", stderr: "" };
      },
    };
    const manager = new UserServiceManager({ platform: "linux", homeDirectory: home, environment: { NODE_ENV: "test" }, runner });

    expect(manager.install(installOptions).changed).toBe(true);
    expect(manager.install(installOptions).changed).toBe(false);
    expect(() => manager.install({ ...installOptions, nodePath: "/new/node" })).toThrow("--refresh");
    expect(manager.install({ ...installOptions, nodePath: "/new/node", refresh: true }).changed).toBe(true);
    expect(readFileSync(manager.definitionPath, "utf8")).toContain('ExecStart="/new/node"');
    expect(calls).toContainEqual(["systemctl", "--user", "restart", "worktree-switcher.service"]);
  });

  it("reports manager state plus lightweight process resource use", () => {
    const home = mkdtempSync(join(tmpdir(), "worktree-switcher-service-"));
    directories.push(home);
    const runner: ServiceCommandRunner = {
      run(command) {
        if (command === "systemctl") return { status: 0, stdout: "ActiveState=active\nSubState=running\nMainPID=42\nNRestarts=2\nExecMainStatus=0\nResult=success\n", stderr: "" };
        return { status: 0, stdout: "3601 2048 1.5\n", stderr: "" };
      },
    };
    const manager = new UserServiceManager({ platform: "linux", homeDirectory: home, environment: { NODE_ENV: "test" }, runner });
    mkdirSync(join(home, ".config", "systemd", "user"), { recursive: true });
    writeFileSync(manager.definitionPath, "unit", { flag: "wx" });

    expect(manager.status()).toMatchObject({
      active: true,
      state: "active/running",
      pid: 42,
      restarts: 2,
      uptimeSeconds: 3601,
      residentMemoryBytes: 2 * 1024 * 1024,
      cpuPercent: 1.5,
    });
  });
});
