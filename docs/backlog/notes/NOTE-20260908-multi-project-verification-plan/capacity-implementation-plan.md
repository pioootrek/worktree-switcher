# Server capacity implementation and acceptance plan

Item: `FEAT-20260829-dev-server-capacity`.
Reviewed baseline: `76fa29d1a49fb99d999e0f3bb6b8b407a2d0b5fd`, 2026-09-08.
This document narrows [the joint analysis](analysis-and-plan.md) to the next
backlog item. It is the implementation entrypoint for capacity. No application
tests, process experiments or browser runs were performed while preparing it.

## Outcome and current evidence

All capacity readers must agree with admission after a runtime fails to stop.
The limit must continue to work through real HTTP/MCP requests, switches,
startup failures and controller recovery. Deliver this in two reviewable PRs.

The semaphore already exists. `ProjectLifecycle` owns per-project locks and
`pendingStarts`; runtime/profile operations share it. `capacityStatus()` counts
pending starts, active phases and retained PIDs. `capacityStatusCompact()` reads
`ProcessManager.statusSummary()` and counts only pending starts and active
phases. The summary has no retained-ownership fact, so a failed runtime with an
unconfirmed cleanup can disappear from compact capacity while admission still
blocks the next project. This is a source-level finding awaiting regression
reproduction; it is not evidence of excess processes being admitted.

`control-service-capacity.test.ts` already covers failed cleanup for restart and
switch, full status, blocked admission and recovery. Its process adapter is a
test double with no `statusSummary`. Extend that scenario rather than duplicate
it. Add coverage of the real summary path as well as the snapshot-only fallback.
`process-manager.test.ts` already has real processes and an injected
`OwnedProcessGroup.stop` failure, suitable for checking retained ownership.

Since the joint analysis, PRs #16 and #18 added `.github/workflows/verify.yml`,
`pnpm smoke:package` and cleanup-aware failure reporting. CI now checks/builds
the source and runs a separate clean-consumer package smoke. Use that existing
workflow. `test:integration` and `test:e2e` still need implementation.

## PR 1: make capacity status agree after failed cleanup

### Reproduce before changing behavior

At limit 1, start A and record its owned process identity. Make one stop attempt
fail while ownership remains retained, exercise both restart and switch, and
wait until the rejected operation has released its pending-start marker.

Assert at that stable point:

- A has runtime phase `failed` and still retains ownership.
- Full capacity and `ControlService.compactProjectStatus()` both report used=1
  and available=0. Full holders still identify A with the existing `stopping`
  holder phase; the runtime itself must remain visibly failed.
- Starting B is rejected and its spawn count stays zero.
- Restoring successful cleanup and stopping A yields used=0/available=1 in both
  read models. B can then start once. A repeated stop does not change B's slot.

Record the baseline assertion failure and then its passing result. Constructing
an expected JSON object is insufficient; call the facade's compact reader so
the test crosses the lifecycle-to-StatusService wiring.

### Implementation boundary

In `src/server/process-manager.ts`, expose one cheap internal retained-ownership
boolean through `RuntimeStatusSummary` (proposed name `retainsOwnership`). Derive
it from the same retained runtime identity that the full capacity path counts,
and verify it against actual ProcessManager cleanup behavior. Clear it only
after confirmed cleanup, including when the launcher has exited but its group
is still owned. Do not infer ownership from the current child being alive.

In `src/server/modules/lifecycle/project-lifecycle.ts`, use a private shared
holder classification for rich and compact reads. Normalize the full snapshot's
retained PID and the summary's ownership boolean into the same input. Preserve
these rules and the existing holder phase mapping:

| Runtime/admission state | Counts as one holder | Holder phase |
| --- | --- | --- |
| starting / running / stopping | yes | current active phase |
| failed with retained ownership | yes | stopping |
| pending admission, with no active phase or retained identity | yes | starting |
| failed after confirmed cleanup | no | none |
| stopped with no pending admission or ownership | no | none |

Keep snapshot-only test adapters working through explicit normalization, or
update the adapter contract and every caller together. Production compact reads
must use the cheap summary. Do not add a second counter, new lock map, database
migration, public PID, or phase that hides cleanup failure. Retain optional-limit
behavior (`available: null` when disabled) and clamp availability at zero when
the configured limit is below current usage.

StatusService uses an allowlisted public projection. Keep the ownership boolean
internal, preserve public schemas and cursor semantics, and verify no internal
field leaks into the MCP response. Include a compact-read test that makes rich
`snapshot`, Git discovery and log/history hydration fail if invoked by that read.
Do not scope such spies around legitimate runtime operations or full reads.

Likely touched files are `process-manager.ts`, its tests, lifecycle implementation
and tests, and `control-service-capacity.test.ts`. Update StatusService test
adapters when the internal summary type changes; add a public projection check
there if existing coverage does not catch extra fields.

Run focused process/lifecycle/capacity/status tests, then `pnpm check`. Keep this
PR free of fixture-suite and workflow changes. This fix alone does not close
the capacity item because real transport/process acceptance remains outstanding.

## PR 2: verify capacity on real processes and wire it into CI

Create `tests/support/controller-fixture.ts` with the first integration scenario,
then `tests/integration/server-capacity.test.ts` and
`vitest.integration.config.ts`. Expose `pnpm test:integration` with one worker
and file parallelism disabled. Keep it outside the default `src/**/*.test.ts`
suite to avoid running the same expensive cases twice.

The support code owns one built foreground controller, private temporary SQLite
and access files, three Git repositories, and distinct stable project ports.
A has a second worktree for switching. Each dependency-free Node fixture returns
its project/worktree, boot nonce and PID, and writes bounded spawn/exit evidence
outside Git. All setup uses supported CLI/API paths, real HTTP and real MCP SDK
sessions. Use compact status for routine waiting and compare richer views at
stable barriers. The joint plan defines isolation, readiness gates and ownership
cleanup; reuse that contract rather than repeat it in every spec.

| Case | Action | Acceptance |
| --- | --- | --- |
| C1: exhaustion | At limit 2, start A/B; try HTTP start and MCP claim/start for stopped C | C never spawns. A/B boot identities remain unchanged. Inspect the MCP operation error separately from any retained claim and clean up that claim explicitly. |
| C2: last slot | A runs; overlap HTTP B start with MCP C claim/start | Exactly one new server reaches readiness; used never exceeds 2. Gate the admitted fixture in starting to establish overlap, test each transport admitted first, then a common request barrier with no assumed winner. |
| C3: switch and restart | A/B run at limit 2; switch or restart A while C requests start | A retains its slot across stop/start and B retains boot identity. A's port stays fixed and its response proves the new worktree/boot. Deterministic service tests cover the exact stop-to-spawn gap. |
| C4: startup failures | Exercise early launcher exit and HTTP-503 readiness timeout with an owned stubborn descendant | After terminal cleanup no owned listener/descendant remains, used decreases once, and C can start. B remains available. Do not report the injected stop-denial regression as a black-box OS failure test. |
| C5: lowering and persistence | Run A/B at limit 2; lower to 1; gracefully stop the fixture controller and restart it with the same private state | Both runtimes survive the limit change, used=2/available=0 and both holders remain visible. The new controller retains enabled/limit settings without claiming old processes are running. Also cover disabled capacity and re-enabling in focused tests. |
| C6: unrelated port owner | A fixture-owned unrelated process occupies C's configured port while capacity is available | C start fails without a managed spawn, the unrelated listener remains responsive, and failed C consumes no slot. Only its test owner disposes the unrelated process. |
| C7: shutdown | Shut down with owned runtimes and a stubborn descendant still running | All owned groups exit; controller and project listeners close. Cleanup failure or emergency termination fails the test and is present in the final report. |

Read full HTTP capacity, MCP `get_server_capacity`, compact project status and
claimed runtime-operation results at the relevant stable points. Compare the
fields each contract actually exposes. Reservation release does not itself
stop a runtime or free its capacity; explicitly test that distinction. Use
separate sessions and their real returned claim handles for authority checks.

Then add one real browser scenario in `tests/e2e/server-capacity.spec.ts`, with
`playwright.e2e.config.ts` and `pnpm test:e2e`. Pair through the real controller,
set limit 2 through dashboard controls, start A/B, verify C's blocked start and
visible explanation, stop A and start C, then lower the limit to 1 and verify
both remaining servers and truthful usage. Use actual API/SSE and endpoint
identity. Keep the existing fixture-based `pnpm test:ui` tests for localization
and dialog permutations. The other four browser flows remain in the multi-project
item and are not required to close capacity.

Use one Chromium worker, retries=0, bounded waits and a global timeout. Scope
locators by project and accessible name. Do not upload raw traces, browser
storage, pairing URLs, token-bearing SSE URLs, SQLite or private access files.
Save allowlisted diagnostics and sanitized screenshots. Finalize the outcome
after cleanup, following the lesson from package-smoke PR #18.

### CI and verification commands

After the existing `pnpm build` step in `check-build`, run integration and the
browser suites sequentially. Install the browser/system dependencies explicitly
for the pinned Playwright version. Keep the separate `package-smoke` consumer
job and artifact provenance checks intact. The smoke driver is an executable
standalone script, not an importable test library; importing it would execute its
top-level workflow. Reuse its approach, or extract helpers only if both callers
need them and the consumer job receives their entire dependency closure.

The proposed local sequence is `pnpm check`, `pnpm build`,
`pnpm test:integration`, `pnpm test:ui`, `pnpm test:e2e`. Existing CI continues
to run the package smoke as well. Build once from the tested revision; fail
clearly when artifacts are absent or stale. If new helpers enter the published
package or the smoke driver changes, also run `pnpm smoke:package` locally.

Use registered test presets through Worktree Switcher's queue when available.
The finite test fixture starts only its isolated controller and fixture servers.
It must not replace the installed controller, claim an owner's project port,
start `pnpm dev`, or alter host guards. A managed development server, if needed
outside that isolated fixture, requires its normal claim and lifecycle tools.

## Evidence, closure and rollback

Attach a durable acceptance report under this note with the tested commit,
Node/platform versions, exact commands, C1-C7 results, regression before/after,
browser result, elapsed time and final owned-process cleanup result. Record
which cases used substituted adapters and which used real transports/processes.
No result in this planning document is a test pass.

Close the capacity item after both PRs are reviewed/merged and all listed gates
pass on the final implementation. Move the open record to a `done/` entry in one
backlog commit using canonical fmt/validate. Leave the broader multi-project
item open with a link to reusable fixtures and completed capacity evidence.
Its remaining E2E paths, memory-budget decision and owner-workflow observation
do not block this item's isolated capacity acceptance. An installed-service
update is not part of this work's acceptance scope.

If a regression appears, revert the responsible patch or record the failing
case and keep the item open. Preserve the owner's configured limit and existing
reservation policy. Test infrastructure failures must fail verification rather
than downgrade a real integration case to a mocked pass.
