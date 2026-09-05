---
audience: "engineering agents planning the first implementation"
last_reviewed: "2026-09-03"
source_of_truth: "initial MVP discussion"
status: "active"
---

# MVP

## Goal

Prove that secure secret handling can be materially easier than plaintext `.env` management while solving the immediate synchronization and lifecycle pain.

## MVP capabilities

### Projects and environments

Support projects with at least:

- development;
- preview;
- staging;
- production.

Each project contains secret definitions and environment-specific values.

### Secret metadata and versions

Track at minimum:

- name;
- environment;
- version;
- created timestamp;
- updated timestamp;
- optional expiry timestamp;
- owner;
- status;
- sync targets;
- last successful synchronization.


### Authentication and device authorization

Use Better Auth in the control plane with PostgreSQL persistence. M1 must support
a local account or passkey without requiring a third-party hosted identity
service so the same code path is viable for self-hosting. Generic OIDC is an
optional/future federation path rather than an M1 dependency.

The Rust client should authorize through a browser/device flow, register a
device identity, and keep device private material in the OS-native secure
credential store. Product authorization (project/environment/device access)
remains separate from identity-provider roles.

### Local runtime

Provide a CLI workflow such as:

```bash
sec run -- npm run dev
```

The CLI or local agent obtains and decrypts approved secret values and injects them into the child process environment.

The initial design should avoid writing plaintext `.env` files to disk.

### Local unlock

Support a user-controlled unlock mechanism with a bounded session lifetime.

Initial concept:

```text
master password / platform authentication
            +
local device-bound material
            ->
local unlock key
```

An unlocked local agent may keep session key material in memory for a configurable period such as 8 or 24 hours. Exact cryptographic design is intentionally not fixed by this document.

### Synchronization

Initial destinations:

- Vercel environment variables;
- GitHub Actions secrets.

The system records desired version and synchronization state per target.

Example:

```text
DATABASE_URL

local-dev         v12 current
vercel-preview    v12 current
vercel-production v10 pinned
github-actions    v11 stale
```

### Expiry

Allow credentials to carry expiry metadata and show:

- valid;
- expiring soon;
- expired.

MVP does not need to rotate provider credentials automatically. Distribution of a new version and automatic provider-side credential creation are separate concerns.

### Audit

Record at minimum:

- secret created/updated/deleted;
- secret metadata viewed;
- runtime started/stopped;
- secret set injected into runtime;
- sync attempted/succeeded/failed;
- permission granted/revoked;
- device registered/revoked;
- unlock success/failure;
- MCP/agent action with principal identity where available.

Never include secret plaintext in the audit log.

### Interfaces

MVP should expose the same core capabilities through:

- Web UI;
- CLI;
- MCP;
- HTTP API used by those interfaces.

### MCP

MCP is first-class in this project.

Initial MCP tools should focus on lifecycle and runtime operations, for example:

```text
projects.list
environments.status
credentials.expiring
credentials.metadata
runtime.start
runtime.stop
access.request
sync.status
sync.run
audit.query
```

Avoid making raw secret retrieval the primary MCP workflow.

## Explicit non-goals for first MVP

- Kubernetes operator;
- PKI;
- dynamic AWS credentials;
- automatic rotation for many providers;
- SCIM;
- complex enterprise SSO;
- complete Vault compatibility;
- arbitrary credential proxying;
- support for dozens of sync integrations.

## Delivery milestones

The product vision is broader than the first implementation. Delivery is deliberately staged:

1. **M1 — Replace `.env`:** Web/control plane + PostgreSQL + Better Auth + device authorization + local Rust `sec run`; no plaintext `.env` persistence and no required hosted auth dependency.
2. **M2 — Pluggable target sync:** introduce the target-plugin contract and ship Vercel as the first first-party plugin.
3. **M3 — Lifecycle, expiry and drift:** version lifecycle, desired/observed target state, expiry warnings, drift/unknown states and richer audit.
4. **M4 — MCP / AI-native access:** attributable agent principals, MCP lifecycle/status/runtime tools and scoped capability-based access.
5. **M5 — Provider-managed rotation:** provider-specific create/distribute/verify/revoke workflows with rollback and audit.

Features described elsewhere in this document are product-level MVP direction; the milestone backlog is authoritative for implementation order and scope boundaries.


## Updated milestone split — authoritative

1. **M1 — Secure Core:** PostgreSQL/Drizzle, Better Auth, application authorization, secret/version model, crypto/key-envelope foundation, device identity, audit, Rust CLI bootstrap.
2. **M2 — Runtime Secrets:** `sec run -- <command>` replaces persistent plaintext `.env`.
3. **M3 — Target Sync:** plugin contract + reconciliation + Vercel first.
4. **M4 — Lifecycle:** expiry, desired/observed state and drift.
5. **M5 — AI Access:** MCP, agent principals and scoped runtime capabilities.
6. **M6 — Rotation:** provider-managed create/distribute/verify/revoke.

This numbering supersedes the earlier delivery-milestone list above.
