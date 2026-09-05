---
audience: "engineering and product agents working on the secret runtime project"
last_reviewed: "2026-09-03"
source_of_truth: "product discussion captured on 2026-09-03"
status: "active"
---

# Product vision

## Problem

Secret management in development is often secure in theory but inconvenient in practice. When the secure path is cumbersome, developers fall back to plaintext `.env` files, copied credentials, stale local values and manual synchronization across tools.

The pain is broader than storage. Teams routinely struggle with:

- keeping development, preview, staging, production and CI credentials synchronized;
- knowing which destination has which version of a credential;
- expiry, renewal and rotation visibility;
- stale credentials after a change;
- onboarding new developers without sending `.env` files around;
- knowing who or what used a credential;
- removing access when a device, user, agent or environment should no longer have it;
- preventing AI agents and local tooling from receiving broad secret sets they do not need.

Local plaintext `.env` files are especially unattractive on modern developer systems because those systems routinely run IDE extensions, package lifecycle scripts, MCP servers, AI agents and other third-party tooling. A simpler secure runtime can reduce persistence and unnecessary exposure without making development harder.

## Thesis

**Secrets should be easier to use securely than insecurely.**

The product should make the default workflow easier than managing `.env` files manually.

A good developer experience looks approximately like:

```text
git clone
npm install
npm run dev

✓ authenticated
✓ project recognized
✓ required development secrets available
✓ secrets injected into runtime
✓ destinations synchronized
✓ expiry warnings shown
```

No copying values from password managers. No shared plaintext `.env`. No manual push to multiple destinations after every change.

## Product category

The product is not primarily a generic secrets vault.

The stronger framing is an **environment and credential lifecycle manager** with a **developer secret runtime**.

Its source of value is a combination of:

- desired-state management for secrets and environments;
- synchronization to destinations such as Vercel and GitHub;
- local runtime injection without persistent plaintext `.env` files;
- expiry and lifecycle controls;
- drift detection;
- auditability;
- CLI-first ergonomics;
- first-class MCP and agent workflows;
- open-source and self-hostable deployment, with an optional hosted control plane.

## Core mental model

The primary product object is not just a secret value. It is the relationship between:

```text
project
  + environment
  + credential version
  + consumer
  + destination
  + lifecycle policy
```

For example:

```text
OPENAI_API_KEY

Development   v7  synced
Preview       v7  synced
Staging       v6  stale
Production    v5  intentionally pinned

expires: 2026-10-01
owner: platform-team
consumers: local-runtime, github-ci, vercel-preview
```

This makes synchronization state, drift and expiry visible as first-class concepts.

## AI-native principle

Humans, CI jobs, development servers and AI agents should all be modeled as principals or consumers with explicit capabilities.

An agent should not automatically receive the equivalent of `cat .env` simply because it needs to run tests.

The preferred workflow is closer to:

```text
agent -> MCP -> local runtime broker -> policy -> spawn process with approved secrets
```

The MCP surface should favor operations such as:

- inspect environment status;
- list available secret names and metadata;
- start a runtime with an approved profile;
- request temporary access;
- inspect expiry and drift;
- synchronize an environment;
- query audit history.

A raw `get_secret_value` capability should not be the default agent interface.

## Open-source and trust

The product should be usable without trusting a hosted vendor. The core should be open source and self-hostable.

Hosted service should be a convenience layer, not a prerequisite.
