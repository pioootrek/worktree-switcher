# Initial architecture findings

## Confirmed product requirements

- One local Switch instance manages several projects concurrently.
- Every project can be switched independently between its own Git worktrees.
- A switch must restart only the selected project's server.
- Each project keeps a stable configured port and separate logs.

## Architectural consequences

- The control plane cannot live inside a managed worktree.
- Runtime state is keyed by project ID and has a per-project operation lock.
- Git worktree discovery should consume `git worktree list --porcelain -z`.
- Commands are configured and spawned as executable plus argument arrays, not
  interpolated shell strings.
- Runtime truth must be reconciled after restart instead of trusting stored
  PIDs blindly.
- A reverse proxy is not required for the first version. Reusing each
  project's stable direct port avoids early HMR and WebSocket complexity.

## Persistence direction

Git is authoritative for worktrees. Local persistence stores registered
projects, commands, ports, health checks, and the last selection. A plain
configuration file is sufficient for a narrow MVP; SQLite becomes useful for
larger multi-project configuration, history, and workspace profiles.

## Security boundary

Bind the control surface to loopback, validate browser origin/session state,
resolve selections only from registered repositories and discovered worktrees,
and never accept an arbitrary command or working directory from the browser.
