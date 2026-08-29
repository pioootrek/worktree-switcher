# Prototype readiness and positioning assessment

Review date: 2026-08-29. Reviewer: agent:claude. Method: read
`docs/project-brief.md`, `docs/reservations-and-mcp.md`, `README.md`, and the
`src/` tree; ran `pnpm test` and `pnpm typecheck`; inspected the working tree
against Git history.

## Verified state

- About 6100 lines of TypeScript and TSX across `src/`.
- 46 tests in 16 files pass in roughly one second. `tsc --noEmit` is clean.
- The implemented architecture matches the brief: static Next.js export, one
  Node controller, SQLite behind `StateStore`, Git porcelain discovery,
  per-project process lifecycle, loopback MCP listener.
- The MCP layer (`mcp-runtime.ts`, `mcp-http-server.ts`, `secret-file.ts`),
  the agent skill, and the Next.js development HTTPS work existed only as
  uncommitted working-tree changes at review time. They are committed together
  with this note.

## Positioning

The dashboard's headline capability, moving a development server between
worktrees on a fixed port, has cheap substitutes: one terminal per worktree,
`PORT=<n> pnpm dev`, tmux, `pm2`, `overmind`. Its value grows with the product
of projects and worktrees, so a single repository with two branches does not
justify the control plane.

The reservation and MCP layer has no obvious substitute. Exclusive claims over
the pair (worktree, port), expiring leases, ownership checks, and audit records
solve contention between a human and several concurrent agents. That is the
capability worth leading with in the README and in any public description.
The current README opens with server switching and reaches agent coordination
late.

## Gaps that block real use

- Project registration and removal exist only in the dashboard. An agent, a
  provisioning script, or a headless host cannot register a project. The brief
  already promises `project add` and `project list`; the CLI does not have
  them. Tracked as `FEAT-20260829-cli-project-management`.
- The repository has no license file and the package is unpublished and marked
  `private`. Until a license exists, the open-source description in the README
  and the brief is a statement of intent, not a fact. Tracked as
  `FEAT-20260829-license-and-package-release`.
- Only Node.js projects exposing a `dev` script are detected. Custom command
  presets remain unimplemented and are the main reason a non-Node service
  cannot join a workspace.
- Background service installation is absent, so the controller stops every
  managed process when its foreground session ends. This is a deliberate MVP
  decision, but it caps daily usefulness on a workstation that reboots or logs
  out.

## Acceptance criteria that need revision

The item's release validation requires at most 50 MiB idle RSS. Measurements
recorded in the item report roughly 67 to 68 MiB for the controller while a
bare Node HTTP process on the same host measures about 60 MiB. The target is
therefore below the floor of the chosen runtime and cannot pass as written.
The metric should measure controller overhead above a baseline Node process,
or the budget should be raised to a value the runtime can meet. Tracked as
`RWK-20260829-idle-memory-budget`.

## Not a finding

Security decisions reviewed and considered sound for the stated threat model:
shell-free spawning from an executable and argument array, per-start pairing
token, same-origin requirement for browser mutations, loopback-only MCP with a
separate bearer token, and the rule that the controller never terminates a
process it did not start.
