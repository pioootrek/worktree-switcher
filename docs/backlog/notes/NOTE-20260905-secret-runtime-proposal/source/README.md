# Secret Runtime Project

Working title for an open-source, self-hostable and hosted developer secrets platform focused on environment synchronization, credential lifecycle, runtime injection, auditability and AI-native workflows.

## Product thesis

Secure secret handling wins when it is easier than insecure secret handling.

The product should replace the common workflow of copying plaintext `.env` files with a developer-first runtime that keeps environments synchronized, tracks expiry and drift, injects secrets only when needed, and exposes the same control plane through Web UI, CLI, API and MCP.

## Initial positioning

Not another generic vault.

The primary problem is keeping application environments and credentials in a known, synchronized and auditable state across local development, CI, preview, staging and production.

AI agents are first-class principals. They should be able to use approved runtime capabilities without receiving broad, persistent access to every secret in a project's `.env` file.

## Initial docs

- `docs/product/vision.md` — product vision and problem statement
- `docs/product/mvp.md` — first practical MVP
- `docs/product/architecture.md` — initial architecture direction
- `docs/product/security.md` — security principles and trust model
- `docs/product/competition.md` — competitive framing
- `docs/product/open-questions.md` — unresolved product and architecture questions
- `docs/backlog/` — llm-ops compatible backlog


## Current roadmap

1. M1 — Secure Core
2. M2 — Runtime Secrets / replace `.env`
3. M3 — Pluggable Target Sync + Vercel
4. M4 — Lifecycle, expiry & drift
5. M5 — MCP / AI-native access
6. M6 — Provider-managed rotation
