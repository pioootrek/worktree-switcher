# Test-run source attribution implementation plan

Date: 2026-09-08. Inspected baseline:
`fd3f9e55fb11be3c1a5a7e7dcbb560f1d3cb9e7a` (main, after PR #12).
Item: `FIX-20260905-test-run-source-attribution`.
Status: proposed implementation instructions. No production code changed and
no queue/source-change reproduction was run while preparing this plan.

## Outcome and proposed policy

A queued test must not appear to validate revision A if it actually starts from
B. Record source observations at admission, immediately before spawn and after
owned processes stop. Keep the process outcome separate from source attribution.

Proposed default behavior for the implementation:

- A detected change between enqueue and preflight ends the run without spawning.
  Report `source_changed_before_start`; require a new explicit enqueue with a new
  idempotency key. Do not silently execute B or automatically retry the mutation.
- A missing/prunable/replaced worktree or unavailable preflight evidence also
  prevents spawn. Preserve the reason and observation; `startedAt` remains null.
- Dirty source is allowed to execute when there is no detected queued change,
  but its result cannot certify HEAD. Record the process exit independently and
  mark source attribution uncertain. Equal dirty booleans do not prove equality
  of contents. This preserves useful test output for in-progress edits.
- After execution, detected source changes or incomplete evidence prevent an
  unqualified pass. Suggested compatibility policy: retain the existing phase
  enum, use `failed` plus a stable source reason for process-success runs with
  changed/uncertain attribution, and show “Command passed; source unverified” in
  the new UI. `exitCode: 0` and the separate process outcome remain available.
  This deliberately changes the meaning of green success for dirty worktrees;
  do not introduce it as an unnoticed compatibility tweak.
- Unchanged, clean, complete observations retain the normal `passed` path. Call
  this `observed_match`, never “immutable”, “reproducible” or proof that no edit
  occurred between observations. Failure, cancellation, timeout and interruption
  retain their existing execution reasons; source findings do not replace them.

These are reviewable product defaults for this plan, not already accepted API
contracts. Keep them together in the implementation PR description. If a less
strict dirty-result policy is selected, explicitly revise phase compatibility,
UI labels and acceptance tests before implementation; never silently restore
“passed for HEAD” from a dirty boolean.

## Current code and required boundaries

| Location | Observed behavior | Required change |
| --- | --- | --- |
| `src/server/modules/verification/verification-service.ts`, `enqueueTest` | Fresh discovery, reservation check, command/environment resolution under lifecycle lock | Capture fresh enqueue evidence through a verification port; preserve admission authorization |
| `src/server/test-job-manager.ts`, `enqueue` | Copies `worktree.head/branch/dirty` into the run | Preserve these historical enqueue fields; initialize versioned source evidence |
| Same file, `pump/start` | Synchronous start occupies `active` after spawn; no second Git read | Account for async preparation before awaiting; revalidate target before spawn |
| Same file, `complete/finish` | Exit, owned-process cleanup and log finalization decide phase | Observe source after cleanup, then derive source-qualified outcome before final persistence |
| `src/server/infrastructure/sqlite/test-run-queries.ts` | Upsert updates lifecycle/log fields only | Persist source evidence on insert and update; do not overwrite immutable enqueue attribution |
| `src/server/infrastructure/sqlite/migrations.ts` | Latest migration is 11 | Add the next migration after rechecking main; preserve one SQLite owner |
| `src/features/verification/test-panel.tsx` | Shows enqueue HEAD beside a green `passed` badge | Label queued versus observed execution source and source-qualified outcome |
| `src/server/mcp-runtime.ts`, HTTP test/dashboard responses | Return the existing TestRun shape | Add bounded source evidence and stable reasons, with consistent localization |

Reuse the shared `ProjectLifecycle` installed by PR #12. Its shutdown now closes
admission and drains accepted operations. Test queue and process ownership remain
in `TestJobManager`; provenance is not a second queue, lock map or capacity pool.
Do not use dashboard metadata cache for any source observation.

## 1. Define evidence and outcome contracts

Add browser-safe, versioned source types to shared contracts and a pure outcome
classifier in the verification module. Proposed `TestRun.source` fields:

- `version: 1`, `scope: 'git-observations'`;
- `enqueue`, `preflight`, `finish`: nullable observations;
- each observation: timestamp, HEAD, branch, dirty (`boolean | null`), a digest
  of bounded canonical Git status, completeness and a safe error code;
- `queueComparison` and `executionComparison`: `match | changed | unknown`;
- `attribution`: `pending | observed_match | changed | uncertain | legacy_unknown`;
- bounded, deduplicated `reasonCodes`, such as HEAD changed, status changed,
  dirty source, status unavailable, missing worktree or observation limit;
- separate `processOutcome`: null before execution, then the command's outcome
  (`passed | failed | cancelled | timed_out | interrupted`), without claiming
  that successful execution validates the enqueue source.

Keep existing `worktreeHead/Branch/Dirty` as enqueue-time fields. Document that
`preflight` is an observation before the attempted spawn, not proof that the
process started: `startedAt`/process outcome establish that distinction. Never
copy enqueue metadata into a missing preflight/finish field. Do not persist file
contents, raw diffs, environment values, lease tokens or session credentials.

Classify observed inequality as `changed` even when other evidence is missing.
Otherwise missing/partial evidence, dirty inputs or unsupported scope produces
`uncertain`. Only complete clean observations at all three points can yield
`observed_match`. Branch-only changes are recorded and conservatively invalidate
queued attribution even if HEAD is equal. A cancellation before spawn retains
available evidence but has no process-success or execution comparison claim.

## 2. Add a bounded source reader

Use an explicit verification-domain interface, implemented by a Git adapter.
The module imports its public API; bootstrap injects one implementation sharing
the existing operational Git command admission. Do not spawn an independent
unlimited Git executor or scan in response to logs/status polling.

- Resolve the exact worktree from fresh registered-repository discovery. Reject
  prunable/absent targets. Recheck canonical path/repository identity and that the
  command cwd still belongs to the admitted worktree; never fall back to another
  worktree or execute a path supplied only by a client/persisted stale record.
- Capture HEAD/branch and `git status --porcelain=v1 -z --untracked-files=all`
  with explicit submodule handling. Use shell-free argv, existing operational
  priority, bounded time/output and unambiguous NUL parsing for rename/path data.
  A proposed ceiling is 5 seconds per source command, 1 MiB status output and
  10 seconds for a whole observation including admission wait. Timeout, truncation
  and admission saturation produce unavailable evidence, never a clean default.
- Hash normalized bounded status records for comparison. The digest identifies
  status changes; it is **not a content fingerprint**. A file edited twice while
  remaining `M` may have the same digest, so dirty observations stay uncertain.
  Nonignored untracked files and submodule dirtiness likewise prevent HEAD-only
  attribution. No recursive content hashing is required in this first fix.
- Read HEAD around status capture; disagreement marks the sample unstable.
  This narrows races but does not make the observation atomic. Return only
  bounded digests/summary counts and evidence, not raw path lists or diffs.
- Git status may omit assumed-unchanged/skip-worktree entries and sparse checkout
  contents. Detect unsupported index/sparse/submodule cases through bounded Git
  inspection and mark scope incomplete; do not certify unsupported layouts.
  Git-ignored inputs, dependencies, external services, filters and environment
  changes are outside this source-only guarantee. State that limitation even for
  clean observations. No watcher or “changed then restored” detection is promised.

Cancellation must remove or cancel a waiting observation and stop only its owned
Git subprocesses. Existing admission has controller-wide cancellation; extend
its narrow public cancellation contract if needed so cancelling one queued run
cannot close the shared reader used by every other project.

## 3. Make preparation an owned part of queue execution

1. Add a preparation registry for selected runs before the first async await.
   Count preparation plus running/finalizing ownership against the existing
   global test limit and per-worktree exclusion. This extends the queue's one
   authority; do not duplicate limits in the source reader. Preserve FIFO policy
   for eligible runs and progress for unrelated worktrees/projects.
2. Keep the public phase `queued` during preparation. Expose an additive preparing
   count/flag if the UI needs it and document how it contributes to occupied
   capacity; never report a free slot that is already reserved. Clear/recompute
   queue positions consistently and prevent a second pump selecting that run.
3. Capture enqueue evidence before persisting/admitting the new run. Do not run
   fresh evidence collection for an already accepted idempotent replay; return
   its original run without resetting evidence or spawning again. Preserve the
   existing authorization and conflicting-key checks.
4. For preflight, enter the shared project lifecycle once, require the project,
   freshly resolve the worktree, collect evidence and validate the stored cwd.
   Compare the resolved executable/args/preset to the queued command; fail on
   changed command definition instead of silently updating it. Keep the already
   resolved in-memory environment policy and timeout, never persist its values.
5. This fix does not add lease renewal or a new reservation policy at delayed
   start. Preserve enqueue-time authorization; do not reconstruct lease secrets
   from actor labels. If existing policy requires an additional admission check,
   use a narrow in-memory authorization context and test expiry explicitly.
6. After every await, check cancellation/closed state and ownership generation.
   Save preflight evidence before spawn. Set running/startedAt at the actual
   launch transition and install active ownership before releasing preparation.
   Perform the final validation-to-spawn transition within the lifecycle callback;
   release that project lock immediately after launch, not for the whole test.
   Filesystem changes by external editors remain outside this lock's protection.
7. Cache deletion must continue to see a pending/running test while preparation
   owns its slot. A source read must not create a scan permit or bypass lifecycle
   maintenance. Reuse PR #12's exclusion and project-removal behavior.
8. Preflight rejection goes through the existing idempotent finalizer, closes the
   test log and releases preparation only when no child can later spawn. Cancel
   and shutdown abort/drain preparations before releasing worktree capacity.
   Observe every async rejection; do not leave detached promises or deadlock by
   reacquiring a lifecycle lock already held by the same callback.

## 4. Complete evidence before releasing a run

After owned-process cleanup and output closure succeed, collect the final source
observation while keeping the test slot/worktree exclusion. Do not hash or scan
on every output chunk. If cleanup is unconfirmed, preserve the current nonterminal
ownership behavior and do not finalize source evidence as if execution ended.

Final observation failures are attribution failures, not process-cleanup failures.
Store uncertain evidence and finalize instead of retaining an otherwise stopped
run forever. Preserve the actual exit code/signal and process error; combine
source reasons without overwriting log-finalization errors. Derive phase once
all required evidence/log completion is available and persist the terminal run
before releasing ownership. Keep duplicate complete/cancel calls idempotent.

At shutdown, close queue admission, cancel/drain preparations, stop active owned
process groups and finish required evidence before closing Git/SQLite/logs. Do
not submit a new project-lock request after `closeAndDrain` has closed admission.
Use already owned finalization work or mark shutdown evidence unavailable and
interrupted. Bound pending Git cancellation and test that shutdown cannot hang
waiting for a resource it has already closed.

## 5. Persist, migrate and present consistently

- Prefer a nullable bounded `source_json` column and a small process-outcome
  field (or a single versioned evidence object) added in one transaction. Enforce
  runtime decoding and size bounds, proposed 8 KiB per run. Keep the current phase
  constraint and retention policy. Update both insert and ON CONFLICT paths;
  log persistence must not restore an older source object after finalization.
- Map old rows without evidence to `legacy_unknown`. Retain their historical
  phase, HEAD, logs and dates; never backfill execution evidence from current Git.
  Restart marks queued/running jobs interrupted as today, retaining whatever
  evidence was already written. A queued preflight failure remains distinguishable
  from a command that executed and returned nonzero.
- HTTP, detailed MCP responses, dashboard bootstrap/live test sections and history
  reads share the same bounded contract/classifier. Add safe, localized source
  reason messages through the current i18n mechanism. Do not add a new endpoint
  or include full Git status/path lists in every response.
- UI shows process result and source attribution separately, with enqueue and
  preflight HEAD when different. Dirty/unknown/legacy evidence has a visible text
  label, not only a color or tooltip. Legacy `passed` must not appear as newly
  verified source. Provide English/Polish strings and accessible details.
- Document the new success semantics in MCP tool descriptions and project docs.
  Test consumers that only inspect `phase`: new changed/uncertain process-success
  runs must not look like ordinary passes. Coordinate the additive evidence fields
  with `FEAT-20260905-compact-mcp-status`; do not implement that separate workflow.

## Verification and delivery sequence

1. Add a deterministic reproduction first: occupy the queue, enqueue commit A,
   change to B, release the blocker. Use real temporary Git repositories and a
   harmless command with a marker proving whether spawn happened. First establish
   that the baseline wrongly reports A; keep the corrected test as a regression.
2. Implement evidence types/classifier, bounded reader and migration with focused
   tests. Then wire async preparation/finalization, followed by transport/UI/docs.
   Keep these as reviewable commits in one PR, not separate partially wired releases.
3. Required behavior matrix:

| Scenario | Expected evidence/result |
| --- | --- |
| Clean A at enqueue/start/end, exit 0 | `observed_match`, process and qualified phase passed |
| A queued, B before preflight | Changed, no spawn, failed with source reason, startedAt null |
| Same HEAD, tracked or nonignored untracked changes while queued | Detected status difference rejects spawn; equal dirty status remains uncertain |
| Dirty at all points, exit 0, even with equal status digests | Process passed, source uncertain, no ordinary green pass |
| A at start, B or dirty source at finish | Changed/uncertain, exit code preserved, no qualified pass |
| Source changes and is restored between observations | Explicit scope limitation; no claim that endpoint sampling detects it |
| Missing/prunable/replaced/symlink-redirected cwd before spawn | No execution outside validated worktree; safe failure |
| Timeout/truncated status/unsupported index layout | Unknown/uncertain, never false clean; limits and cancellation released |
| Process failure/cancel/timeout plus source change | Execution reason retained, source evidence added |
| Delayed preflight plus repeated pump/limit change | No duplicate spawn, capacity or same-worktree overlap |
| Cancel/shutdown during discovery or just before spawn | No late child; log, preparation, Git and lifecycle resources drained |
| Idempotent replay after source changes | Same run/evidence, no second execution |
| Old DB/restart during preparation or finalization | Legacy/interrupted evidence remains truthful, no fabricated timestamps |

4. Add regression coverage for cache deletion during preparation/finalization,
   cleanup failures, log flush errors, unrelated project progress, slow/out-of-order
   persistence and final Git failure after exit 0. Preserve the test-log and cache
   lifecycle guarantees already merged. Include HTTP/MCP contract tests and browser
   fixtures for clean, changed, dirty and legacy cases in both languages.
5. Run focused tests, `pnpm check`, `pnpm build` for module/bundle changes and
   `pnpm test:ui` for affected static dashboard flows. Use registered-project MCP
   presets when available, supported finite commands otherwise. Run heavy jobs
   serially; a live managed server requires its own Worktree Switcher claim.
6. Record observation calls/latency on a small clean/dirty fixture and bounded
   failure cases. Reads occur at enqueue/preflight/finish only, not per log event
   or status poll. Do not call this content reproducibility or promise token savings.
7. Update architecture/module docs for implemented boundaries, append actual
   evidence to this note and close the backlog item only after review/verification.
   Plan-only work requires Hub fmt/validate and git diff --check, not application
   tests or a controller restart.

Rollback must retain the new evidence column and historical records. A safe
behavior rollback preserves source-aware qualification and legacy warnings;
reverting to an old client/controller that ignores them restores the known
misattribution problem. Do not down-migrate or relabel uncertain runs as verified.
