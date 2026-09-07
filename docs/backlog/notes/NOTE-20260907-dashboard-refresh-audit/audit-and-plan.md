# Dashboard refresh amplification: audit and implementation plan

Audited: 2026-09-07. Baseline: `27df0e3109d5eff56a2d102ed0181ba9e585d8f5`
(main, after PR #10). Probes ran in a separate worktree at `1bea74e`;
relevant application sources are identical to the baseline. This is an audit
and proposed implementation plan, not a shipped fix. The backlog item stays open.

## Findings and evidence

### 1. Global output notifications multiply full repository scans

Current path:

`ProcessManager.append -> EventStream.publish -> changed SSE -> useDashboard.refresh
-> GET /api/dashboard -> ControlService.dashboard -> snapshot -> git.list/status`

- `src/server/process-manager.ts`, `append`: every output line calls the shared
  change callback. Runtime transitions use it too. Logs are bounded, but work
  caused by notifications is not bounded by the number of clients.
- `src/server/events.ts`: one 250 ms coalescing timer broadcasts an untyped
  global `changed {at}`. It limits notifications, not outstanding HTTP requests.
- `src/features/dashboard/use-dashboard.ts`, `refresh` and the EventSource
  effect: every change fetches a full snapshot without an in-flight guard.
- `src/server/control-service.ts`, `dashboard` and `snapshot`: every request
  concurrently reads every repository, discovers presets in each worktree,
  reads storage state and the last 20 test runs, including retained tails.
- `src/server/git-worktrees.ts`, `SystemGitWorktreeReader.list`: each repository
  read launches `git worktree list`, followed by concurrent `git status` for
  every worktree. There is no shared metadata cache, repository single-flight,
  or controller-wide subprocess admission limit. Existing command timeouts
  and output limits do not prevent amplification.

For successful reads, Git command count is
`clients × changed events × sum(1 + worktrees per project)`. Test output takes
an additional 500 ms debounce in `TestJobManager`; runtime output does not.
The five-second runtime resource sampler and `/api/metrics` are separate.

A deterministic delayed-reader probe measured 12 dashboard calls, 24 repository
reads, 72 preset discoveries and **18 simultaneous repository reads** for three
clients, two repositories, three worktrees each and four events. A repository
read is not a single Git subprocess; do not compare this peak directly with a
future subprocess limit.

### 2. Failed storage scans create their own refresh loop

`ControlService.snapshot(project, true)` invokes `ensureFresh`.
`WorktreeStorageManager.ensureFresh` checks the last successful measurement
(six-hour TTL). A failed scan has no fresh successful measurement. Its completion
removes the queued marker and publishes a change, so the next dashboard request
immediately schedules the same failed scan again.

With two projects, one client, failing scan adapters and **no external log
events**, the probe produced four follow-up dashboard calls and ten failed scans
within one second of virtual time, including the initial scans. Slow real scans
would change the rate, not eliminate the feedback path. This must be fixed in
this item: event classification alone would otherwise leave read-triggered
retries or old clients able to sustain the loop.

### 3. Older responses overwrite newer UI state; reconnect can miss updates

The dashboard hook blindly applies completed requests. The browser probe
emitted two changes, fulfilled the second response first, then the first:
`Newer response` was replaced by `Older response`. It exercised the actual
compiled dashboard with routed fixture data and no running development server.

Cleanup closes EventSource but does not abort outstanding dashboard requests.
Locale changes and mutations introduce further response races. Whole snapshot
replacement can also overwrite resource samples updated by `/api/metrics`.
The hook ignores the initial/reconnect `ready` event; there is no replay or
revision protocol, so changes missed during disconnect can remain unseen when
the system becomes quiet. These latter cases are source findings, not additional
browser reproductions performed in this audit.

### 4. MCP summary reads also enter the expensive dashboard path

`src/server/mcp-runtime.ts` builds `projectList` from `service.dashboard()`.
`list_projects`, project resources and resource-template enumeration therefore
perform Git/preset/history work and can schedule storage scans while returning
only a small project summary. Other project detail tools call `projectSnapshot`
(which does not schedule storage, but still scans Git). Preserve their public
contracts and share cheap application queries; broader compact MCP API design
remains in `FEAT-20260905-compact-mcp-status`.

### 5. A global Git TTL wrapper would weaken operational validation

Fresh Git discovery is used by project creation, reserve/claim, runtime
start/switch/restart, test admission and storage/cache operations. Runtime and
verification operations resolve worktrees under lifecycle coordination.
Cached display metadata must not become authority for these operations.
Current `git status` failures conservatively return `dirty: true`; retain that
safety and add explicit unknown/error information instead of showing clean.
List failures currently empty the worktree projection; retain last good data
with visible staleness in the new read path.

## Measured baseline and limits

Real Git fixture: two temporary repositories, three worktrees per repository,
101 tracked files per worktree, four events 270 ms apart. No runtime processes,
test history, storage scanner, HTTP server or browser are included in this
measurement. Git Trace2 start events count actual Git commands, excluding setup.

| Clients | Dashboard calls | Worktree commands | Status commands | Preset discoveries | Service JSON bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 4 | 8 | 24 | 24 | 21,540 |
| 3 | 12 | 24 | 72 | 72 | 64,620 |

One client caused 32 Git commands; three caused 96. This is one baseline run,
not a production benchmark or a before/after comparison. `measurements.json`
contains raw counts, wall time, Node CPU and RSS. CPU includes Vitest and excludes
Git children. RSS includes Vitest; `nodeRssPeakBytes` is sampled every 10 ms and
can miss the end-of-run high value. Byte counts exclude HTTP/SSE framing and
MCP serialization. Do not extrapolate CPU/RSS percentages or set production
budgets from these samples. Large histories and log tails remain unmeasured.

## Proposed design and implementation sequence

All new APIs, limits and defaults below are proposals for this fix, not existing
contracts. Implement as cohesive commits in one focused PR, preserving public
compatibility throughout. No database migration, recursive watcher, new service,
or second lifecycle coordinator is required.

### A. Establish a separate dashboard read projection

1. Read the nearest module guide, architecture and codebase organization before
   edits. Add a small dashboard query module under
   `src/server/modules/dashboard/` with a public `index.ts`, query service and
   metadata cache. Keep `ControlService` as the facade. Depend on narrow existing
   interfaces; bootstrap wires the one cache and existing store/adapters.
2. Cache discovered worktrees and test presets together by the stored canonical
   repository path. Preserve current repository identity rules; do not change
   identity to Git common-dir or open another database connection. Current
   runtime, reservations, test results and authorization are never TTL-cached.
3. Coalesce simultaneous metadata refreshes into one promise per repository.
   Suggested defaults: freshness TTL 30 seconds and failed-attempt cooldown
   30 seconds. Preserve last good data on error; expose last successful time,
   last attempt, refreshing flag, stale/unavailable status, safe error and retry
   time. A failed status check remains conservatively dirty with an explicit
   unknown/error marker. Successful discovery with a failed status must not be
   presented as a fully verified clean snapshot.
4. Bound the cache (proposed: 128 inactive/active entries, 8 MiB serialized
   metadata budget). Evict idle LRU entries, never in-flight work. When an entry
   cannot be admitted, return a controlled unavailable/stale result without
   launching uncached duplicate scans or silently truncating worktrees. Record
   the condition for diagnosis. Dispose timers, promises and entries on close.
5. Keep `/api/dashboard` as a compatible bootstrap snapshot backed by the shared
   cache. Cold reads await the shared refresh; stale reads can return last good
   data and request one background refresh subject to cooldown. No idle polling
   of Git. Existing clients may request stale metadata again after the TTL, but
   must no longer cause one scan per event/client. New output-only reads never
   trigger metadata refresh, including after TTL expiry.
6. Add an explicit project metadata refresh operation through the application
   facade and authenticated HTTP route, using project ID, not arbitrary paths.
   Manual refresh can bypass freshness/cooldown, but joins existing in-flight
   work and obeys admission limits. UI shows refreshing, stale, unavailable and
   last successful refresh states, with typed English/Polish translations and
   an accessible refresh button. Focus/reconnect may request stale metadata once;
   coalesce simultaneous triggers and honor failure cooldown.

### B. Bound Git execution without caching operational validation

1. Introduce one shell-free command admission boundary around the actual Git
   subprocesses used by discovery/status. Suggested initial cap: four running
   commands, 128 queued commands controller-wide. Limiting only repository
   promises is insufficient because each list fans out to all worktree statuses.
   Schedule statuses with bounded producers rather than eagerly allocating an
   unbounded promise queue. Keep existing command timeout/output limits.
2. Reserve admission for operational validation ahead of background display
   refreshes; queue exhaustion returns a safe busy error or stale display data.
   Cancellation, timeout and exceptions release admission exactly once; shutdown
   terminates only owned Git children and drains/rejects pending work. A shared
   metadata request survives one HTTP client disconnect; controller shutdown can
   cancel it. The query cache is not a second runtime lifecycle lock.
3. Keep fresh source discovery for add/reserve/claim, start/switch/restart,
   enqueue, explicit storage refresh and cache deletion. Preserve current
   validation and lifecycle lock placement. Share command admission where useful,
   never inject the display TTL cache as their Git reader. Test a worktree removed
   after display caching: the subsequent operation must reject it safely.

### C. Remove scan scheduling from live reads and break storage retries

1. Live state and MCP summary queries only read current storage snapshots.
   Schedule initial/stale storage measurements from successful metadata discovery
   or explicit refresh, preserving the existing serialized scanner and six-hour
   successful-measurement TTL. Do not schedule from output notifications.
2. Track failure attempt time/cooldown separately from successful measurement
   time (proposed 30 seconds). No self-retrying timer is needed: a later eligible
   metadata/manual request may retry. Explicit refresh may bypass cooldown but
   must preserve busy checks and lifecycle coordination. Scanner completion
   publishes a storage-only change, never schedules another scan itself.
3. Add a cheap project summary application query and use it for MCP project
   listing/resources/template enumeration. Preserve existing response fields and
   authorization, with zero Git, preset discovery or storage scheduling. Route
   existing detailed read projections through the shared metadata cache where
   compatible; leave new compact tools/history contracts to the related item.

### D. Classify changes and serve only affected live sections

1. Retain the SSE `changed` name and `at` field for compatibility. Add controller
   epoch, monotonic revision, global change kinds and project IDs with change
   kinds. Producers distinguish topology/config, runtime (including output),
   tests, storage and controller/session/settings state. Keep 250 ms coalescing;
   merge sets without losing changes. Do not put logs, credentials or unbounded
   replay history into events. Bound pending ID sets (proposed 128), falling back
   to an all-projects invalidation for the affected kinds when full.
2. `ready` supplies epoch/revision. Reconnect always reconciles bootstrap state;
   no assumption that missed events are replayed. Observe response backpressure:
   disconnect a slow client instead of accumulating writes indefinitely, and
   verify close clears its subscription and timers.
3. Add a live query such as `GET /api/dashboard/live` with bounded validated
   project IDs and allowed section names. Return only requested runtime/test/
   storage/controller sections and their epoch/revisions, with no Git calls,
   preset filesystem reads or `ensureFresh`. Runtime output must not reload test
   history. Existing bounded test history can initially remain in the test
   section; reducing detail/tail payloads further is separate work.
4. Keep new routes under existing `/api` token authorization, mutation origin
   checks and locale/error handling. SSE query tokens remain confined to SSE.
   Share query behavior through the application facade, not transport-specific
   business rules. Metadata refresh completion invalidates metadata display only;
   applying a read does not emit another change.

### E. Make browser reconciliation ordered and bounded

1. Replace direct refresh calls with one request coordinator: at most one
   dashboard/bootstrap/live reconciliation in flight, merge dirty scopes while
   pending and run at most one necessary follow-up at completion. Mutations and
   SSE use the same coordinator. Bootstrap requests subsume pending live scopes.
2. Abort on unmount/locale change and reject responses from old hook generations.
   Use epoch and per-section revisions for application order, not wall-clock
   timestamps. Capture the relevant revision with the corresponding data; an
   asynchronous Git read cannot label older project data with a newer revision.
   Refresh only that metadata section on completion, or retry a changed projection.
3. Preserve project removal with a topology generation/tombstone so a delayed
   response cannot resurrect a project. New bootstrap responses merge sections
   rather than overwrite a newer runtime/test/storage section.
4. Keep the five-second metrics path Git-free. Prevent overlapping metric
   requests; discard obsolete runtime/process samples and old hook generations.
   A bootstrap/live merge cannot replace newer resource samples with older ones.
5. Extend the browser fixture to emit typed changes and reconnects. Test English
   and Polish freshness/error states, refresh action, reconnect in an otherwise
   quiet system, locale change/unmount, metrics races and one active subscription.

### Invalidation matrix

| Trigger | Read-side action | Fresh operational validation |
| --- | --- | --- |
| Runtime log/state | Runtime live section only | Existing checks for commands unchanged |
| Test output/queue/terminal | Test live section only | Fresh discovery before admission |
| Storage result/failure | Storage live section only; no requeue | Existing scanner/lifecycle policy |
| Project add/remove/config | Update topology, invalidate affected metadata/presets | Existing project validation |
| Reservation/claim change | Current reservation/runtime projection | Fresh discovery where currently required |
| Successful start/switch/restart | Runtime; invalidate affected metadata if needed | Fresh discovery under lifecycle |
| Manual metadata refresh | One coalesced repository refresh | Validated project identity |
| External worktree/branch/file edit | Explicit refresh or stale reconciliation on focus/bootstrap | Fresh checks still protect operations |
| Preset-relevant configuration edit | Invalidate that project's cached metadata/presets | Enqueue resolves current command policy |
| SSE reconnect/controller restart | Bootstrap reconciliation; reset epoch on restart | No cached authorization |

Do not add a file watcher or infer that live log activity is evidence of Git
changes. The UI must disclose stale metadata rather than imply continuous Git
monitoring. A failure in one project must not clear unrelated projects.

## Acceptance and verification instructions

- Convert baseline bug reproductions into permanent behavioral regressions near
  the touched modules. Preserve these audit attachments unchanged as evidence.
- Warm metadata, then emit four output-only events for three clients/two
  repositories/three worktrees: **zero additional Git commands, zero preset
  discoveries and zero scan scheduling**, including after metadata TTL expires.
- Three simultaneous cold bootstrap readers share two repository discoveries:
  two worktree-list plus six status commands, eight total. Exercise mixed HTTP
  and MCP readers, timeout, partial status failure, TTL, explicit refresh,
  invalidation during refresh and queue/cache saturation. Peak Git children must
  remain at or below the configured cap; requests must not leak on cancellation.
- Failed storage fixture: two initial scan attempts and no event-driven retries
  during the one-second window. A later eligible retry after cooldown and a
  manual refresh work; existing busy protection still rejects unsafe scans.
- Demonstrate runtime output avoids test history reads. MCP project summaries
  perform zero Git/preset/scan work. Check all new endpoints with missing/invalid
  credentials, invalid IDs/scopes and mutation-origin violations.
- Browser: rapid changes coalesce; latest data wins; old responses/errors cannot
  overwrite state after locale change, reconnect, project removal or unmount.
  Newer metrics remain visible. Reconnect converges without another event.
- Repeat the real Git fixture before/after using identical sizes and separate
  cold/warm phases. Report commands, bytes, latency, Node CPU/RSS and, if measured,
  Git child CPU separately. Add a bounded noisy-runtime/test-history scenario;
  do not claim it was covered by this audit. Do not alter host guards to measure.
- Run relevant unit/integration tests, `pnpm check`, `pnpm build` (new module and
  bundle boundaries), and affected browser flows. Use Worktree Switcher presets
  when this project is registered; otherwise use supported finite commands.
  Run heavy verification serially. A managed live browser check requires its
  separate server claim; the routed static fixture requires no server.
- Inspect teardown and consistency as well as counts. Keep ownership tests for
  runtime/test/cache operations green. Update module documentation for the actual
  public API and append measured results to this note before closing the item.

## Reproduce the audit

Attachments: `server-probe.test.ts.txt`, `browser-probe.spec.ts.txt`, `measurements.json`.
The probes assert existing bugs, so passing means reproduction, not correctness.
In a clean disposable checkout at the baseline with dependencies installed:

1. Copy `server-probe.test.ts.txt` to `src/server/dashboard-refresh-audit.test.ts`.
   Run `AUDIT_REPORT_PATH=/tmp/dashboard-refresh-audit.json pnpm test
   src/server/dashboard-refresh-audit.test.ts` as one shell command.
2. Copy `browser-probe.spec.ts.txt` to `tests/ui/dashboard-refresh-audit.spec.ts`.
   Use a static export built from the baseline (`pnpm build` if absent), then
   run `pnpm test:ui dashboard-refresh-audit.spec.ts`. The fixture routes browser
   traffic to local exported files; it does not start a development server.
3. Remove the two copied probes. They create/remove temporary repositories and
   SQLite state, and use a test-scoped Git trace path; they do not touch managed
   project state. Respect registered-project queue and host rules above.

Audit execution: server probes **2/2 passed** (Vitest, 3.80 s overall); browser
probe **1/1 passed** (Playwright, one worker, 1.2 s overall). Browser verification
reused an existing export of identical dashboard source. No controller restart,
deployment, production load experiment or production fix was performed.

### Implementation measurement (2026-09-07)

The implementation worktree repeated the real Git fixture with two repositories,
three worktrees per repository and 101 tracked files per worktree. A cold phase
issued three concurrent full-dashboard requests; repository single-flight
produced two `git worktree` and six `git status` commands, six preset discoveries
and 17,121 serialized response bytes. It completed in 25 ms with 17.537 ms Node
user CPU, 4.925 ms Node system CPU, and RSS 85,487,616 before / 86,536,192 sampled
peak / 87,060,480 bytes after.

The separate warm phase issued 12 full-dashboard requests, matching three
clients receiving four events. It produced **zero Git commands and zero preset
discoveries**, 68,484 serialized response bytes, and completed in 9 ms with
8.246 ms Node user CPU, 1.01 ms Node system CPU, and RSS 87,060,480 before /
87,060,480 sampled peak / 88,895,488 bytes after. Git child CPU was not available.
Node figures include Vitest and are one run, so they remain diagnostic rather
than release budgets. The permanent regression separately advances beyond the
30-second metadata TTL and confirms the same zero-additional-work result,
including zero storage scheduling.

The final admission boundary keeps the four-process global execution cap but
applies the 128-waiter bound independently to operational and background work.
This bounded headroom lets fresh lifecycle and detailed MCP validation enter
when display discovery has saturated its own queue.

## Delivery and rollback

Implement this item before broader compact MCP work. Review the cache boundary,
revision protocol and storage retry behavior together; a debounce-only patch
is incomplete. Introduce no feature flag unless a concrete deployment need
appears. Retain compatible full-dashboard and SSE event names while the browser
moves to section reads. Rollback is a focused code revert and normal redeploy;
there is no persistent schema/config migration to undo. Reversion restores the
known amplification risk, so do not describe it as resolving this issue.
