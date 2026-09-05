---
audience: "engineering agents designing the implementation"
last_reviewed: "2026-09-03"
source_of_truth: "initial architecture discussion"
status: "active"
---

# Initial architecture

## Components

```text
                         Web UI
                           |
                           v
                    Control Plane API
                           |
             +-------------+-------------+
             |             |             |
             v             v             v
            CLI           MCP           SDK/API
             \             |             /
              +------------+------------+
                           |
                      Local Agent
                           |
              +------------+------------+
              |            |            |
              v            v            v
          Dev process     Vercel       GitHub
```

## Control plane

Responsibilities:

- users and devices;
- projects and environments;
- encrypted secret storage;
- secret metadata and versions;
- access policy;
- destination configuration;
- synchronization state;
- expiry state;
- audit events.

The hosted and self-hosted products should use the same core control-plane implementation wherever practical.


## Authentication and authorization

Authentication must not depend on the hosted service. Hosted and self-hosted
installations use the same application-owned identity model backed by the
control-plane PostgreSQL database.

### Human authentication

- **Default engine:** Better Auth embedded in the Next.js control plane.
- **Hosted:** local account/passkey and selected social/OIDC providers may be
  enabled as product configuration.
- **Self-hosted:** must work with a local account/passkey and no dependency on
  Kinde or another hosted identity vendor.
- **Enterprise/self-hosted federation:** generic OIDC is the preferred extension
  point for Entra ID, Okta, Keycloak, Authentik and similar identity providers.
- SAML/SCIM are deferred until an actual enterprise requirement justifies them.

The authentication provider answers **who the human is**. Project, environment,
secret, device and agent permissions remain application-owned authorization
state in PostgreSQL; they must not be coupled to Better Auth/Kinde/provider
role models.

### Device identity

CLI access uses a separate device identity rather than a long-lived bearer token
stored in the project. On first authorization the local Rust client generates a
device keypair, stores private material in the OS-native credential/key store,
and registers the public identity with the control plane. Browser/device
authorization links that device to the authenticated human.

A device can therefore be listed, audited and revoked independently of the
human account. Short-lived server sessions/grants should be issued to the
authorized device rather than persisting a reusable plaintext API token.

### Vault unlock is separate from login

Authentication and decryption authorization are separate concerns:

```text
sec login   -> establish human + device identity
sec unlock  -> unlock local cryptographic material for a bounded session
sec run     -> use the already-authorized/unlocked session where valid
```

The exact key hierarchy remains a crypto-design decision, but the architecture
must preserve the ability to require a local passphrase/platform authentication
without making that passphrase the web-login credential.

### Self-hosting invariant

A minimal self-hosted deployment must be able to run as:

```text
application + PostgreSQL
```

with local authentication enabled. External OIDC, social login and hosted SaaS
services are optional integrations, not runtime dependencies.

## Local agent

The local agent is preferred over repeatedly materializing `.env` files.

Responsibilities:

- authenticate the local user/device;
- maintain a bounded unlocked session;
- retrieve encrypted material;
- decrypt locally where the trust model requires it;
- evaluate or enforce local runtime constraints;
- spawn child processes with selected environment variables;
- release in-memory material when the session/process ends;
- report auditable events to the control plane.

A lightweight `npx` package may be the installation and UX entrypoint while delegating runtime work to the local agent.

## Runtime profiles

Projects should be able to define profiles so a process does not automatically receive every secret.

Example:

```yaml
profiles:
  app:
    - DATABASE_URL
    - AUTH_SECRET
    - OPENAI_API_KEY

  tests:
    - TEST_DATABASE_URL

  coding-agent:
    - TEST_DATABASE_URL
```

Profiles are part of the path toward least privilege for AI agents and local tooling.

## Desired state and sync targets

For each secret/environment combination, the control plane should distinguish the source version from target state.

```text
source version v18
   |
   +-- local runtime       v18 current
   +-- Vercel preview      v18 current
   +-- GitHub Actions      v17 stale
   +-- production          v16 pinned
```

A destination may be synchronized automatically, manually or intentionally pinned.

## Drift

Where destination APIs expose enough metadata, compare expected state with observed state.

A target modified outside the system should become `unknown` or `drifted`, not silently treated as synchronized.

Not all providers allow secret values to be read back. Drift detection therefore must not assume value comparison is always possible.

## Encryption direction

The desired security property is that persistent server-side compromise should not trivially reveal plaintext secret values.

Candidate model:

- secret values encrypted with project/environment data keys;
- data keys wrapped for authorized users/devices or a controlled server-side integration capability;
- local device-bound material kept in OS secure storage where possible;
- human unlock material not persisted as plaintext;
- unlocked key material held only in memory for a bounded session.

This is an architecture direction, not a finalized cryptographic protocol.

## Server-side synchronization trade-off

Strong client-side encryption conflicts with unattended server-side Vercel/GitHub synchronization because the server may need plaintext to push a secret to a provider.

Potential modes:

1. local sync only — strongest zero-knowledge story, requires an active trusted client;
2. server-capable sync — a narrowly scoped integration key path permits unattended synchronization;
3. hybrid — selected secrets/destinations opt into server-side decrypt capability while others remain client-only.

This decision must be explicit in the product rather than hidden behind implementation details.

## Milestone 1 architecture boundary

Milestone 1 intentionally implements only the shortest useful path from a
central secret store to a local development process:

```text
Web UI
  |
  v
Next.js control plane
  |
  +-- PostgreSQL
  |
  v
HTTPS API
  |
  v
Rust local binary
  |
  +-- bounded authenticated/unlocked session
  |
  v
spawn child process + inject environment
  |
  v
npm run dev / next dev
```

The first milestone must not require a persistent plaintext `.env` file at any
point in the normal workflow.

### Proposed implementation stack for M1

- **Control plane:** Next.js + TypeScript.
- **Authentication:** Better Auth backed by PostgreSQL; local account/passkey must work in self-hosted mode, with generic OIDC as an optional federation path.
- **Authorization:** application-owned project/environment/device permissions in PostgreSQL, independent of the configured identity provider.
- **Database:** PostgreSQL only, accessed through Drizzle.
- **Local client:** one Rust binary; initially CLI-first, with internal boundaries
  that can later host a resident agent/daemon and MCP server.
- **Transport:** authenticated HTTPS/JSON between local client and control plane.
- **Local credential storage:** OS-native credential/key store where available;
  no long-lived plaintext API token in the project tree.
- **Runtime delivery:** the Rust process spawns the requested child process with
  the selected variables added to its environment.

### M1 domain model

The minimum server-side model is deliberately small:

```text
User
IdentityAccount/Session
Device
Project
Environment
Secret
SecretVersion
AccessGrant
AuditEvent
```

`SecretVersion` exists from the beginning even though full lifecycle management
is deferred. This prevents the M1 schema from baking in a single mutable secret
value and gives later synchronization/expiry work a stable identity to build on.

### M1 request flow

```text
sec run -- npm run dev
  |
  +-- resolve project (explicit config/project id)
  +-- resolve environment (development by default or explicit)
  +-- verify/refresh bounded session
  +-- request current secret set
  +-- decrypt at the selected trust boundary
  +-- create runtime audit event
  +-- spawn npm run dev with injected environment
  +-- wait/forward signals
  +-- record runtime stop/failure
```

The exact cryptographic envelope is not finalized by this milestone, but M1
must avoid architecture that requires plaintext secret persistence on the local
filesystem.

### Explicitly out of scope for M1

The following are later milestones even if the architecture leaves extension
points for them:

- Vercel and GitHub synchronization;
- desired-state reconciliation and drift detection;
- credential expiry warnings and automated rotation;
- teams, advanced RBAC and per-secret agent policy;
- MCP tools and AI-agent principals;
- dynamic provider credentials;
- Kubernetes, Vault/OpenBao compatibility and enterprise identity features;
- offline grants beyond whatever minimal session behavior is necessary for a
  smooth local restart workflow.

### M1 product test

The milestone succeeds only if a real project can delete its local `.env.local`
and the developer prefers the replacement workflow rather than tolerating it.
The primary demo is intentionally simple:

```text
git clone <sample-app>
sec login
sec run -- npm run dev

✓ project resolved
✓ development secrets loaded
✓ runtime audit recorded
▲ Next.js ready
```

The project directory should contain no plaintext secret file before, during or
after the run.

## Milestone roadmap

The architecture is intentionally delivered in layers. Later capabilities must build on the same domain model instead of creating parallel provider-specific paths.

```text
M1 — Replace .env
     central secret store -> sec run -> process environment

M2 — Pluggable target synchronization
     SyncBinding -> reconciliation engine -> Target Plugin Contract
                                             -> Vercel first

M3 — Lifecycle, expiry and drift
     versions + observed/desired state + expiry + operational visibility

M4 — MCP / AI-native access
     agents become attributable principals and request scoped runtime capabilities

M5 — Provider-managed rotation
     create credential -> distribute -> verify -> revoke old credential
```

### M2 plugin boundary

External targets are extension points, not core special cases. The core owns desired state, reconciliation, retry, audit and generic binding state. A target plugin owns provider authentication, provider API calls, scope/environment mapping and capability reporting. M2 ships first-party plugins bundled with the product; arbitrary third-party plugin execution is deferred because plugins may handle plaintext secret material.

### M3 lifecycle boundary

Drift detection is capability-based. Providers that cannot expose value or useful metadata must produce `unknown`/unverifiable state rather than a false `synced` assertion. Expiry metadata and local version lifecycle are separate from provider-managed rotation.

### M4 AI boundary

MCP is built over the same domain services as CLI/Web. The primary AI flow is to request or start an authorized runtime/capability, not to retrieve a plaintext bulk secret set. Agent identity and every action should be auditable.

### M5 rotation boundary

True rotation is provider-specific lifecycle automation, not merely changing the value stored in the control plane. A safe rotation workflow is a state machine with at least `create -> distribute -> verify -> revoke`. The previous credential remains available until the new credential has been propagated and verified; unsupported providers fail closed into manual handling.


## Roadmap split — 2026-09-03

This section supersedes earlier milestone numbering in this document.

```text
M1 — Secure Core
     PostgreSQL/Drizzle + Better Auth + authorization + secret/version model
     + crypto/key-envelope foundation + device identity + audit + Rust CLI bootstrap

M2 — Runtime Secrets
     replace .env: central secret store -> sec run -> process environment

M3 — Target Sync
     pluggable target contract + reconciliation engine + Vercel first

M4 — Lifecycle
     expiry + desired/observed state + drift + operational visibility

M5 — AI Access
     MCP + attributable agent principals + scoped runtime capabilities

M6 — Rotation
     provider-managed create -> distribute -> verify -> revoke workflow
```

M1 is deliberately platform-only. The first user-facing `.env` replacement belongs to M2. Later milestones must build on the same core rather than introduce parallel identity, storage, audit, or provider-specific paths.
