---
audience: "product owner and contributors discussing agent coordination"
last_reviewed: "2026-08-29"
source_of_truth: "approved reservation model and proposed MCP integration design"
status: "active"
---

# Reservations and proposed MCP integration

Decision state: the reservation model is approved for MVP. The MCP adapter is a
follow-up proposal and is not required to complete the first usable release.

## Use an exclusive reservation, not a semaphore

Each project has one managed server slot, so the user-facing primitive is a
binary exclusive reservation. A counting semaphore would suggest several
simultaneous holders, which is not the intended behavior.

Three mechanisms remain separate:

1. An internal operation mutex serializes short start, stop, and switch state
   transitions.
2. A human hard lock pins the project to a worktree until explicit release.
3. An agent lease reserves the project temporarily and must be renewed.

The reservation overlays runtime state. A project may therefore be
`running + reserved`, `stopped + reserved`, or `failed + reserved`; reservation
does not falsely claim that the process is healthy.

## Reservation record

```ts
type Reservation = {
  id: string
  projectId: string
  worktreeId: string
  kind: "human-lock" | "agent-lease"
  owner: {
    kind: "human" | "agent"
    id: string
    displayName: string
  }
  reason: string
  createdAt: string
  expiresAt: string | null
  tokenHash: string | null
}
```

The service returns the raw lease token once and stores only its hash. The token
is required to renew or release an agent lease. Repeating an acquire request
with the same idempotency key returns the existing lease instead of creating a
second one.

Human locks may be indefinite. Agent leases default to 30 minutes, renew every
10 minutes while their bridge remains alive, have an 8-hour maximum lifetime,
and expire automatically if the client disappears. Agents can renew or release
only leases for which they hold the token. A human can force-release any
reservation through an explicit UI or CLI action; that action is audited and
is not exposed as a normal LLM tool.

A reservation is pinned to one worktree. Its owner may restart that worktree;
other actors cannot switch, stop, or restart the reserved project. Stopping the
server does not release the reservation. An owner that needs another worktree
uses one atomic move operation so ownership is never briefly dropped.

## Conflict behavior

Acquisition is an atomic compare-and-set operation. A conflict returns the
current owner, reason, pinned worktree, and expiry without switching anything.
The existing holder is never silently displaced.

The controller implements acquisition as one SQLite write transaction that
expires stale leases, checks the current claim, records the new claim, and
appends its audit event. UI, CLI, and MCP never open the database directly.

The preferred agent operation atomically reserves and switches the server. A
separate `acquire` followed by `switch` would leave a race between the calls.
If switching fails, the result reports both the failed runtime transition and
whether the lease remains held so recovery is unambiguous.

Reservation guarantees apply only to Worktree Switcher operations. They cannot
prevent a human from killing a process or changing files outside the tool, so
status reconciliation must continue to report external changes.

## MCP shape

MCP is an adapter over the same application services used by UI and CLI. It
does not receive direct filesystem, Git, process, or persistence access.

For local clients, the proposed entry point is:

```text
worktree-switcher mcp
```

This command runs a small stdio MCP bridge only while the client needs it. The
bridge connects to the existing controller through its authenticated local
endpoint, so there is still one owner of runtime state and process operations.
It writes protocol messages only to stdout and diagnostics only to stderr.

Read-only MCP resources:

```text
worktree-switcher://projects
worktree-switcher://projects/{projectId}/status
worktree-switcher://projects/{projectId}/worktrees
```

Initial MCP tools:

```text
get_project_status
claim_project
renew_project_claim
release_project_claim
```

`claim_project` accepts a project, discovered worktree identifier, reason,
requested TTL, and idempotency key. It atomically acquires an agent lease and,
when needed, switches the server. Its result contains an explicit lease handle
that subsequent renew/release calls must present.

Listing and status remain available without acquiring a lease. Mutations that
would violate an existing reservation return a typed conflict. Arbitrary shell
commands, arbitrary paths, force release, and indefinite agent locks are never
exposed as MCP tools.

## Security and audit

- The stdio bridge obtains controller credentials from a protected local file
  or environment, never from command-line arguments.
- Every mutation records actor, MCP client identity, project, worktree, reason,
  timestamp, outcome, and lease ID without recording the raw token.
- SQLite persists reservations and append-only audit events; the controller is
  the only database owner and all adapters use the same transactional service.
- Tool inputs use strict schemas and project/worktree identifiers are resolved
  against controller-owned discovery results.
- UI and CLI clearly show owner, reason, age, expiry, and whether the process
  still matches the reserved worktree.
- A future Streamable HTTP MCP transport must remain loopback-only by default,
  validate `Origin`, and require authentication. Remote and multi-user access
  is a separate security design.

## Remaining MCP decisions

The MCP adapter can be specified after the reservation service is working. The
remaining questions are client discovery/configuration, whether its first
release is bundled or optional, and which clients receive installation guides.
