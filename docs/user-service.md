---
audience: "people running Worktree Switcher on a development machine"
last_reviewed: "2026-08-29"
source_of_truth: "user-service installation, operation, logs, and removal"
status: "active"
---

# Run Worktree Switcher as a user service

A terminal is useful while you evaluate Worktree Switcher. A user service is
better once the controller becomes part of your daily setup. It survives a
closed terminal, restarts after a crash, and keeps the dashboard and MCP
listener available for the length of your login session.

The installer supports:

- systemd user services on Linux
- LaunchAgents on macOS

It does not use `sudo`, install a system-wide daemon, change firewall rules, or
add CPU and memory limits.

## Before you install

Build the project and stop any foreground Worktree Switcher process. The
singleton lock does not let a service and a foreground controller share the
same state directory.

```bash
pnpm build
```

The examples below use the unpublished source checkout. Once an npm package is
available, replace `node dist/cli/index.js` with `worktree-switcher`.

## Install the service

```bash
node dist/cli/index.js service install
```

Installation writes one user-owned definition and starts it immediately:

| Platform | Definition |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/systemd/user/worktree-switcher.service`, or `~/.config/systemd/user/worktree-switcher.service` |
| macOS | `~/Library/LaunchAgents/dev.worktree-switcher.controller.plist` |

The definition stores absolute paths to Node.js, the built CLI, dashboard
assets, data, and runtime state. It also stores the chosen host and ports. Its
controlled `PATH` includes standard system directories and the directories of
any supported package managers (`pnpm`, `npm`, `yarn`, or `bun`) found during
installation. It does not contain the browser pairing token or MCP bearer
token.

Installation is idempotent. Running the same command again keeps the existing
process. If the generated definition would change, the command stops and asks
for an explicit refresh.

## Choose the network and directories

`service install` accepts the same host, port, MCP, directory, and browser
options as `start`:

```bash
node dist/cli/index.js service install \
  --host 127.0.0.1 \
  --port 47831 \
  --mcp-port 47832 \
  --browse-root /home/me/development \
  --data-dir /home/me/.local/share/worktree-switcher \
  --state-dir /home/me/.local/state/worktree-switcher
```

Use `--no-mcp` if you do not want the MCP listener.

The values become part of the service definition. Repeat them when you later
run `service install --refresh`, otherwise the omitted values return to their
defaults.

Commands that read the access record or MCP token do not parse the installed
service definition. If you choose custom directories, pass the matching path:

```bash
node dist/cli/index.js service status --state-dir /home/me/.local/state/worktree-switcher
node dist/cli/index.js service open --state-dir /home/me/.local/state/worktree-switcher
node dist/cli/index.js config mcp --data-dir /home/me/.local/share/worktree-switcher
```

## Open the dashboard

Check the service first:

```bash
node dist/cli/index.js service status
```

Status reports the service state, definition path, controller PID, uptime,
restart count when available, version, endpoints, log directory, CPU use, and
resident memory for the controller process.

Open the dashboard:

```bash
node dist/cli/index.js service open
```

On a headless machine, print the private URL and open it on an allowed device:

```bash
node dist/cli/index.js service url
```

`service url` prints a credential. Do not paste it into logs, issues, source
files, or a shared shell transcript. The underlying access record is stored
with owner-only permissions and is removed during a clean stop.

## Start, stop, and restart

```bash
node dist/cli/index.js service start
node dist/cli/index.js service stop
node dist/cli/index.js service restart
```

A clean stop sends the controller `SIGTERM`. The controller closes MCP and the
dashboard, then stops every development-server process tree it owns. It never
kills an unrelated process just because that process uses a configured port.

On Linux, systemd keeps the controller and its children in the same service
cgroup. On macOS, the LaunchAgent keeps the process group attached to the job.
Both definitions retry after failure with a five-second throttle. systemd also
caps the restart burst.

## Read the logs

Application logs use the user state directory on both platforms:

```text
~/.local/state/worktree-switcher/logs/controller.log
~/.local/state/worktree-switcher/logs/projects/<project-id>.log
```

Linux also records service-manager output in the user journal:

```bash
journalctl --user -u worktree-switcher.service
journalctl --user -u worktree-switcher.service --since today
```

On macOS, LaunchAgent output uses:

```text
~/.local/state/worktree-switcher/logs/service.stdout.log
~/.local/state/worktree-switcher/logs/service.stderr.log
```

Custom `--state-dir` values move these files. Worktree Switcher does not write
to `/var/log`.

The browser URL and bearer tokens should never appear in these logs. If you
find one, treat it as a security bug.

## Update the installed service

Rebuild or update Worktree Switcher first. Then refresh the definition:

```bash
pnpm build
node dist/cli/index.js service install --refresh
```

Refresh is required when the Node.js path, CLI path, dashboard path, network
settings, or data directories change. The explicit flag prevents an upgrade
from silently pointing the service at a different executable.

After refresh:

```bash
node dist/cli/index.js service status
```

Confirm the version, PID, endpoints, and log path.

## Linux login sessions and linger

A systemd user service normally starts with your user session and stops when
that user manager exits. If the controller must run before login, an
administrator can enable lingering for the account:

```bash
sudo loginctl enable-linger <user>
```

This changes host behavior. Worktree Switcher never runs that command for you.
Most development machines do not need it.

## Remove the service

```bash
node dist/cli/index.js service uninstall
```

Uninstall stops the controller, disables and removes its user-service
definition, and reloads the service manager where needed. It preserves:

- the SQLite database
- the MCP token
- project and controller logs
- project configuration and claims

Running uninstall again is safe. It reports that the service is not installed.

## Troubleshooting

### Another controller is already running

```text
Worktree Switcher is already running (PID ...)
```

Stop the foreground controller before starting the service, or stop the service
before using foreground mode. Do not delete the lock while the reported PID is
alive.

### The service is installed but does not start

On Linux:

```bash
systemctl --user status worktree-switcher.service --no-pager
journalctl --user -u worktree-switcher.service -n 100 --no-pager
systemd-analyze --user verify ~/.config/systemd/user/worktree-switcher.service
```

On macOS:

```bash
launchctl print gui/$(id -u)/dev.worktree-switcher.controller
```

Check whether Node.js and the built CLI still exist at the paths stored in the
definition. If they moved, run `service install --refresh` from the new build.

### The dashboard URL is unavailable

Run `service status`. If the service is active but `service url` reports a stale
record, inspect the controller log. The controller writes a fresh access record
only after the dashboard and MCP listeners start successfully.

### A configured port is already used

Worktree Switcher will report the conflict and leave the unknown process alone.
Stop that process yourself or assign a different project port in the dashboard.

### A package manager is missing in service mode

The installer records the directories containing supported package managers
that are available in your current terminal. If you install or move `pnpm`,
`npm`, `yarn`, or `bun` later, rebuild Worktree Switcher and refresh the service
definition from a terminal where the command is available:

```bash
command -v pnpm
pnpm build
node dist/cli/index.js service install --refresh
```
