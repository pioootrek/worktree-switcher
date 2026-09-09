# Managed test queue acceptance plan

Date: 2026-09-09. Source baseline: `13e80fe` on `main`.
Item: `FEAT-20260902-managed-test-queue`.
Status: proposed execution plan based on source inspection. This plan does not
record new queue acceptance runs or close the feature.

## Outcome and existing evidence

Close the feature when one reviewed build demonstrates discovery, admission,
waiting, cancellation, source-qualified results and persisted history through
real HTTP, MCP and dashboard flows with portable Node and Django projects.
Preserve the current scheduler and environment policy.

The feature's older description overstates the unfinished implementation:

| Responsibility | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Queue limits, exclusion, cancellation, idempotency | `src/server/test-job-manager.test.ts` covers these with real jobs and controlled dependencies | Exercise the assembled controller through transports |
| Process descendants | `DONE-20260906-owned-process-tree-stop`; manager and process-group regressions | Confirm real cancellation and shutdown leave no fixture descendants |
| Final logs and retention | `DONE-20260907-test-log-lifecycle`; `src/server/test-log-lifecycle.test.ts` | Confirm final output and history remain visible after controller restart |
| Source attribution | `DONE-20260908-test-run-source-attribution`; manager, Git and classifier tests | Show clean, queued-change and dirty-result behavior through HTTP/MCP/UI |
| Environment isolation | Existing clean profiles and historical managed runs, as recorded in the feature | Confirm applied profile and absence of an injected controller-only sentinel in fixture output |
| Browser controls | `tests/ui/dashboard.spec.ts` uses mocked HTTP/EventSource for PL/EN actions | Add actual queue transitions against the built controller and real SSE |
| Portable execution | CI already builds, runs integration/E2E and consumes a package artifact | Add queue acceptance to the existing suites; add genuine Django setup |

Relevant implementation entry points are `src/server/test-command.ts`,
`src/server/modules/verification/verification-service.ts`,
`src/server/test-job-manager.ts`, `src/server/http-server.ts`,
`src/server/mcp-runtime.ts`, and `src/features/verification/`.
Read applicable subtree guides before changing these files. Historical done
records are evidence for their commits, not a claim that this plan ran tests.

## 1. Extend the isolated controller fixture

Reuse `tests/support/controller-fixture.ts`, real SQLite and temporary Git
repositories. Add the responsibility needed for test jobs without changing
existing switching/capacity fixture defaults. Suggested files are
`tests/support/verification-fixture.ts`,
`tests/integration/managed-test-queue.test.ts`, and
`tests/e2e/managed-test-queue.spec.ts`.

Create a minimal Node project with discovered finite scripts for success,
nonzero exit and a gated job with an owned descendant. Pin the package-manager
choice to an installed, portable executable. Record cwd, a fixture identity,
PID and final output marker. Keep gates, process evidence, test output and
virtual environments outside tracked inputs or explicitly ignored; commit
fixture source before enqueue so the ordinary success case stays clean.
Use explicit ready/release signals and bounded polling instead of timing sleeps.

Create a real minimal Django project with `manage.py`, settings and a passing
Django test, using a per-fixture virtual environment with a pinned Django
version. Verify compatibility when selecting that version during implementation.
Provision dependencies before application tests; avoid runtime network installs
inside individual cases. A fake `manage.py` only proves interpreter dispatch
and cannot satisfy Django acceptance. CI must install Python/venv dependencies
and fail clearly if required Django coverage cannot run, rather than silently
skip it. Reuse the environment across cases where isolation permits.

Allow the fixture to register both launch presets, use a distinct data/state
root and loopback endpoints, and open two independently owned MCP sessions.
Never reuse the installed service database or register temporary projects in
it. Keep access URLs, tokens and credential-bearing browser traces out of
reports. Extend cleanup to drain clients, jobs and controller before deleting
fixture directories; verify descendant exit, not just parent exit or port state.

## 2. Add transport acceptance

| Case | Trigger and required evidence |
| --- | --- |
| Q1 Discovery and successful execution | Discover exact worktree paths and presets through MCP. Run Node and genuine Django presets and read terminal results through HTTP and MCP. Require clean matching observations, exit 0, correct cwd/profile and final output. Confirm no development server or reservation was created. |
| Q2 Exclusion and progress | At limit 1, gate job A and enqueue another job in its worktree plus a job in another worktree. Assert queued positions and no duplicate execution. In a separate isolated case at limit 2, prove two distinct worktrees can run together while the same-worktree follower stays queued. Lower to 1, preserve current jobs, and admit successors only when capacity permits. Use tiny fixture jobs, not concurrent heavy builds. |
| Q3 Idempotency and authority | Retry one MCP request with the same key and session; require the same run ID and one spawn. A second session cannot cancel it. Its owner can; the local-user HTTP operation can cancel an agent job. Exercise a conflicting reservation without leaking ownership credentials. |
| Q4 Cancellation | Cancel a queued job and prove no spawn. Cancel a running job with a signal-resistant owned descendant and prove terminal state/capacity release follows descendant exit. Confirm a following job progresses and final log markers are retained. |
| Q5 Source before start | Enqueue clean revision A behind a gate, commit B or alter tracked source, then release capacity. Require rejection before spawn, null startedAt and source-change evidence. A fresh explicit request uses a new key; retrying the old request must not execute B. |
| Q6 Source during execution | Run unchanged clean source successfully, run dirty source successfully, and change source while a gated job runs. Compare full HTTP/MCP results with compact MCP status: process success remains visible, but dirty/changed source cannot yield an ordinary verified pass. |
| Q7 Useful errors | Remove a discovered preset or worktree before enqueue/preflight; use a nonzero command and malformed Node manifest. Require safe errors, truthful terminal state and no unrelated worktree execution. Preserve the original process failure when source also changes. |
| Q8 Restart and logs | Complete a run, restart the isolated controller cleanly, and verify retained history, source evidence and final output. Separately shut down with a running descendant and queued follower; prove cleanup and no late spawn. Keep crash recovery distinct from graceful cancellation. |

Keep short-timeout, unavailable Git evidence, delayed finalization, cleanup
failure, migration/legacy recovery and log-write failure checks in the existing
manager/store suites unless a missing transport behavior warrants a new case.
Discovered Node and Django presets currently have a fixed 15-minute timeout.
Do not wait 15 minutes per integration case or add a production timeout setting
solely for tests. Use the manager's short preset timeout regression as explicit
lower-level timeout evidence. If adding forced-crash recovery, use a dedicated
owned fixture process group and prove surviving children are cleaned up; do not
assume a killed controller cleans its descendants.

## 3. Add real dashboard acceptance

Use the built dashboard and actual controller API/SSE, with no route mocks for
these cases. Preserve the fast existing fixture suite.

1. Select the exact worktree and discovered Node preset; enqueue a gated run and
   a follower. Observe running/queued counts, position, output and cancellation.
   Cancel from the UI, then verify progress and terminal history via MCP.
2. Select the Django fixture and run its real preset. Verify interpreter/cwd
   evidence in bounded output, applied clean profile and a qualified pass.
3. Display dirty-source command success and queued source change. Verify the
   warning, queued/observed revision labels and absence of an unqualified pass.
4. Change the queue limit through its dialog in the isolated controller, verify
   the persisted setting, and confirm history after reload/reconnection. Assert
   operation errors remain visible when background refresh recovers.

Cover PL and EN for queue actions and source-result wording. Check keyboard
selection, dialog focus return, accessible status text, expandable output and
mobile overflow. Use accessible locators scoped to the project/run. Capture
only sanitized evidence after the pairing fragment has been removed.

## 4. Delivery and verification

First add portable fixture support and Q1, then admission/cancellation/source
cases, then browser flows and CI Django provisioning. Fix only defects actually
reproduced during this work, with a failing regression before each fix. Preserve
shared lifecycle coordination, one database owner, shell-free execution and the
separate finite-job state machine. No new scheduler, profile model, remote worker
or production service lifecycle is required by this feature.

Use the registered-project queue when presets are available, following the
repository's Worktree Switcher instructions. Otherwise run the supported finite
commands. Run heavy jobs serially and preserve host guards. Fixture concurrency
uses tiny child jobs inside one verification run; it does not authorize parallel
builds or a change to the installed service's queue limit.

Verification order for the implementation:

1. Focused manager/adapter/transport regressions affected by changes.
2. `pnpm check` and `pnpm build`.
3. `pnpm test:integration`, `pnpm test:ui`, then `pnpm test:e2e` against that build.
4. Existing portable CI/package smoke; keep source-only fixture helpers out of
   the consumer package contract. Add Django setup to the relevant CI job.

Review total E2E runtime against the existing 180-second suite deadline. Keep
fixtures bounded and cases economical; justify any repository test timeout
change with measurements. Never loosen host service or runner limits.

## 5. Closure evidence

Append an acceptance report to this note with commit and build fingerprint,
Node/Python/Django versions, fixture preset/worktree identity, source observations,
terminal/process outcomes, final output and owned cleanup evidence. Map each
Q case and browser flow to a result. Distinguish automated isolated acceptance,
controlled failure injection and any separately observed owner session.

The feature permits current dashboard/MCP acceptance against an isolated built
controller; an installed-service restart is not a substitute for those results.
The separately requested local service update must wait until Switcher is free
and does not close this feature.

Close only after required Node/Django transport and browser evidence passes,
with remaining defects resolved or explicitly retained as blockers. Replace the
open feature with one done record in the same commit and run canonical Hub
format/validation. Until then keep this item open. For this plan-only change,
run Hub format/validation and `git diff --check`; application suites are not
required and are not claimed as executed.
