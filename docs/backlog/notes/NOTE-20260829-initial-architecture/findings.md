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
- Next.js produces a static export only. One Node controller serves those
  assets, the loopback API, and SSE while managing child processes.
- The controller is event-driven, performs Git status checks lazily, and keeps
  bounded log buffers. The initial verified idle-memory budget is 50 MiB.

## Persistence direction

Git is authoritative for worktrees. SQLite stores registered projects,
commands, ports, health checks, last selections, reservations, and audit events
from the MVP. The requirement changed after introducing atomic leases and MCP
coordination; the earlier JSON-adapter direction is superseded.

Persistence is accessed through a transactional `StateStore` application
boundary. The controller is the only database owner; UI, CLI, and MCP call its
services. The first adapter uses `better-sqlite3`, migrations, foreign keys,
prepared statements, and WAL. Accounts later still require authentication,
authorization, ownership, and audit semantics beyond the storage choice.

## Distribution

Publish one npm package and executable named `worktree-switcher`. Foreground
operation is the default; global user-level installation is the daily-use path
and `npx worktree-switcher@1` is the evaluation path. Background service
installation remains opt-in and deferred.

## GUI foundation

Use shadcn/ui source components with the `new-york` style, Radix base, Tailwind
CSS, and token-based theming. The developer dashboard is dark-first with a
system/light option. Add only components required by implemented flows; keep
application compositions outside `src/components/ui`.

Runtime and reservation indicators always combine color with labels and icons.
Use `AlertDialog` for destructive actions such as force release, and include
keyboard, focus, reduced-motion, and screen-reader behavior in verification.

## Security boundary

Bind the control surface to loopback, validate browser origin/session state,
resolve selections only from registered repositories and discovered worktrees,
and never accept an arbitrary command or working directory from the browser.

## Proposed reservation and MCP extension

Decision state: proposed. Treat a visible project claim as an exclusive
reservation rather than a counting semaphore. Human hard locks may remain until
explicit release; agent claims should be expiring renewable leases so an
interrupted agent cannot deadlock a project indefinitely.

MCP should be an adapter over the same application services as UI and CLI. A
local `worktree-switcher mcp` stdio bridge can expose read-only project status
and narrowly scoped claim, renew, and release tools while the main controller
remains the sole process/state owner. Force release and indefinite agent locks
should not be available to LLM tools.
