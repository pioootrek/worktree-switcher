---
audience: "owner, contributors, and coding agents"
last_reviewed: "2026-09-05"
source_of_truth: "preliminary architecture impact and effort assessment for the planned operations-hub direction"
status: "reference"
---

# Architecture impact and preliminary effort estimate

## Basis and confidence

The owner requested preservation of this assessment after planning remote
verification, shared memory, agent coordination, and environment runtime
integration. It reflects source inspection at commit `eba0c79` and the scope
discussed on 2026-09-05. It is a planning estimate, not a delivery commitment,
measured implementation velocity, or evidence that the features exist.

The full direction needs substantial architectural expansion, especially the
transition from one local controller to a control plane and independently
connected workers. It does not require discarding the existing application.
Current process management, test queue, command adapters, SQLite persistence,
HTTP/MCP boundaries, and static dashboard provide reusable foundations.

Confidence is higher in the identified boundaries than in calendar estimates.
Remote recovery, identity/authorization, and secret handling have the greatest
uncertainty. No new load benchmark or implementation spike was performed for
this estimate. Re-estimate after the first working remote execution slice.

## Changes to existing architecture

### Separate project identity from machine registration

The current `Project` in `src/shared/contracts.ts` requires repository path,
port, and launch configuration. Separate durable project identity from its
registration on each worker. Knowledge and history must survive disconnecting
a machine or unregistering a runtime. Preserve compatibility through explicit
migrations rather than making existing local projects disappear.

### Separate submitted work from local execution

`src/server/test-job-manager.ts` directly spawns processes and retains active
executions in memory. Introduce distinct request, execution attempt, worker,
and reported-state contracts. Retain the current manager as a local executor
where practical. A network failure requires reconciliation, not the existing
assumption that a local controller restart settles all execution state.

### Establish durable principals and authorization

Local pairing and MCP session ownership are insufficient for hosted customer
accounts, workers, agents, and environment access. Define these boundaries
before expanding write access. Project-memory access and permission to execute
credentialed code remain separate. The exact account/provider implementation
and hosted tenancy model are still design decisions.

### Extract cohesive services and UI modules incrementally

At the inspected revision, `dashboard.tsx` is approximately 1,300 lines,
`sqlite-store.ts` 1,050, and `control-service.ts` 800. These sizes are context,
not independent reasons to rewrite. Avoid placing all knowledge, remote
execution, and credential use cases in those same modules. Extract the pieces
needed by each delivered slice while retaining one authority for each local
runtime lock and database operation.

## Indicative effort by scope

One person-day means a focused working day by an experienced engineer using
agent assistance, including implementation, appropriate tests, and corrections.
It is not autonomous model runtime. Ranges assume bounded first versions,
reuse of current code, and no major change in product scope.

| Scope | Architectural impact | Indicative person-days |
| --- | --- | --- |
| Project/runtime separation and initial module extraction | Medium | 5–10 |
| Remote verification on one owner-controlled worker, exact SHA and recovery | Large | 15–30 |
| Basic memory, threads, backlog, search, and export | Medium | 15–25 |
| Playbooks and repository instruction inspection | Small to medium | 5–12 |
| Instruction generation from approved rules | Medium | 5–10 |
| Assignments, inboxes, and accepted handovers | Medium to large | 10–20 |
| Scoped process-secret delivery from one existing source | Medium to large | 8–15 |
| Public SaaS accounts, tenant isolation, billing, quotas, backup/recovery | Large | 25–50 additional |

The ranges share foundations and cannot be added mechanically. Integration,
migration, reliability work, and operational readiness also consume time.
Backend functionality and a convincing happy-path demonstration do not imply
that the corresponding public service is ready.

Excluded from these estimates: a new central vault/cryptographic protocol,
operator-hosted untrusted-code execution, broad provider rotation, automatic
support for many LLM clients, and an autonomous fleet scheduler. These require
separate designs and estimates. Multi-OS support or enterprise requirements
can materially increase effort.

## Calendar planning envelopes

The discussion used these rough targets for focused work:

- First useful remote worker: 3–6 weeks for a narrow owner workflow.
- Useful owner system with remote tests, basic memory, and handover: 2–4 months.
- Coherent small SaaS with most discussed modules: 4–8 months, excluding a
  proprietary vault and execution of unrelated customers' code.

These are planning envelopes, not sums of table rows or promised completion
dates. The first range assumes enabling refactors can be performed inside the
remote slice and urgent blockers are resolved; separate foundation work may
push it later. Part-time availability, external integration problems, broader
support requirements, and failed recovery experiments also extend delivery.
Agent assistance can accelerate coding, but does not eliminate verification
of reconnects, cancellation, access revocation, migrations, and restore.

## Recommended first investment

Start after urgent runtime reliability fixes with one end-to-end path:

```text
MCP request for exact SHA
  -> authorized remote worker
  -> configured verification preset
  -> durable result
  -> correct reconciliation after connection loss
```

Extract project, worker, request, and executor contracts as this path needs
them. Keep existing local verification working against compatible contracts.
Then add shared memory and cooperation using the actual run evidence. The
minimum credential adapter can follow when a real test requires it; a complete
secret platform is not a prerequisite.

TypeScript, the current dashboard approach, and SQLite on workers can remain.
PostgreSQL for hosting, a Rust helper, a message broker, or microservices are
options to justify against concrete constraints, not automatic prerequisites.
Prefer explicit module and protocol boundaries before adding infrastructure.

After the first slice, record actual engineering time, integration friction,
and failure-path results. Revise the estimates against that evidence before
committing to a public launch schedule.

## Related plans

- [Remote verification](remote-verification-plan.md)
- [Shared project memory](shared-project-memory-plan.md)
- [Fleet coordination](agent-fleet-coordination-plan.md)
- [Environment runtime](environment-runtime-plan.md)
