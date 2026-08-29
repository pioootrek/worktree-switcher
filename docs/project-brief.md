---
audience: "contributors and coding agents"
last_reviewed: "2026-08-29"
source_of_truth: "product intent and initial architecture of Worktree Switcher"
status: "active"
---

# Worktree Switcher: product brief

## Problem

Developers using Git worktrees often run the same application from several
branches. Moving a development server between those worktrees is manual: stop
the process, find the correct directory, start the correct command, verify the
port, and recover when an old child process remains alive. The effort grows
when a workspace contains several related projects such as a frontend, API,
and documentation site.

## Product direction

Worktree Switcher is a local-first, open-source web application that discovers
the worktrees belonging to registered Git repositories and manages their
development servers. One persistent control plane serves the dashboard. Every
registered project has an independent runtime slot, stable port, process state,
logs, and selected worktree.

For example, one Switch instance may run all of the following concurrently:

- frontend from `feature/checkout` on port 3000;
- backend from `feature/payments-api` on port 4000;
- documentation from `main` on port 5000.

Switching the frontend worktree must not interrupt the backend or documentation
servers.

## Initial architecture

The control plane lives outside the repositories it manages. Next.js builds the
dashboard as a static export; it is not a persistent application server. One
lightweight Node.js process serves the exported files, exposes the loopback API,
and manages child processes. Git remains the source of truth for worktree
discovery. The manager starts commands with the selected worktree as their
working directory, observes readiness, streams logs, and terminates the
complete previous process tree before reuse of a port.

Each project has its own serialized state machine: `stopped`, `starting`,
`running`, `stopping`, or `failed`. Operations for different projects may run
concurrently; switch operations for one project are serialized.

The first version uses a stable direct port for each managed application. A
reverse proxy and coordinated multi-project workspace profiles are deferred
until the independent-project flow is reliable.

The controller is event-driven: it does not continuously scan repositories or
watch complete worktree trees. Expensive Git status checks are lazy and
refreshes are bounded. Release verification measures controller overhead
separately from the projects it manages, with initial targets of at most 50 MiB
idle RSS, negligible idle CPU, and a bounded log buffer.

## Persistence and service boundary

The MVP stores projects, settings, runtime recovery hints, reservations, and
audit events in a local SQLite database. Logs use the platform state directory
and remain outside the database. Only one controller instance owns the database
and managed processes at a time.

HTTP handlers and UI code do not access files directly. Application services
depend on interfaces such as `StateStore`, `GitWorktreeReader`, and
`ProcessRunner`; the first `StateStore` implementation is SQLite-backed. A
future remote implementation can replace that adapter without changing use
cases or API contracts.

User accounts are not part of the local MVP. Adding them later requires an
authentication and authorization boundary plus ownership and concurrency
rules; changing the persistence adapter alone would not be sufficient.

## Configuration contract

The database has explicit schema migrations and versioned project records.
Commands are stored as an executable plus an argument array and always spawned
without a shell. Each project declares its repository path, stable port,
optional environment overrides, health check, startup timeout, and whether it
should start automatically. The selected worktree is runtime state and is
never accepted as an arbitrary browser-provided working directory.

## Distribution and operation

The npm package and executable are both named `worktree-switcher`. A global
user-level installation is the recommended daily-use path; `npx` remains the
zero-install evaluation path. Running `worktree-switcher` or
`worktree-switcher start` starts one foreground controller, opens the browser,
and owns its managed child processes. `--no-open` supports headless use.

Initial supporting commands are `project add <path>`, `project list`,
`config path`, and `doctor`. Background service installation and standalone
platform binaries are deferred until real usage justifies their maintenance.

## MVP

- Register multiple local Git repositories.
- Discover worktrees using Git's stable porcelain output.
- Show branch, commit, path, dirty state, and worktree health.
- Start, stop, restart, and switch each project independently.
- Preserve a stable configured port per project.
- Show readiness, failure details, and recent logs.
- Bind the control API to loopback and reject arbitrary commands or paths.
- Persist project configuration and the last selection; reconcile live process
  state after a control-plane restart.

## Deferred ideas

- Workspace profiles that activate a coordinated set of worktrees across
  several projects.
- Creation, locking, pruning, or deletion of worktrees.
- A browser terminal.
- Reverse proxying with transparent HMR WebSocket support.
- Windows process-tree support; the initial target is Linux and macOS.

## Topics under discussion

- A visible project reservation model: humans may pin a server slot to a
  worktree until explicit release, while agents use expiring renewable leases.
- A local MCP integration that exposes project/runtime status as resources and
  lets an agent atomically reserve, switch, renew, and release its own lease.
- Forced release of somebody else's reservation remains a human UI/CLI action.

These are proposals, not yet committed MVP scope. Their working design is in
`docs/reservations-and-mcp.md`.

## Current decisions

- Use one lightweight Node.js controller and a statically exported Next.js UI;
  do not run a persistent Next.js server.
- Use a local SQLite adapter behind application-service interfaces; keep all
  database access inside the single controller process.
- Use explicit, shell-free executable and argument arrays with per-project
  ports, environment overrides, health checks, and timeouts.
- Publish the npm package and executable as `worktree-switcher`; default to a
  foreground process and make background operation opt-in later.
