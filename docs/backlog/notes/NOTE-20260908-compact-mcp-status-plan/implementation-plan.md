# Compact MCP status implementation plan

Date: 2026-09-08. Inspected baseline:
`1d533f7c3f6c44993044bb498067d609f7ea2545` (main).
Item: `FEAT-20260905-compact-mcp-status`.
This is a proposed contract and implementation plan, with a baseline serialization
probe. No production feature, managed-server change or deployment was performed.

## Outcome

Routine agent inspection should return placement, ownership, runtime/test phase,
capacity and enough source evidence to interpret a result. Logs, discovery,
profiles and histories remain explicit detail reads. Waiting for a relevant
state change should not make the agent repeatedly ingest unchanged snapshots.
Preserve existing tool/resource names, defaults and mutation authorization.

The dashboard fix is already merged. Do not implement its metadata cache again.
The source-attribution fix is planned but not implemented at this baseline.
Coordinate its actual result schema when merging; never claim planned fields
already exist or invent execution evidence for legacy runs.

## Current behavior and measured baseline

- `mcp-runtime.ts`, `jsonContent`, pretty-prints tool results with two-space JSON.
  `get_project_status` and the project-status resource serialize `agentSnapshot`.
  They include runtime logs/resources, worktrees, storage, presets and test history.
- `DashboardQueryService.projectSnapshot` explicitly refreshes metadata, even
  though dashboard bootstrap now has a cache. Repeated detailed MCP status calls
  still run fresh discovery/preset work. Storage/worktree/preset MCP reads also
  enter `projectSnapshot` before selecting a section.
- `list_projects`/project resources now use `projectSummaries`, so they no longer
  discover Git. They still construct runtime snapshots that copy log/resource
  history arrays before the MCP projection drops logs. Reservation output contains
  the raw `owner`; MCP owners are `agent:mcp:<sessionId>`. Do not reuse that object
  by spreading it into the new public compact response.
- `get_test_run` returns a full TestRun with retained logs. SQLite reads use
  `SELECT *` and parse `logs_json`. Dropping logs after reading does not remove
  the database/parsing cost of a hot status path.
- `claim_project` returns reservation, full runtime, operation error and lease-held
  state. A claim can remain held after startup failure. Renewals and release are
  session-bound; wait/read operations must not change those semantics.
- `EventStream` increments its revision when a 250 ms batch is emitted. Runtime
  and test output use the same kinds as phase changes. Some changes are published
  in HTTP handlers, while MCP claim renewal/release do not use those handlers.
  It is a dashboard invalidation signal, not a complete application change log.
- `getActiveReservation` expires stale leases as a side effect. A high-frequency
  compact wait should use a read projection filtering expiry, not repeatedly
  invoke a write-capable getter merely to inspect ownership.

The attached probe called eight existing tools through the actual MCP transport
and serializer with stubbed application data. It did not run Git, claim a real
project, execute tests, or benchmark controller CPU/RSS.

| Tool text payload, UTF-8 bytes | Small fixture | Populated fixture |
| --- | ---: | ---: |
| `list_projects` | 489 | 489 |
| `get_project_status` | 2,519 | 70,681 |
| `get_test_run` | 760 | 4,282 |
| `list_worktrees` | 187 | 1,124 |
| `list_test_presets` | 235 | 1,412 |
| `get_project_storage` | 390 | 2,342 |

Small: one worktree, no runtime logs or project test history. Populated: six
worktrees, 200 runtime lines of 80 bytes, ten test runs with 40 lines of 80 bytes
each. The standalone test read returns one run in both fixtures. Raw results
also include capacity/queue and parsed tool-result JSON sizes, excluding HTTP
and JSON-RPC envelopes. This is a baseline payload measurement, not a before/after
comparison, token count, production load estimate or proof of complete workflow
savings. No compact implementation was measured.

## Proposed compatible API

Keep existing defaults. Add three read-only tools and one bounded runtime-log
read. Use explicit schemas and a single allowlist projection, with no generic
object spread from Project, Reservation or TestRun.

| Tool | Input | Result |
| --- | --- | --- |
| `get_project_status_compact` | `projectId` | One project, current runtime/ownership and capacity counts |
| `get_test_run_status` | `runId` | One test's phase, placement, source summary and process result |
| `wait_for_status_change` | Exactly one project or run target, previous cursor, optional timeout | Changed snapshot or small unchanged result |
| `get_runtime_logs` | `projectId`, optional tail limit | Explicit bounded runtime log tail |

Names and defaults are proposals; recheck tools/list at implementation time.
Prefer flat mutually exclusive `projectId`/`runId` fields in the wait schema if
that is clearer to existing clients; validate exclusivity with the same shared
schema in the application boundary. Do not allow arbitrary filesystem targets.

### Compact envelope and fields

Return `schemaVersion: 1`, `epoch`, opaque `cursor`, `observedAt`,
`retryAfterMs` and one allowlisted status object.

Project status includes:

- project ID, bounded display name, stable configured port;
- selected worktree path and actual runtime worktree path as separate nullable
  fields: selection is not proof that the server is running there;
- runtime phase, start time and stable failure code, without logs, technical
  details or resource history. Null failure is distinct from unknown failure;
- reservation ID, kind, pinned worktree, expiry and safe owner presentation;
- owner relation (`self | other | human`) and a controller-generated label.
  Derive agent labels with an epoch-scoped secret hash or another bounded opaque
  scheme; never expose the raw session ID or treat a label as authorization;
- server capacity enabled/limit/used/available and test queue limit/running/queued,
  plus per-project counts if cheaply available. No unbounded holder/run arrays.
  Keep null/unlimited capacity meaning intact and do not infer permission from
  a free slot. Integrate preparing occupancy if the source fix adds it.

Test status includes stable run/project/preset IDs, exact worktree path, queue
position, phase, relevant timestamps, exit code/signal and safe error code. Include
bounded source qualification with queued/observed execution HEAD where available,
process outcome and uncertainty reasons from the implemented attribution contract.
At this baseline only queued HEAD is known: label it as such and expose unknown
execution evidence. Do not present `phase: passed` as verified source by omission.

Proposed maximum compact result size: 16 KiB UTF-8, including exact paths and
bounded source summary. Never truncate IDs, HEADs or paths used for an operation.
Bound display labels/messages; if a legacy record cannot fit, return a typed
size error with a detail-read hint instead of silently changing identifiers.
No credentials, lease secrets, raw actor/session identifiers, environment values,
free-form reservation reasons, full command arguments or arbitrary technical
error text belong in compact responses. Do not estimate tokens without a named
tokenizer. Preserve one existing MCP text representation initially; measure any
structuredContent addition because duplicating both can increase payload size.

### Explicit details and mutation results

- Existing `get_test_run` remains an explicit bounded legacy detail read. Add
  optional log-tail controls if needed, with unchanged defaults; new callers can
  request at most 40 lines/16 KiB while old callers keep their supported result.
  Report truncation separately and never cut a JSON document mid-string.
- `get_runtime_logs` defaults to 40 lines, at most 100 and 16 KiB total, with
  `truncated`/retained-line information. It reads the owned runtime buffer only,
  never an arbitrary file. Initially return a tail, not an invented replay cursor.
- Worktrees, presets and storage remain explicit tools. Their fresh discovery
  semantics do not become a hidden dependency of compact status or waiting.
  Optimizing all detailed adapters is outside this first compact-status slice.
- Add optional `responseMode: 'full' | 'compact'` to claim and run_test, defaulting
  to `full`. Both modes call the same mutation once and preserve idempotency.
  Compact claim returns reservation ID, placement, failure code and `leaseHeld`
  even after startup failure. Store/schedule the claim exactly as today before
  projecting the result. Do not expose its token or lose the handle needed to
  release it. Compact enqueue returns the same accepted run ID and source summary.
  If compact projection fails after a mutation succeeded, return its accepted
  handle and a read-error indicator; never encourage blind mutation replay.

## Cheap application queries

Add a focused module under `src/server/modules/status/` with a public index,
compact query service and wait coordinator. Read the nearest module guide and
keep ControlService as facade. Inject narrow dependencies in bootstrap; do not
create a second database owner or depend on dashboard implementation internals.

- Runtime adds a cheap summary method that does not clone logs or metric history.
  A distinct log-tail method reads only the requested bounded tail.
- Persistence adds a projected test-run query selecting status/source columns,
  excluding `logs_json`, and aggregate counts instead of decoding all test rows.
  If versioned source JSON exists, decode only its bounded summary. Reuse the
  owner connection and retention/error policy. No schema migration is needed
  solely for compact status; source-attribution migrations stay with that fix.
- Add an effective-reservation read filtering expired/released rows at a supplied
  time without modifying them. Share expiry predicates with existing policy and
  test exact boundaries. Mutation authorization continues to expire/validate
  leases transactionally; compact ownership is an observation, not a capability.
- Capacity calculation uses narrow runtime fields and existing lifecycle capacity
  authority, including pending starts. Avoid `projectSummaries()` if it still
  constructs large snapshots. Do not duplicate capacity counters in this module.
- No status or wait query invokes Git, preset discovery, storage scans, log-file
  reads, background metadata refresh, full dashboard or whole-history decoding.
  Reads remain bounded by the selected target plus small global aggregates.
- Error-code mapping lives at the shared boundary. If an existing error only has
  free-form text, emit a generic safe code and a detail hint; do not invent a
  precise code by brittle localized-string matching.

## Bounded waiting without a new event-log system

For this first slice, use one shared sampling coordinator while waiters exist.
It compares cheap projected state once per second, deduplicated by target. This
moves bounded observation to the controller and avoids repeated client payloads;
it does **not** eliminate all polling. No timer runs with zero waiters.

Do not hang wait directly on dashboard SSE revision: logs would wake it, and
MCP-only changes or lease expiry could be missed. A future complete domain event
source may replace sampling without changing the wait contract. That refactor
is not a prerequisite and is outside this item's scope.

1. A cursor is an opaque digest of the controller epoch, target and canonical
   meaningful compact state. Exclude observation time, retry-after countdown,
   logs, resource sample timestamps and other continuously changing diagnostics.
   Include phase, placement, relevant ownership/expiry, capacity, queue position,
   error/source qualification and actual run timestamps. Derive cursor identity
   from the safe underlying state, never leak raw actor text in it. Scope and
   validate cursors; a new epoch always requires reconciliation.
2. Wait first reads state. If different, return immediately with `changed: true`
   and the compact snapshot; otherwise register and recheck so a change in the
   registration window cannot be lost. Changes before a sample may coalesce.
   This is current-state reconciliation, not a guarantee to observe every
   intermediate transition or an audit/event replay feed.
3. Defaults: wait 10 seconds, maximum 20 seconds; sampling period 1 second;
   maximum 128 waiters globally, four per session and 64 distinct targets.
   Reject overflow with a stable busy code and `retryAfterMs: 2000`, retaining
   no waiter. Bound each poll batch; no overlapping sampling runs. Share the
   underlying projection across sessions, then apply each session's owner relation.
4. Timeout returns `changed: false`, current cursor/epoch and retry advice without
   repeating the snapshot. A normal GET or changed result includes the snapshot.
   For removed projects/pruned test records, return a typed not-found outcome and
   dispose the waiter. Do not keep tombstones indefinitely or recreate records.
5. Use the MCP SDK handler cancellation signal plus session/server close cleanup.
   The installed SDK exposes `RequestHandlerExtra.signal`; verify transport
   disconnect behavior against it in integration tests. Client abort, DELETE,
   session lifetime expiry, timeout, query failure and controller shutdown each
   release limits, timers and subscriptions once. A dropped HTTP connection must
   not leave work alive until the eight-hour session timeout.
6. No project lifecycle lock or database transaction stays open while waiting.
   A status read uses a consistent synchronous projection; if an async adapter
   is introduced, bind cursor to its observed data and serialize/guard completions.
   Wait cancellation never calls cancel_test_run, releases a lease, renews it or
   starts/stops a server. Existing session claim renewal remains independent.
7. Suggested ordinary-read retry advice: 1 second for running/queued transitions,
   5 seconds for steady runtime state, and no repeat polling for a terminal test
   unless the caller explicitly needs later evidence. Document client request
   timeout above server wait timeout (for example 25 seconds for a 20-second wait).
   On lost session, rediscover state and ownership; never repeat a mutation solely
   because a wait failed.

## Portable workflow and documentation

Update repository `skills/worktree-switcher/SKILL.md` when the implementation is
available. Do not edit the installed personal skill as the source of truth and
do not describe proposed tools as callable today. Keep a capability-detected
fallback for controllers offering only the existing tools.

- Inspect: list projects once, discover the exact worktree, then read compact
  status/capacity. Fetch profiles/presets only when required by the operation.
- Act: claim with compact response or enqueue a discovered preset with compact
  response, preserving the same idempotency key on retries. Tests do not claim
  a server; tests needing it require a separate server claim.
- Wait: use returned cursor for bounded wait while a transition is pending.
  Terminal results end the loop. Use retry advice on older controllers.
- Verify: check exact placement, phase, process/source outcome and relevant
  failure evidence. Fetch bounded logs once when needed; compactness must not
  omit the evidence required to report success or diagnose a failure.
- Release: explicitly release the current session's claim when the task is done.
  Release does not stop the server. A failed start may leave a claim held, and
  another session cannot release it merely by knowing its reservation ID.

Update MCP documentation with the actual tool names, phase/source semantics,
wait limits and fallback. Preserve local transport authentication and existing
mutation policy. Fix examples only where touched; source code takes precedence
over historical illustrative types in docs/reservations-and-mcp.md.

## Implementation and acceptance

Deliver a focused PR in this order: baseline/contract tests; narrow runtime/SQL
queries and safe projection; bounded waiting with cleanup; MCP registration and
optional compact mutation output; portable workflow/docs and measurements.
All APIs/defaults in this plan are proposed. Recheck source-attribution work and
current main before choosing final fields. No broad dashboard/UI refactor needed.

Required tests:

- Small versus populated histories: compact bytes remain stable except meaningful
  summary counts. Spy on Git/preset/storage/dashboard/log decoding and assert zero
  calls in compact read/wait paths. Cap payloads and preserve exact identifiers.
- Same target/multiple sessions shares one poll per tick; owner relation remains
  correct for each session. No global/target poll remains when all waiters leave.
- Logs and resource sampling do not change cursor; runtime phase, reservation
  renewal/release/expiry (including MCP-only changes), capacity and test terminal
  state do. No event is required for expiry. Test controller epoch changes.
- Registration race, timeout, cancellation, transport disconnect, session close,
  query error, target removal/retention and saturated waiter/target limits release
  ownership exactly once. Unrelated mutations proceed during waits.
- Sentinel credentials, raw session IDs, lease tokens, env values, reservation
  reasons and raw technical errors never appear in compact results/cursors/errors.
  Test missing/invalid bearer, rejected origins and cross-session mutation refusal.
- Legacy tools/resources/default mutation shapes remain compatible. New claim
  failure still exposes leaseHeld/handle; response projection cannot repeat the
  mutation. Cancelled waits do not release claims or cancel test execution.
- Integrate actual source attribution or explicit legacy uncertainty. Compact
  test output must not turn changed/uncertain process success into verified HEAD.
- Measure identical bounded claim and queued-test workflows before/after: same
  worktree, mutations, phase timeline, terminal outcome and required log evidence.
  Count all tool calls, including discovery, waits/timeouts, errors, fallback and
  final detail reads. Fix the baseline polling schedule in the fixture; do not
  claim universal call reduction for arbitrarily long waits or noisy state.
  Compare UTF-8 text bytes and full result bytes separately. Measure actual claim
  and enqueue compact results, not only projection estimates. Name the tokenizer
  if adding token numbers. Report controller query rate/latency under concurrent
  waits so reduced client payload does not conceal excessive server work.

Run focused query/wait/MCP/SQLite tests, `pnpm check` and `pnpm build` for module
and bundle changes. Preserve existing dashboard tests if shared runtime/store
code changes; browser verification is required if UI behavior is affected.
Use registered-project queue presets when available and supported finite commands
otherwise; heavy jobs run serially. The baseline probe used the supported test
command because only WinPath was registered, not this repository.

## Reproduce the baseline and finish the item

Copy attached `baseline-probe.test.ts.txt` to
`src/server/compact-mcp-audit.test.ts` in a disposable baseline checkout with
dependencies. Run `pnpm test src/server/compact-mcp-audit.test.ts`. It binds an
isolated ephemeral loopback MCP fixture and writes
`/tmp/switcher-compact-mcp-baseline.json`; it starts no managed development server.
Remove the copied probe afterwards. The literal fixture token is fake and local
to the test. No private configuration or production payload is captured.

Observed result: one probe passed, 577 ms overall (243 ms test). Attachments retain
the exact baseline fixture and result. The application implementation and complete
before/after workflow benchmark remain future work. Plan documentation passes
Hub fmt/validate and diff checks; those are not implementation verification.

After implementation, append actual measurements and resolved contract decisions,
then close the open item with its done entry. Rollback removes additive tools/
options and restores the old portable fallback without schema or lease-state
changes. Do not delete source-attribution evidence, release claims automatically
or describe the old full-status path as cheap.
