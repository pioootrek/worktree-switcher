---
audience: "contributors implementing the controller and user interface"
last_reviewed: "2026-08-29"
source_of_truth: "runtime, persistence, configuration, and distribution decisions"
status: "active"
---

# Architecture decisions

## Runtime shape

Worktree Switcher ships as one long-lived Node.js process. Next.js is a build
tool for the App Router UI, configured with `output: "export"`; its generated
HTML, CSS, and JavaScript are package assets served by the controller. There is
no `next start` process and no server rendering at runtime.

The process contains four replaceable layers:

1. A thin loopback HTTP layer serving static assets, JSON endpoints, and an
   SSE event stream.
2. Application services coordinating projects, switching, readiness, and
   configuration.
3. Domain interfaces for persistence, Git inspection, process execution,
   clocks, and event publication.
4. Local adapters backed by JSON, the Git CLI, Node child processes, and the
   filesystem.

The layers are module boundaries inside one process, not separate services.
This keeps idle memory and startup overhead low while preserving extraction
points if a future multi-user edition needs a remote control plane.

## Resource policy

Managed development applications have priority over Worktree Switcher. The
controller must be event-driven and have bounded memory use:

- no recursive filesystem watcher over managed repositories;
- no continuous Git polling while the dashboard is closed;
- lazy dirty-state calculation with debounced refresh;
- bounded per-project and global log buffers;
- one controller process and no resident Next.js runtime;
- release benchmarks report idle RSS, idle CPU, startup time, and growth while
  managing several fixture projects.

Initial acceptance targets are at most 50 MiB idle RSS and negligible idle CPU
on the supported Linux reference environment. These are budgets to verify, not
assumptions about Node.js behavior.

## Persistence

Application code depends on a `ProjectStore` contract rather than JSON APIs:

```ts
interface ProjectStore {
  list(): Promise<ProjectConfig[]>
  get(id: ProjectId): Promise<ProjectConfig | null>
  save(project: ProjectConfig): Promise<void>
  remove(id: ProjectId): Promise<void>
}
```

The MVP adapter uses `config.json` with a required `schemaVersion`. On Linux it
lives below `$XDG_CONFIG_HOME/worktree-switcher/`, falling back to
`~/.config/worktree-switcher/`. Logs and recoverable runtime state live below
`$XDG_STATE_HOME/worktree-switcher/`, falling back to
`~/.local/state/worktree-switcher/`. Other platforms use their native user
config and state locations.

Writes use a temporary sibling file followed by an atomic rename. A process
lock prevents two controller instances from mutating the same state. Stored
PIDs are hints only; restart reconciliation verifies process identity before
acting on it.

SQLite is not used in the MVP. It becomes appropriate when transactional
history, coordinated workspace profiles, concurrent writers, or indexed
queries appear. The service and adapter boundary makes that migration local.
Accounts would additionally require authentication, authorization, ownership,
and audit semantics; they are not treated as a database-only change.

## Configuration version 1

```json
{
  "schemaVersion": 1,
  "server": {
    "host": "127.0.0.1",
    "port": 3410,
    "openBrowser": true
  },
  "projects": [
    {
      "id": "frontend",
      "name": "Web App",
      "repositoryPath": "/projects/web-app",
      "port": 3000,
      "command": {
        "executable": "pnpm",
        "args": ["dev", "--", "--port", "{port}"]
      },
      "environment": {
        "NODE_ENV": "development"
      },
      "healthcheck": {
        "path": "/",
        "timeoutMs": 30000
      },
      "autoStart": false
    }
  ]
}
```

Unknown schema versions fail with an actionable error. Project IDs are stable,
URL-safe keys. Ports must be unique among simultaneously running projects.
Repository paths are canonicalized during registration. The browser sends a
discovered worktree identifier, not a command or arbitrary filesystem path.

Environment values are explicit overrides merged onto a deliberately filtered
controller environment. Secrets should remain in the managed project's normal
environment mechanism and must not be copied into this configuration by
default.

## CLI and package

The public npm package is `worktree-switcher` with one `bin` entry of the same
name. The executable supports:

```text
worktree-switcher                 # alias of start
worktree-switcher start [--no-open]
worktree-switcher project add <path>
worktree-switcher project list
worktree-switcher config path
worktree-switcher doctor
```

Recommended daily installation:

```bash
npm install --global worktree-switcher
worktree-switcher
```

Evaluation without installation:

```bash
npx worktree-switcher@1
```

Foreground operation is the default because ownership, logs, shutdown, and
resource use remain visible. Installation as a login/system service is a
separate future feature and must be opt-in.
