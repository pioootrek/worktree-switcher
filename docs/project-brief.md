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

The control plane lives outside the repositories it manages. The dashboard is
built with Next.js and communicates with a local process manager. Git remains
the source of truth for worktree discovery. The manager starts commands with
the selected worktree as their working directory, observes readiness, streams
logs, and terminates the complete previous process tree before reuse of a port.

Each project has its own serialized state machine: `stopped`, `starting`,
`running`, `stopping`, or `failed`. Operations for different projects may run
concurrently; switch operations for one project are serialized.

The first version uses a stable direct port for each managed application. A
reverse proxy and coordinated multi-project workspace profiles are deferred
until the independent-project flow is reliable.

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

## Open decisions

- Whether the runtime manager should share the built Next.js process or run as
  a dedicated daemon with a static/web client.
- Whether persistence begins with a small configuration file or SQLite.
- The repository-level configuration contract for commands, arguments,
  environment variables, ports, and health checks.
- Packaging and command name for the eventual one-command CLI distribution.
