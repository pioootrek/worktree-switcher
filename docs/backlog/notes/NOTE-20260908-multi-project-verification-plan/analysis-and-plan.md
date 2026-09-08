# Multi-project integration and browser E2E verification

Baseline: `8cf25aa1270162bc50e2996de5457e2212bc45b8`, reviewed 2026-09-08.
Primary item: `FEAT-20260829-multi-project-worktree-switching`.
Joint acceptance: `FEAT-20260829-dev-server-capacity`.
This is source analysis and an implementation plan. No application tests,
browser runs, resource measurements or installed-service changes were performed.

For the next capacity item, use [the focused implementation plan](capacity-implementation-plan.md),
reviewed against `76fa29d` after portable CI merged. The broader analysis below
retains its original baseline and covers the remaining multi-project work.

## Findings and existing coverage

The main implementation exists. The missing evidence is the composition of
real transports, application policy, persistence, Git discovery and owned
processes, followed by a small browser suite using that same real controller.

| Existing source | Real dependencies | Remaining boundary |
| --- | --- | --- |
| `src/server/control-service-capacity.test.ts` | ControlService, temporary SQLite; one adjacent case also launches a finite test process | Runtime ProcessManager, Git and command resolution are substituted. Last-slot and switch tests prove service policy, not real multi-project runtime behavior. |
| `src/server/control-service-agent.test.ts` | Service-level reservation and runtime-operation scenarios | Does not establish the browser-to-controller-to-process path. |
| `src/server/process-manager.test.ts` | Node child processes, sockets, owned descendants | No real Git/SQLite/HTTP/MCP composition. Some failure cases inject stop or health behavior. |
| `src/server/http-server.test.ts`, `src/server/mcp-http-server.test.ts` | Listening transport servers; MCP SDK client | ControlService is substituted; these establish transport contracts. |
| `tests/ui/dashboard.spec.ts`, `tests/ui/dashboard-fixture.ts` | Chromium and compiled static dashboard | `page.route` supplies API responses and `window.EventSource` is replaced. Runtime mutations edit fixture JSON. These are useful UI integration tests, not complete system E2E. |

`vitest.config.ts` currently includes only `src/**/*.test.ts`. The existing
Playwright config includes only `tests/ui`, with one worker and no retries.
There are no `test:integration` or `test:e2e` commands at this baseline.
Retain existing coverage; add explicit entrypoints so fixture tests cannot be
mistaken for proof of real controller behavior.

### Concrete status inconsistency to reproduce first

`ProjectLifecycle.capacityStatus()` includes a runtime with a retained PID even
when its phase is `failed`. This preserves capacity after unconfirmed cleanup.
`capacityStatusCompact()` instead reads `ProcessManager.statusSummary()`, which
contains phase/path/start time/failure code but no ownership indicator. It
excludes `failed` when no pending start remains. ControlService supplies this
compact method to StatusService, so compact project status can undercount the
same occupied slot that full capacity status and admission still retain.

This conclusion follows from those methods at the baseline; it has not been
reproduced in a running test during this analysis. First add a deterministic
regression: failed cleanup retains ownership, pending admission is cleared,
full and compact capacity must both report used=1/available=0 at limit=1, and a
different project must not spawn. Recovery must converge to used=0 exactly once.
The fix, if the test confirms the finding, belongs at the shared lifecycle and
process-status boundary. Expose a small internal ownership fact or shared holder
predicate; avoid hydrating logs/history or duplicating capacity counters. A
public PID or lease secret is not needed for compact clients.

Two acceptance descriptions also need precision:

- A failed runtime start can leave an authoritative agent reservation. Check
  `leaseHeld` and the operation error separately; capacity exhaustion does not
  necessarily mean claim acquisition itself failed.
- Failed startup releases a slot only after owned-process cleanup is confirmed.
  A failed phase alone is insufficient evidence that capacity is free.

## Test architecture and fixture contract

Use three layers, each with a specific purpose:

1. Extend nearby Vitest service/lifecycle/status tests for deterministic ordering
   and injected cleanup failures. Keep the SQLite adapter real where relevant;
   label the substituted process boundary explicitly.
2. Add `tests/integration` using a built foreground CLI/controller, real SQLite,
   real Git repositories, HTTP and MCP clients, and small real Node servers.
   This proves runtime composition without browser timing.
3. Add `tests/e2e` with a separate Playwright configuration. Load static assets
   from that controller, pair through its real URL, receive real SSE, and click
   the real dashboard controls. Do not import `mountDashboard`, intercept the
   application API, replace EventSource, or inject dashboard state.

Proposed helper boundary: `tests/support/controller-fixture.ts` plus the small
fixture server needed by its first scenario. Both integration and E2E reuse the
same lifecycle/setup contract. Avoid a general testing framework. Coordinate
with `NOTE-20260908-portable-verification-plan`: package smoke remains runnable
outside the checkout with its explicit dependency closure. Do not make its
consumer driver import source-only TypeScript helpers.

The fixture must provide:

- One foreground controller with private temporary data/state directories,
  browse root, singleton lock, loopback HTTP/MCP listeners and bounded logs.
  Start the exact built `dist/cli/index.js`, serving its own `out` assets;
  `--service-mode --no-open` provides private service-access discovery without
  installing a user service. Register projects through supported CLI/API paths;
  never open a second SQLite owner while the controller runs.
- Three independent temporary Git repositories A/B/C, each with two committed,
  discovered worktrees. Each has a dependency-free Node `dev` script resolved
  through the normal launch adapter. Runtime files live outside Git worktrees
  unless the scenario deliberately creates a dirty target.
- Distinct allocated project ports, fixed for each project's lifetime. OS
  allocation is not a reservation after a probe socket closes: handle collision
  as fixture setup failure, never terminate an unknown listener or move a
  registered runtime silently. Keep all fixture ports separate from installed
  controller and registered-project ports.
- A server response containing project/worktree identity, boot nonce and PID,
  and an append-only bounded spawn/exit record outside the worktree. Verify the
  response and process identity, not just `phase: running` or a reused PID.
- Explicit healthy, immediate-exit, HTTP-503 readiness and stubborn-descendant
  modes. Release a readiness gate through a fixture-owned file. Send HTTP 503
  promptly: hanging/closing HTTP can trigger ProcessManager's TCP fallback and
  accidentally satisfy readiness. Keep fault controls in test fixtures, not
  production HTTP/MCP endpoints.
- Condition-based bounded waits and a deadline for each operation/scenario.
  A gate reached by a fixture process supplies overlap evidence; arbitrary
  sleeps do not establish a concurrent race.
- `finally` cleanup: close browser/MCP clients and streams, gracefully terminate
  the owned controller, verify all fixture-owned descendants and listeners have
  exited, then remove temporary files. Track ownership from creation. Emergency
  cleanup may signal only identified fixture processes; needing it fails the
  run. A stopped/restarted test process is not a successful run.

Use a fresh controller per independent scenario, or reset through public APIs
with proven cleanup. Never let one failure's reservation/capacity pollute the
next test. Run one scenario/worker at a time; concurrent requests within a
single contention case are intentional, not parallel heavy suites.

## Integration acceptance matrix

| ID | Scenario and setup | Required observations |
| --- | --- | --- |
| I1 | Capacity disabled or set to 3; start A/B/C, switch each between its two worktrees | Selected project's boot/worktree changes; its configured port stays fixed. Other projects retain boot identity, reservation and responsive endpoints. Check each project as the switched target. |
| I2 | Agent claim on A through MCP; human request and second MCP session attempt conflicting mutations | Shared policy rejects competitors without spawn/stop; B/C remain usable. Authorized stop leaves the claim; explicit release clears it. Test exact claim authority, not matching display labels. |
| I3 | Capacity 2, start A and B; attempt HTTP start and MCP stopped-project claim/start for C | C has no spawn record. Existing processes remain alive; full/compact status agrees. MCP operation failure and any retained claim are reported separately, then explicitly cleaned up. |
| I4 | Capacity 2, A running; overlap B HTTP start with C MCP claim/start at the final slot | Exactly one new runtime reaches readiness and total holders never exceed 2. Gate the winner in `starting` to prove the loser arrived before completion. Repeat with the opposite transport admitted first; also release a common request barrier without assuming a winner. |
| I5 | Capacity 2, A/B running; gate A's switch while C requests start | A retains one slot through stop/start, C cannot take it, B remains unchanged. Deterministic service test covers the precise stop-to-spawn gap; real fixture gate covers the externally observable starting interval. |
| I6 | Immediate exit and readiness timeout, including a launcher with stubborn descendant | Await terminal cleanup; no old owned descendant/listener remains and one slot becomes reusable. Next project starts once. A failure in A never stops B. |
| I7 | Inject unconfirmed cleanup in the service/process boundary, then restore cleanup and retry | Retained ownership still occupies capacity in all read models; fresh start is blocked. Retrying stop releases capacity once. This is a controlled integration regression, not a claim of fully black-box OS fault coverage. |
| I8 | Lower limit 3 to 1 while A/B/C run; restart isolated controller after graceful stop | Lowering does not terminate any runtime; used=3, available=0 and all holders are visible. Persisted enabled/limit values survive restart; no stale runtime is reported as running. |
| I9 | Remove a discovered inactive target after dashboard metadata was read; separately dirty a valid target and occupy a stopped project's port with an unrelated fixture process | Live mutation revalidates discovery and rejects the stale target before stopping the active runtime. Dirty target remains runnable. Unknown listener survives the rejected start; no managed spawn is recorded for it. |
| I10 | Shutdown with all three owned runtimes, including a stubborn child tree, and an unrelated fixture listener | Controller exits only after its cleanup path; complete owned groups disappear. Unrelated process remains responsive until its own fixture owner disposes it. |

For every transition record before/after project identity, selected/runtime
worktree, phase, reservation, capacity and endpoint identity. Sample unaffected
endpoints during transitions and fail on observed disruption; sampled probes
do not prove mathematically zero downtime. At stable barriers compare HTTP
dashboard/full capacity, MCP capacity, compact status and runtime-operation
results. Do not demand identical values from reads taken on opposite sides of
a valid transition. Poll compact status for routine waits; avoid full Git scans
from repeated rich status requests.

## Small real browser suite

Use five focused scenarios, with setup through real CLI/HTTP/MCP and the action
under test through the dashboard. Scope locators by project and accessible
name; add a stable selector only where existing semantics cannot identify it.

1. **Independent switching:** pair a fresh browser, start three projects, switch
   A using its worktree selector and control. Confirm new endpoint identity and
   rendered runtime path/port, unchanged B/C identity and state after real SSE
   reconciliation. Stop A through its confirmation dialog and verify B/C live.
2. **Reservation conflict and recovery:** acquire A from a real MCP session;
   dashboard shows ownership and blocks conflicting action. Release through
   that same session, observe UI unlock, then switch through the dashboard.
   Preserve explicit stop-versus-release semantics.
3. **Capacity controls:** configure limit 2 through the UI, start A/B, attempt C,
   and check the visible capacity explanation and absence of a C process.
   Stop A, start C, then lower the limit to 1 and verify both survivors stay live
   with truthful usage. Do not require an enabled button when the UI deliberately
   blocks the action; verify its accessible explanation instead.
4. **Failure isolation:** launch A's failing worktree through the UI; assert the
   visible failure and retry/recovery on a valid target. Check B's boot identity
   and availability throughout, then verify capacity is reusable after cleanup.
5. **Dirty target and keyboard:** dirty an inactive target, explicitly refresh
   metadata, select/start it by keyboard, and confirm the persistent warning,
   visible focus, dialog focus restoration and non-color runtime labels. Check
   representative controls/error text in PL and EN; avoid duplicating every
   expensive runtime scenario for every locale.

Keep the existing fixture UI suite for rapid refresh/coalescing, localization
and dialog permutations. Real E2E adds composition evidence; it does not replace
those targeted tests or become a full visual redesign/managed-test-queue audit.

Use one Chromium worker, retries=0 and explicit per-test/global timeouts.
Pairing tokens and SSE URL tokens are real even in a temporary environment:
disable automatic raw traces/HAR/network attachments for this suite unless a
verified sanitizer removes them. Keep allowlisted diagnostics, fixture identities,
redacted errors and screenshots without pairing URLs. Do not upload SQLite,
service-access files, MCP tokens or browser storage.

## Delivery order and commands

1. Add the failed-cleanup/full-versus-compact regression, confirm the discrepancy
   and fix only that shared status boundary if needed. Preserve compact read
   bounds and cover recovery. Run the relevant existing suites and `pnpm check`.
2. Add the reusable fixture and `vitest.integration.config.ts`, including only
   `tests/integration`, with file parallelism disabled and one worker. Introduce
   proposed `pnpm test:integration`; implement I1/I3/I4/I5 first, then the remaining
   failure/authority/shutdown cases. Keep controlled adapter faults in nearby
   service tests rather than adding production fault endpoints.
3. Add `playwright.e2e.config.ts` and proposed `pnpm test:e2e` for the five real
   browser paths. Preserve `pnpm test:ui` and its fixture configuration. Build
   once, then run integration, existing UI and E2E sequentially. Missing/stale
   artifacts must fail clearly; commands must not silently start `pnpm dev`.
4. Connect to portable CI once its workflow exists: source check/build followed
   by sequential source integration and browser stages, with browser dependencies
   explicitly installed. Keep clean-consumer package smoke as its separate job.
   Do not claim package installation coverage from source E2E, or browser coverage
   from package smoke's static asset checks. Verify actual command discovery so
   default Vitest/Playwright configurations do not execute a suite twice.
5. Record evidence on the tested commit and complete the resource/owner-workflow
   acceptance below. Any discovered product defect needs a failing regression
   and a focused fix before affected acceptance is marked passed.

Suggested local sequence after implementation: `pnpm check`, `pnpm build`,
`pnpm test:integration`, `pnpm test:ui`, `pnpm test:e2e`. These new script names
are a proposal, not currently executable interfaces. Use registered verification
presets through the queue when available. The finite harness owns only isolated
fixtures; accessing an actual managed development server follows the repository's
Worktree Switcher skill/claim rules. This plan does not install or restart the
owner's service or alter host guards/resource limits.

## Resource evidence and completion

`RWK-20260829-idle-memory-budget` still needs an explicit reproducible procedure
and a fresh accepted budget; it does not yet provide a finished numeric gate.
Propose the following measurement protocol there before claiming this item's
resource acceptance: same Node/build/host, bare Node HTTP baseline, controller
with 0 and 3 registered projects, then 3 running fixture servers, recording
controller RSS separately from descendants and browser. Warm up 60 seconds,
sample at 1-second intervals for 120 seconds, perform 30 sequential switches
with bounded log output, settle 60 seconds, then sample another 120 seconds.
Repeat three times sequentially; include idle CPU, peak/median RSS, post-cycle
growth and retained log/history bounds. Record the fixture log rate and total
volume so the growth observation is reproducible.

These durations are proposed measurement parameters, not measured results or a
new product budget. Establish overhead/growth limits from fresh data and reconcile
the product/architecture documents under the memory item. Demonstrate that the
procedure detects a deliberately bounded local regression (for example retained
extra log batches or recurring Git work), then discard that regression. Do not
restore the superseded absolute 50 MiB target or make noisy single RSS samples a
CI pass/fail gate. Keep this longer measurement outside every-PR browser runs.

The evidence note must include tested commit, environment/runtime versions,
commands, scenario results, elapsed time, cleanup outcome and sanitized failure
artifacts. Record the owner's representative workflow separately: ordinary
dashboard switching, agent reservation, visible conflict and release/recovery.
Fixture automation alone must not be reported as an observed owner workflow.
Any installed-service validation remains a separate explicitly authorized action.

Keep both feature records open until their relevant matrix and browser checks
pass on the same reviewed implementation. Capacity can close when its isolated
contention/failure/persistence evidence passes; it need not wait for the memory
budget decision. Multi-project closure also requires the focused accessibility,
resource and owner-workflow evidence. Retain unresolved gates explicitly rather
than treating the addition of tests or this plan as completed verification.
