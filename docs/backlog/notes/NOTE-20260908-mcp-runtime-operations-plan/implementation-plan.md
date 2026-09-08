# MCP runtime operations implementation plan

Date: 2026-09-08. Inspected main:
`6c74cf8a2554c08a2e242b947dcfc6a672749e46` (after PR #13).
Item: `FEAT-20260901-mcp-runtime-operations`.
This document proposes implementation contracts and tests. No runtime feature,
process experiment, production restart or deployment was performed for this plan.

## Outcome and scope

A session holding an active agent claim can explicitly start, restart or stop
that project's managed server. The target is always the worktree pinned by the
claim, on the configured port. Stopping the server keeps its claim; releasing a
claim keeps the server. The existing claim/start/switch workflow remains supported.

Implement three tools over shared application operations, not direct process
calls from MCP. Reuse the existing project lifecycle, owned-process cleanup and
capacity accounting. No arbitrary commands, paths, ports, force actions, new
token system, service installation or host-policy changes belong in this item.
Compact status is still planned at this baseline; reuse its projection if merged,
otherwise add the small runtime-operation response needed here without implementing
its wait coordinator or broader status tools.

## Source findings that shape the design

| Current code | Observation | Consequence |
| --- | --- | --- |
| `mcp-runtime.ts`, `requireClaim` | Checks only the session's private claim map | A cached handle must also be checked against the active persisted claim |
| `ProjectLifecycle.assertReservationAllows` / `StateStore.authorizeReservation` | No reservation returns null and permits generic runtime operations | New tools need a strict active-agent-claim requirement; generic permission alone is insufficient |
| `RuntimeService.operate/operateLocked` | Shared lock, fresh discovery, authorization and capacity already exist | Extend this workflow; never acquire the same non-reentrant project lock twice |
| `ProcessManager.start` | Throws if an owned group or cleanup already exists | Implement healthy same-worktree start as an application no-op, not a second start call |
| `RuntimeService` restart | Holds pending capacity across stop and start | Preserve that reservation across the gap; do not implement restart as two independent public operations |
| `ProcessManager.cleanupRuntime` | Keeps group/PID after unconfirmed cleanup | Failed stop must retain occupied capacity and must not report stopped |
| `ControlService.releaseAgentClaim/renewAgentClaim` | Synchronous, outside project serialization | Release can currently race a long runtime transition; serialize release when adding these tools |
| `mcp-runtime.ts`, auto-renew | Assumes synchronous renewal inside try/catch | Preserve timely renewal; do not casually change it to a queued promise that misses TTL or leaks rejections |
| `RuntimeService` operation logs | Success/failure events lack consistent actor attribution | Add safe operation correlation and agent attribution for the new workflow |

These are source observations, not newly reproduced bugs. Existing runtime and
MCP tests supply the fixture patterns for implementation verification.

## 1. Tool inputs and operation response

Proposed inputs for all three tools:

- `projectId`: UUID;
- `reservationId`: UUID from the session's successful claim;
- `idempotencyKey`: nonempty string, maximum 120 characters, scoped to this
  session and operation request. Require it for all three tools for consistency.

Reject extra worktree/command/port/environment/lease-token/owner inputs through
strict schemas. The MCP adapter obtains owner and token only from private session
state, then passes an internal authenticated context to the application facade.
Validate again at the shared application boundary. Tool annotations declare
mutation behavior; restart is retry-safe only through the specified key contract,
not because arbitrary repeated restarts are harmless.

Return a bounded allowlist, proposed maximum 16 KiB:

- schema version, operation ID, requested action, project/reservation IDs;
- `outcome: completed | noop | failed`, `replayed`, observation timestamp;
- configured port and runtime phase, actual worktree path, start time;
- safe runtime/operation error code with a short fixed message, or null;
- `leaseHeld` determined from current authoritative state at completion;
- whether runtime still occupies capacity and global capacity counts if cheaply
  available. Derive these from the existing authority, not merely phase strings.

Keep the claimed target and actual runtime path distinguishable when reporting
a mismatch. Never truncate an operation ID or worktree path. Omit raw owner/session
IDs, lease/bearer tokens, command arrays, environment values, full snapshots,
technical error details and default logs. Explicit bounded detail reads remain
available for diagnosis. Do not call `projectSnapshot` after a successful mutation
just to build a response: Git failure there must not disguise a completed restart.

Validation/authentication errors are safe tool errors with no mutation. Once an
operation is admitted, return its correlated failed outcome even if startup or
cleanup fails. `failed` never implies the lease was released or the process tree
was stopped. If response projection fails after mutation, preserve the accepted
operation ID and outcome uncertainty; do not cause a blind second restart.

## 2. Strict claim authorization within the shared lifecycle

Add a narrow public application operation, for example
`operateClaimedRuntime(projectId, reservationId, action, actor, requestContext)`.
Keep ControlService as facade and implement runtime behavior in the runtime module.
A shared claim validator must require all of:

1. Existing registered project and active, unexpired agent reservation.
2. Exact reservation ID and project ID match, not merely a matching owner.
3. Actor equals the persisted owner and supplied internal token verifies against
   the existing stored hash. A human reservation or absent reservation fails.
4. The claimed worktree is the only permitted execution target.

Perform validation after acquiring the existing project lifecycle lock. Recheck
following awaited discovery/stop operations and immediately before any new spawn,
so expiry while waiting does not grant authority later. The session map check is
an early rejection, not the authorization decision. Reject stale handles after
human force release, expiry, replacement or another session's claim.

Refactor the locked runtime path minimally so strict validation and the existing
operation run within one lock acquisition. Do not call `operate` from a callback
that already holds the lock; reuse `operateLocked` through its public module API
or a narrow locked helper. Preserve generic HTTP/local-user behavior: those
operations do not suddenly require an MCP claim.

`ProcessManager.start` awaits a port check before spawn. If strict pre-spawn
validation would otherwise occur before that await, add a narrow synchronous
before-spawn guard supplied by the application layer. The process adapter must
not learn claim policy or retrieve session secrets. Test expiry in this gap.
Once a child has been spawned under valid authorization, finish its normal
health/cleanup transition even if the lease subsequently expires; report current
lease state and do not auto-renew or kill it merely because the response is late.

## 3. Action behavior and capacity

| Action and current state | Required behavior |
| --- | --- |
| Start, healthy running on claimed worktree | No-op success; same process/start time, no launch-resolution changes or extra capacity |
| Start, stopped with no owned processes | Fresh discover/validate claimed path, resolve launch, acquire capacity and start |
| Start, failed with no remaining owned group | Retry normal start with fresh validation and capacity |
| Start, cleanup pending/unconfirmed or owned runtime on another path | Reject with explicit state/mismatch code; do not switch or clean up implicitly |
| Restart, owned runtime on claimed path | One serialized controlled stop and start, even when placement is unchanged |
| Restart, stopped/no owned processes | Defined start behavior on the claimed worktree; no fabricated stop of a process that does not exist |
| Stop, owned runtime on claimed path | Stop the complete verified owned process tree; retain claim |
| Stop, already stopped/no owned processes | No-op success; claim still required |
| Stop, failed cleanup on claimed path | Retry verified owned cleanup; report failure and occupied capacity until confirmed |
| Stop/restart, active owned runtime on a different path | Reject mismatch; no implicit move or stop of another placement |

Start/restart use fresh Git discovery and current launch configuration, never
cached dashboard metadata. Missing/prunable worktree prevents a new launch.
Stop must remain possible if that worktree disappeared from Git: authorize the
active claim and match the verified owned runtime's path, then clean up its owned
process tree. An occupied port or a PID supplied by the caller is never ownership.
For a stopped runtime, an old remembered path alone does not count as an active
mismatch; inspect actual process ownership through the existing adapter boundary.

For restart, acquire/retain pending capacity before stopping. Release the pending
reservation in finally, but let actual owned-process state keep capacity occupied
when cleanup cannot be confirmed. Stop failure forbids the subsequent start.
A launch failure releases capacity only when no owned process remains. Never
promise slot release solely because `phase` became failed. Preserve same-project
single-slot accounting and unrelated-project progress at the global limit.

Serialize explicit agent release on the same project lifecycle, with persisted
claim validation when it executes. Update its callers to await completion. Do
not put automatic renewal behind a long start/healthcheck lock: keep its existing
atomic owner/token-checked update, preserving the pinned target and maximum TTL.
Renewal may change expiry, never the reservation identity or worktree. Ensure all
sync/async timer errors remain observed if signatures change. Concurrent manual
release waits for the admitted runtime transition; release still does not stop it.
Human force release and other serialized project operations retain their order.
Natural expiry is handled by the explicit rechecks above, not by extending a lease
without an authorized renewal.

## 4. Retry and disconnect semantics

A restart that completed before an HTTP response was lost must not execute again
when retried with the same key. Add a bounded operation ledger at the application
boundary, shared by these tools and owned by the controller. This is request
deduplication, not another process queue or lifecycle lock.

- Key scope: internal session identity plus idempotency key. Fingerprint includes
  action, project and reservation IDs. Same key/different fingerprint rejects.
- Insert the in-flight promise before queuing asynchronous work. Concurrent retries
  join it. Store the small terminal receipt for subsequent same-key retries,
  including failed attempts. A deliberate retry after a failure uses a new key.
- Proposed bounds: 64 accepted entries per session and 512 globally. Retain them
  for that session's lifetime; reject new keys before mutation when full. Never
  evict an in-flight or completed entry and then silently execute its key again.
  Return a safe capacity error with a recovery hint. Recheck limits against a
  realistic workflow before shipping; do not claim unbounded exactly-once behavior.
- A replay returns the original timestamped operation receipt with `replayed: true`,
  not a claim that its old snapshot is current. The caller reads current status
  when needed. A released/replaced claim cannot turn replay into new authority.
- Controller/session loss ends this deduplication scope. Do not persist tokens or
  introduce a schema migration for it. A new session must reconcile ownership
  and runtime before acting; no exactly-once guarantee spans controller restart.
- Cancellation/disconnect while waiting for the lifecycle lock prevents mutation
  if the operation has not begun. Track the accepted request's state, and recheck
  cancellation/session closure before the first side effect. A cancelled duplicate
  waiter does not cancel the shared admitted operation.
- Once stop/start has begun, transport cancellation detaches the response but
  allows the owned transition to finish or clean up. Do not interrupt halfway
  between stop and start because a client disconnected. Keep its promise observed
  and receipt available while the session remains valid.
- Session close rejects unstarted work and clears completed receipts; in-flight
  operations stay owned until completion and then dispose. Controller shutdown
  closes admission, drains/cleans accepted operations before Git/store/logs close,
  and never permits a queued callback to spawn after shutdown begins. Account for
  these promises in existing lifecycle shutdown; do not create a second drainer
  that waits on itself or closes dependencies before the lifecycle is drained.

## 5. Response safety, audit and integration

Add stable error codes for no/stale/mismatched claim, worktree mismatch,
capacity exhaustion, cleanup unconfirmed, launch failure, cancelled-before-start,
closed controller, deduplication conflict and ledger saturation. Map known runtime
failure codes without exposing arbitrary error text or matching localized strings.
Messages returned through MCP remain English as today; shared UI-facing errors
use the existing typed localization mechanism where applicable.

Emit an audit/controller event for accepted, completed/no-op and failed operations,
with operation ID, safe actor reference, project/reservation IDs, action and result.
Use a consistent opaque actor reference derived internally; raw `agent:mcp:<id>`
contains a session identifier and must not appear in the new audit/log payloads.
Authorization still receives the actual internal actor and token; never replace
it with the display alias. Avoid duplicate execution events for idempotent replay.
Inspect failure paths of reused helpers for raw-owner/error leakage and sanitize
at the new operation boundary. This is not a promise that all historical audit
records are retroactively redacted.

Runtime transitions already notify the dashboard through ProcessManager. Reuse
that path and publish any necessary capacity change once at the application
boundary. No full Git refresh to announce a runtime change. If compact status has
merged, reuse its safe runtime projection, operation-error representation and
current-state cursor. Do not fabricate cursor fields if it has not shipped.

Update `skills/worktree-switcher/SKILL.md` in the repository, plus relevant MCP
and module documentation, only when tools exist. Explain active-claim requirements,
inspect/act/verify behavior, same-key transport retries versus new-key deliberate
retries, failed-start lease retention, and stop-versus-release semantics. Prefer
explicit runtime tools only when the task authorizes that disruption. Preserve
fallback guidance for older controllers; never suggest terminal commands that
bypass a managed server. Do not edit installed service or personal skill copies.

## Implementation order and acceptance

Use one focused PR with separable commits:

1. Add shared input/result contracts and strict claim validation tests. Implement
   the claimed-runtime application port using the existing lifecycle/runtime APIs.
2. Add no-op start/stop, restart capacity guarantees, expiry rechecks and serialized
   release. Keep existing HTTP/profile-restart behavior covered.
3. Add bounded deduplication and cancellation/shutdown ownership, then MCP tool
   registration and safe projection/audit. No half-wired tool is published.
4. Update packaged skill/docs and run the complete verification matrix.

Required deterministic fixtures:

- Two sessions, no claim/human claim/other owner/expired claim/stale private map,
  wrong reservation ID and same-owner replacement: no unauthorized side effect.
- Claim a fixture project, stop it while retaining claim, then start it again.
  Claiming a stopped project already starts it, so do not assume claim produces
  a stopped-but-claimed state for this test. Repeated start has one spawn only.
- Same-path restart: one stop/start, same configured port/path, one occupied slot
  throughout. Repeated stop is a no-op. Release alone leaves the process alive.
- Restart at full global capacity, another project's competing start, failed
  launch and unconfirmed cleanup: correct count and no stolen/free phantom slot.
- Deferred Git/stop/port-check steps: expire/release/replace claim before lock
  entry and before spawn. Expiry during health wait must not abandon cleanup or
  falsely report that the lease is still held.
- Same-key concurrent/delayed retries, different-key restarts and key conflicts:
  exactly one execution per accepted key in the defined session scope, with
  timestamped replay. Cover session/global ledger bounds without eviction/replay.
- Disconnect/cancel before mutation, during stop/start and after completion;
  session close and controller shutdown: no late spawn, unobserved rejection,
  leaked ledger entry or premature dependency close. Timer renewal remains alive
  during a slow operation and is removed on session closure.
- Concurrent HTTP runtime/profile changes, claim release, cache maintenance and
  test admission preserve shared serialization and independent-project progress.
- Removed/prunable worktree blocks launch, but owned cleanup remains possible.
  An unrelated port listener remains untouched; no command/path override accepted.
- Responses and new audit/error logs exclude sentinel tokens, raw session IDs,
  env values and command arguments. Operation failures retain useful safe codes,
  actual runtime state and truthful leaseHeld/capacity information.

Use module tests and the existing MCP loopback harness first, then an isolated
real process-tree fixture for claim -> stop -> start -> restart -> stop -> release.
Use temporary state/repositories and dynamically assigned fixture ports, not a
managed project or installed controller. A fixture process/descendant left alive
fails the test. No real server experiment was run while preparing this plan.

Run relevant runtime/lifecycle/MCP/process/store regressions, `pnpm check` and
`pnpm build` for module/bundle changes. Verify affected dashboard flows if shared
runtime changes alter UI behavior. Use registered-project queue presets when
available; otherwise supported finite commands under the host's serial heavy-job
policy. A live managed-server check needs its own Worktree Switcher claim.
Append actual evidence and final contract decisions to this note, then close
this item with its done entry. Plan-only verification is Hub fmt/validate and
`git diff --check`; it does not claim implementation tests passed.

Rollback removes the additive tools/claimed-operation entrypoint and restores
compatible skill guidance. Keep existing read/claim/renew/release behavior and
all running processes/leases unchanged. Do not run stop/release or down-migrate
history as a side effect of rollback.

## Implementation evidence

Implemented on 2026-09-08 from `3c0588a`. The shipped contract uses the proposed
three strict MCP inputs and bounded receipt, 64 accepted keys per session and 512
globally, no-op start/stop behavior, capacity-preserving restart, serialized
release, pre-spawn persisted-claim revalidation, and pseudonymous operation audit
attribution. Session closure prevents queued operations from beginning while an
already-started owned transition is allowed to finish.

`pnpm check` passed ESLint, TypeScript, and all 234 Vitest tests. `pnpm build`
completed the static Next.js dashboard and controller CLI bundle, and
`git diff --check` passed. The repository was not registered with the active
Worktree Switcher controller, so finite project commands ran directly; no managed
development server was started or moved.
