---
name: worktree-switcher
description: Use when a repository's development server is managed by Worktree Switcher, or when the user asks to inspect, claim, start, or switch a registered project through its MCP tools. Do not use for creating, deleting, or pruning Git worktrees.
---

# Worktree Switcher

Coordinate with the Worktree Switcher controller before touching a registered
project's development server. Keep the server on the intended worktree without
disrupting another human or agent.

## Connect outside the repository

This skill does not configure MCP. The user must add the URL and authorization
header from `worktree-switcher config mcp` to the client's private MCP
configuration.

Never ask the user to put that output in `AGENTS.md`, `CLAUDE.md`, source files,
logs, issues, or chat. If the Worktree Switcher tools are unavailable, say so
and follow the repository's normal development instructions. Do not invent an
endpoint or token.

## Check the controller without exposing credentials

When the user asks why MCP is unavailable and the local CLI exists, you may run
`worktree-switcher service status`. This is read-only and does not print the
browser pairing token or MCP bearer token.

Do not install, uninstall, stop, or restart the user service unless the user
explicitly asks for that lifecycle change. Do not run `service url` as a
diagnostic command. It prints the private browser URL.

If the service is stopped, report that state. Do not bypass it by starting the
managed project with `pnpm`, `npm`, `yarn`, `bun`, or a framework CLI.

## Inspect before acting

Use `list_projects` to find the registered project. Use `list_worktrees` to
match the current checkout to an exact controller-discovered path, then read
`get_project_status`.

Read-only status requests do not need a claim.

If the server is already running on another worktree, do not move it unless the
user asked to switch it or the current task clearly authorizes using the server
from this checkout. A claim may stop the existing managed process before it
starts the selected worktree.

## Claim the server when needed

For work that needs exclusive use of the development server, call
`claim_project` with:

- the registered project ID;
- an exact path returned by `list_worktrees`;
- a short reason tied to the current task;
- an idempotency key that is reused when retrying the same claim;
- an optional TTL between 30 and 1800 seconds.

A successful claim moves or starts the managed server when necessary. Do not
start another copy with `pnpm`, `npm`, `yarn`, `bun`, or a framework CLI.

After claiming, call `get_project_status` and verify the worktree, runtime
phase, and port. If `claim_project` returns an operation error, the claim is
still held. Inspect the returned failure and logs before deciding whether to
retry or release it.

If another owner holds the project, do not stop its process, take its port, or
try to bypass the reservation. Report the owner and conflict. Force release is
intentionally unavailable through MCP.

## Renew and release

The MCP session renews its claims automatically. Use `renew_project_claim` only
when the workflow needs an explicit extension.

Call `release_project_claim` when the task no longer needs exclusive control.
Release does not stop the development server.

Claims belong to the MCP session that created them. If that session is lost, a
new session cannot renew or release the old claim. Report the stale claim and
let it expire, or ask the user to review it in the dashboard.

## Report the result

When a server operation matters to the task, report the project name, selected
worktree, port, runtime phase, and whether the claim remains held. Never include
MCP tokens, lease secrets, or session identifiers.
