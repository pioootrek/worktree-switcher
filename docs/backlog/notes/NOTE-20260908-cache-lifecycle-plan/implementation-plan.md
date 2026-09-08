# Cache deletion lifecycle coordination

Task: `FIX-20260905-cache-lifecycle-serialization`.
Baseline: `a83170383ac6d4ea9336c33f6b517c70915a3984`.
Prepared on 2026-09-08 from source inspection. At preparation time the
interleavings below still needed executable reproductions and the branch held
planning documents only. The owner requested a separate branch/worktree; the
Hub will see this note after it is committed and integrated into `main`.

Implementation status: completed in the working tree on 2026-09-08. The shared
lifecycle now owns project serialization and synchronous maintenance/scan
permits; production storage receives that same lifecycle instance. Deterministic
regressions cover deferred deletion against runtime start, reservation, test
admission, automatic and explicit scans, cleaner failure, project independence,
and shutdown draining. `pnpm check` passed 209 tests, `pnpm build` completed,
`pnpm test:ui` passed 5 tests, and backlog validation and `git diff --check`
passed. The open item remains until the implementation is committed through the
required backlog-closing workflow.

## Result to deliver

Once cache deletion has passed its checks, no conflicting runtime operation,
claim, reservation, test admission or storage scan may enter the worktree until
deletion finishes. Failure must release the exclusion. Other projects must
continue to work. Keep the existing cache allowlist, path validation, HTTP
authorization, reservation policy, audit records and response shapes.

## What the current code does

| Path | Current behavior | Consequence |
| --- | --- | --- |
| `src/server/modules/lifecycle/project-lifecycle.ts` | Owns per-project `serialized` locks and pending server capacity | Reuse this authority for maintenance |
| `src/server/control-service.ts`, `deleteWorktreeCache` | Checks fresh Git data, runtime, reservations, storage and queued/running tests, then awaits the cleaner outside serialization | A start, claim, enqueue or second deletion can enter during removal |
| `src/server/modules/runtime/runtime-service.ts` | `operate` takes the project lock; `operateLocked` assumes its caller holds it | Cache deletion must share that lock, including profile-triggered restarts |
| `src/server/modules/verification/verification-service.ts` | Validates and enqueues under the project lock | Existing queued/running test records can exclude deletion without locking a whole test run |
| `src/server/worktree-storage.ts` | Marks scans pending synchronously, then runs them through one global promise chain | Project serialization alone cannot exclude automatic scans |
| `src/server/modules/dashboard/dashboard-query.ts` | Successful discovery calls `storage.ensureFresh` | Scan admission must also cover background discovery and detailed MCP reads |
| `src/server/control-service.ts`, `shutdown` | Stops tests/runtime, then closes storage and persistence | Active maintenance must finish before its audit store closes |

Storage's `isBusy` includes queued scans, not just the currently running scan.
Preserve that conservative rule. Runtime and scans may currently overlap; this
fix only adds mutual exclusion with destructive cache maintenance.

## Implementation decisions

Use the existing project lock for the whole cache operation, from project lookup
and fresh Git discovery through cleaner completion and audit. All existing
runtime, claim, reservation, project removal and test-admission paths already
use that lock. Avoid calling `serialized` again from code that holds it.
Operations queued behind maintenance must repeat their normal validation after
they obtain the lock. Same-project operations may wait; unrelated projects must
not share a maintenance lock.

Add worktree maintenance and scan admission to the same `ProjectLifecycle`
authority. Expose a narrow interface to storage, with synchronous acquisition
and idempotent release. Use a project ID and a Git-derived absolute worktree
path as the key. Maintain only active/pending ownership entries and delete them
when released. Do not add another lifecycle lock map in storage or maintenance.

Scan admission must acquire its permit before publishing a pending state or
adding work to the global scan chain. Keep it until completion, failure or
shutdown, including time spent queued. Maintenance acquisition refuses a
pending/running scan; scan acquisition refuses active maintenance. These checks
and acquisitions must contain no `await` between them.

An automatic `ensureFresh` attempt blocked by maintenance skips scheduling and
does not record a failed scan or start a retry timer. Explicit storage refresh
takes the existing project lock before discovery and scheduling, so it waits
for maintenance. After successful deletion, release the maintenance permit and
request the existing forced measurement while still holding the project lock.
Use storage's deduplication to keep one pending measurement per worktree.
If deletion fails, release its permit in `finally` and preserve the original
failure and audit semantics.

Construct or inject the shared lifecycle so storage and all application modules
receive the same instance. Production construction in `src/cli/index.ts`,
offline CLI construction and test fixtures must be accounted for. Choose a
constructor dependency or factory with an explicit port; avoid a hidden global
or a permissive production fallback when scan coordination is missing.

Keep `ControlService` as the public facade. A small
`src/server/modules/maintenance/` service may own deletion and explicit storage
refresh if that keeps the changed responsibility cohesive. Its public API uses
the shared lifecycle and existing adapters. It must not instantiate another
store, queue, process manager or capacity counter.

## Work sequence

1. Add deterministic regressions in `control-service-storage.test.ts` using a
   deferred cleaner. Wait for its entered signal, attempt one conflicting
   operation, assert that its observable effect cannot happen, then release
   the cleaner. Run each conflict in a separate fixture so an earlier claim
   does not accidentally block later probes. Demonstrate the failure on the
   baseline before changing production code.
2. Extend `ProjectLifecycle` with maintenance/scan ownership. Test atomic
   acquisition, pending-scan exclusion, idempotent release, error cleanup and
   project independence. Wire the same instance to storage and the facade.
3. Serialize cache deletion, preserve all current checks inside the lock, and
   acquire maintenance before awaiting the cleaner. Integrate storage permits
   into automatic, manual and post-deletion scheduling. Add EN/PL translations
   for any new user-visible errors.
4. Close maintenance admission during shutdown and drain already accepted
   lifecycle work before stopping dependencies it may use. Keep storage release
   paths working for queued scans that never start. Never wait for a project
   lock while holding a scan permit that an operation under that lock is waiting
   to drain. Test direct service shutdown as well as the normal HTTP shutdown
   order. Propagate cleanup failures.
5. Run the relevant checks, document the final API and ownership rules, and
   replace the open backlog item with a done record only after implementation
   and verification. Record any remaining limitation explicitly.

## Required regression cases

| Ordering | Expected observation |
| --- | --- |
| Deletion pauses; start/restart/switch or profile restart arrives | No process start before cleaner settlement; normal validation follows |
| Deletion pauses; claim or human reservation arrives | No reservation acquisition or claim-triggered start until deletion ends |
| Deletion pauses; test enqueue arrives | No queued record or test spawn during maintenance |
| Deletion pauses; automatic scan arrives through metadata discovery | No pending/scanning ownership and no scanner invocation for that target |
| Deletion pauses; explicit storage refresh arrives | It waits; after release it queues at most one scan |
| Scan is queued behind a different scan; deletion arrives | Deletion is refused before cleaner entry |
| Runtime, reservation or queued/running test already exists | Existing refusal remains; cleaner is never invoked |
| Cleaner rejects; operation was waiting | Exclusion releases, failure audit is recorded, later operation can progress |
| Two deletions or project removal overlap | Same-project operations serialize and revalidate current state |
| Project A deletion pauses; project B starts/enqueues/scans | B progresses subject only to existing capacity and scan limits |
| Shutdown during deferred deletion or pending scan | No post-close store access, retained permit or false successful cleanup |

Retain missing-directory, foreign/prunable worktree, symlink and non-Next.js
tests. Exercise the real facade and storage manager together for scan races;
transport tests alone with a mocked facade cannot establish mutual exclusion.
The tests use temporary fixtures and deferred promises, with no production
cache deletion and no timing-dependent sleeps.

## Verification and delivery

Use registered-project queue presets when available, otherwise supported finite
commands under host rules. Run the focused lifecycle, service-storage, storage,
runtime, agent, capacity, verification and HTTP tests, followed by `pnpm check`.
Run `pnpm build` for module/wiring changes. Verify the affected cache/storage
dashboard flow with `pnpm test:ui` and add a fixture for a new visible state if
the implementation introduces one. Run heavy verification serially.

For this planning change, run canonical backlog `fmt` and `validate`, then
`git diff --check`. Unit tests and builds do not validate a prose-only plan.

Completion requires all interleaving regressions to pass, one shared lifecycle
authority, unchanged deletion targets/privileges, bounded and released ownership
state, and no additional Git work on output-only dashboard refreshes. No schema
migration or MCP cache-delete tool is needed.

If the new exclusion fails after release, temporarily refuse cache deletion
while retaining runtime/test ownership. Do not restore racing deletion as an
automatic fallback. Service deployment is a separate lifecycle operation.
