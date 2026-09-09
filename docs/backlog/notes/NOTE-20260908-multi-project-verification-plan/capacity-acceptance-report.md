# Server capacity acceptance report

Tested implementation: `32e0a19769c7ed7c524837d19e2f00a352de43b7`

Date: 2026-09-09

Environment: Linux 7.0.0-30-generic x86_64, Node.js v24.19.0, pnpm 11.22.0

## Evidence boundary

The integration suite launched the built `dist/cli/index.js` as a foreground,
service-mode controller with private temporary data/state directories, real
SQLite, three real Git repositories and worktrees, loopback HTTP and MCP
listeners, and dependency-free owned Node servers. It did not access or restart
the installed user service. The earlier compact/full cleanup regressions use
controlled process adapters; C1-C7 below use real transports and processes.

## Capacity matrix

| Case | Result | Evidence |
| --- | --- | --- |
| C1 exhaustion | passed | HTTP rejected project C at limit two. MCP retained C's claim while reporting `capacity_exhausted`; the claim was explicitly released. A/B boot identities did not change and C did not listen. |
| C2 last slot | passed | Both HTTP-first and MCP-first gated starts occupied the last slot before the competing transport arrived. Exactly one candidate started and observed usage never exceeded two. |
| C3 switch/restart | passed | A switched to its alternate real worktree and restarted on its stable port while retaining one slot. C remained rejected and B retained its boot identity. |
| C4 startup failures | passed | Early launcher exit and a real 45-second HTTP-503 readiness timeout both completed owned cleanup, closed the listener, reduced usage to zero once, and allowed B to start. The timeout process ignored SIGTERM so cleanup exercised escalation. |
| C5 lowering/persistence | passed | Lowering two-to-one left A/B and their boot identities live with `used=2`, `available=0`. Graceful controller restart retained enabled/limit settings while truthfully reporting old runtimes stopped. Disabled and re-enabled capacity were checked. |
| C6 unrelated owner | passed | A fixture-owned unrelated listener caused managed start failure, remained responsive, and consumed no capacity. Only the test owner closed it. |
| C7 shutdown | passed | Graceful controller shutdown closed all owned project listeners. Fixture cleanup treats non-zero controller exit or a listener surviving the deadline as test failure. |

Full HTTP capacity and compact/MCP capacity were compared at stable barriers.
PR #19 separately established compact/full agreement after unconfirmed cleanup,
successful cleanup retry, slot reuse, snapshot-only fallback and bounded compact
reads without public ownership-field leakage.

## Browser and commands

The real Playwright capacity scenario used the controller's actual static UI,
HTTP API and SSE session. It configured limit two, started A/B, displayed the
blocked C error, freed A's slot, started C, lowered the limit to one and verified
that B/C remained live with `2/1` usage. Traces were disabled; no pairing URL,
browser storage, SQLite file or MCP token was retained.

- `pnpm check`: passed ESLint, TypeScript and 237 tests in 40 files.
- `pnpm build`: passed static Next.js export, CLI bundle and build fingerprint.
- `pnpm test:integration`: passed 11 tests in 2 files, including C1-C7 and cleanup-helper regressions; 71.18 s.
- `pnpm test:ui`: passed 5 fixture UI tests; 14.0 s.
- `pnpm test:e2e`: passed 2 real-controller browser tests; 7.9 s.
- `git diff --check`: passed.

All runs were sequential. No emergency controller termination or leftover owned
listener was observed. CI now runs check, build, integration, UI and E2E in that
order before packaging; clean-consumer package smoke remains a separate job.

## Remaining scope

`FEAT-20260829-multi-project-worktree-switching` remains open. Its remaining
reservation/failure/dirty-keyboard browser paths, resource measurements and
owner-workflow observation are not claimed by this capacity acceptance.
