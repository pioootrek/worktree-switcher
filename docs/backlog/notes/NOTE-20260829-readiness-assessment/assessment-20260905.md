# Working direction and assessment, 2026-09-05

Read this update first. `findings.md` retains the 2026-08-29 assessment as
history; its missing CLI/license/service claims and adoption-first advice are
not current work instructions.

## Owner direction

The owner wants this tool primarily for daily use, with less wasted time and
fewer agent tokens. The owner also explicitly reaffirmed that it must remain
reusable and that public adoption is an experiment. These are complementary
constraints: solve a real workflow, express it through portable configuration,
and keep installation simple enough for somebody else to try.

The owner authorized backlog reprioritization, new proposals, and incremental
code decomposition. This turn concerns backlog records, not implementation of
the fixes or refactors. Changes stay on `fix/verification-env-isolation` as
explicitly requested, overriding the usual main-only backlog location for this
edit. They become visible in the shared Hub only after the normal commit,
main integration, and synchronization workflow; none is implied by validation.

## Evidence and limits

The review inspected source, current documentation, and historical backlog
notes at commit `d4a2c8d`. `pnpm check` passed lint, type checking, and 131 tests
in 28 files. The managed-test MCP tools were unavailable in that session, so
the repository-approved finite command was used. No current production build,
browser QA, installed-service restart, or macOS verification was performed.

Two isolated temporary reproductions completed and were cleaned up:

- An owned launcher exited on SIGTERM while its HTTP descendant ignored the
  signal. ProcessManager reported `stopped`; HTTP still returned
  `fixture-alive`. The owned fixture process group was then killed.
- Twelve short TestJobManager jobs completed with zero queued/running jobs,
  but all twelve test-log file descriptors remained open. The writer and
  temporary SQLite/log directory were closed and removed afterward.

Static inspection established the log-to-full-dashboard-to-Git-status refresh
path. No load benchmark or token measurement was performed. Source attribution
at enqueue time and asynchronous cache deletion outside the lifecycle lock are
additional static findings; their items require deterministic reproductions.

The static Next.js export, single Node controller, SQLite service boundary,
per-project serialization, and separate finite-job manager remain appropriate.
The shell-free API and reservation checks coordinate cooperating callers; they
do not sandbox repository scripts or agents with independent shell access.

## Execution order

Keep only these urgent repairs in `now`, in this order:

1. `FIX-20260905-owned-process-tree-stop`: truthful cleanup and capacity.
2. `FIX-20260905-test-log-lifecycle`: close completed logs and bound retention.
3. `FIX-20260905-dashboard-refresh-amplification`: avoid Git work per log event.

Then choose one bounded slice at a time from `next`:

- Fix cache/lifecycle races and verification source attribution. These protect
  trust in maintenance and test results; each starts with a targeted regression.
- Add claimed MCP restart/stop and compact status/detail reads. Measure response
  bytes and calls in a fixed owner workflow before claiming token savings.
- Extract the code needed by those changes into cohesive modules. Keep one
  shared lock authority and database owner; avoid a broad rewrite.
- Complete pending integrated runtime/queue evidence and revise the historical
  absolute memory target using a measured runtime baseline and growth budget.
- Automate portable check/build/package smoke work and document a small public
  trial. The package trial remains `next`; npm publication is a separate action.
- Improve the existing LAN transport through a small supported setup. Existing
  LAN access was explicitly requested and must not be silently removed.

Implemented functions remain open only for the explicitly stated remaining
work. No record was closed merely because an older note says implementation
exists. Original item notes and finished outcomes remain intact.

## Scope and portability

One server slot per project is useful where memory and ports are shared. Keep
that default for this experiment. Simultaneous branch previews, general
orchestration, extra frameworks, accounts, and production runtime modes should
wait for a concrete need. Prior human requests stay in the backlog with their
history; moving them to `later` does not revoke them.

Use generic fixtures for every owner-specific use case. Repository paths,
ports, environment sources, and service paths come from local configuration.
Host memory guards, runner policies, and installed-service details belong in
host/project instructions, not portable skills or application special cases.
No private repository, local Hub checkout, or owner credential should be
required to install, build, or run the public experiment.

The first external experiment is deliberately small: can another developer
install the package, register a repository, and use it with their existing
agent client using the docs? Record setup friction and useful feedback when
available. Recruiting five users, marketing work, and proving a business are
not gates for the owner's next useful change.

## Proposals held for evidence

These ideas remain proposals rather than more immediate feature tickets:

- A cancellable wait queue for server claims, if conflict/retry logs show
  repeated contention. It must reauthorize ownership and capacity when admitted,
  expire abandoned waiters, and never preempt a human or another agent.
- A local efficiency summary using existing audit/run data: conflicts, queue
  wait, redundant retries, and observed resource use. Start with an export or
  query; avoid adding telemetry or analytics infrastructure. Actual token usage
  requires client instrumentation and cannot be inferred from a server counter.
- A loopback default for new installations, while preserving explicitly chosen
  LAN settings. Decide this alongside the transport recipe; the assessment is
  not authorization to alter the current service.

Existing alternatives already include worktree lifecycle hooks and parallel
agent workspaces. These are context, not a requirement to compete on every
feature: [Worktrunk hooks](https://worktrunk.dev/hook/) and
[Conductor parallel agents](https://www.conductor.build/docs/concepts/parallel-agents).
The experiment should test the narrower usefulness of shared runtime ownership,
bounded verification, and low-overhead integration with existing agent clients.
