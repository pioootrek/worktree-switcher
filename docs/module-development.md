---
audience: "contributors developing and testing application modules"
last_reviewed: "2026-09-07"
source_of_truth: "implemented module entry points and focused verification workflow"
status: "active"
---

# Developing a module

The controller still has one process and one database owner. `ControlService`
is the compatibility facade used by HTTP, MCP, and CLI. It constructs and
connects the application modules; existing constructor arguments remain valid.

## Where to change a workflow

| Change | Application code | Browser code | Focused verification |
| --- | --- | --- | --- |
| Server environment profiles and restart policy | `src/server/modules/environments/` | `src/features/environments/` | `pnpm test src/server/modules/environments` |
| Test environment filtering and preset assignment | `src/server/modules/environments/` and `verification/` | `src/features/verification/` | `pnpm test src/server/modules/environments src/server/test-job-manager.test.ts` |
| Runtime start/stop/switch or TLS | `src/server/modules/runtime/` and shared `lifecycle/` | `src/features/runtime/` and project-card composition | `pnpm test src/server/control-service-capacity.test.ts src/server/control-service-agent.test.ts src/server/modules/lifecycle` |
| Test-run SQL or storage history | `src/server/infrastructure/sqlite/test-run-queries.ts` or `storage-queries.ts` | Owning feature, if payload presentation changes | `pnpm test src/server/infrastructure/sqlite` |
| Schema upgrade | `src/server/infrastructure/sqlite/migrations.ts` | None | `pnpm test src/server/infrastructure/sqlite` |
| Session, event subscription, dashboard refresh | `src/features/dashboard/use-dashboard.ts` | `src/features/dashboard/dashboard.tsx` | `pnpm build` followed by `pnpm test:ui` |

These are entry points, not claims that a change can ignore its callers.
Cross-workflow behavior still needs the relevant integration tests.
No token savings have been measured.

## Application seams

Each server module exposes an `index.ts`; cross-module imports use that API.
Modules accept narrow structural dependencies, including `Pick<StateStore, ...>`
and execution ports, so a test can provide only the methods the workflow needs.
The modules do not instantiate a database, process manager, queue, or lock map.
`ProjectLifecycle` owns the sole project lock map and pending-start capacity set.

Runtime operations and environment changes share this lifecycle instance with
verification admission and the facade's project/reservation operations.
A profile restart calls `operateLocked` while already holding the project lock.
It does not reacquire that lock. Capacity remains held across the stop and start.

`SqliteStateStore` opens one connection, runs the unchanged schema initialization
and migrations, and lends the connection to query helpers. Helpers do not close
it. Reservation and profile transactions stay with the owner; storage retention
keeps its existing transaction. `src/server/sqlite-store.ts` remains a compatible
public entry point. SQL mapping types are internal persistence records.

## Verification commands

Use managed verification presets when available, as required by the root guide.
The supported finite commands are:

- `pnpm test:modules`: extracted application/persistence tests and import-boundary checks.
- `pnpm test <path>`: one module or an existing integration test.
- `pnpm check`: lint, TypeScript, and all Vitest tests, including architecture checks.
- `pnpm build`: the static dashboard export and controller bundle.
- `pnpm test:ui`: Chromium checks against the already built `out/` directory.

Install the browser once with `pnpm exec playwright install chromium` if it is
not available. Rebuild after UI changes before running `test:ui`; the command
uses the existing export and does not rebuild it. Browser verification uses one
worker and no automatic retries. Failures retain traces and screenshots in the
ignored `test-results/` directory.

The UI suite intercepts requests to a fixture origin and serves the exported
files directly inside Chromium. It opens no HTTP listener, takes no server
claim, and uses no real project, session token, or controller database. It
checks rendered components, translated labels, mutation payloads, draft settings,
dialog focus restoration, test output, and one active event subscription.
It does not verify a live SSE transport, real Git discovery, process lifecycle,
or a live dashboard/controller integration. At a 390-pixel viewport the header
toolbar still extends beyond the viewport; these interaction checks are not a
responsive-layout acceptance test. Existing HTTP/MCP and service tests
cover those boundaries; a live managed-server test needs a separate claim.

`src/architecture.test.ts` resolves both relative and `@/` imports. It rejects
server/CLI/Node/SQLite dependencies in browser code and shared contracts,
feature imports in reusable UI, cross-module access to server internals, and
cycles in local imports, including type-only imports.

## Deliberately remaining work

The facade still owns project registration/removal, reservation and claim
operations, dashboard snapshot assembly, cache maintenance, and controller
shutdown. HTTP/MCP adapters and bootstrap retain their existing locations.
Extract these when their next workflow needs it, using the same lifecycle.

In particular, asynchronous cache deletion already lacks lifecycle serialization;
its race is tracked separately as `FIX-20260905-cache-lifecycle-serialization`.
This extraction preserves that behavior and does not present it as fixed.
Likewise the existing log-event/full-dashboard refresh behavior is unchanged;
feature extraction introduces no additional subscriptions or refresh policy.
