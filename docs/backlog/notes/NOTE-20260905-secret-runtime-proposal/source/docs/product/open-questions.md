---
audience: "product and architecture agents resolving early design decisions"
last_reviewed: "2026-09-03"
source_of_truth: "unresolved questions from initial product discussion"
status: "active"
---

# Open questions

## Product

- Is the first target solo developers/small teams, or organizations with centralized platform/security ownership?
- Is the first marketing wedge `.env replacement`, environment synchronization, or AI-safe credentials?
- What is the smallest workflow that is substantially better than Infisical rather than merely similar?
- Which two integrations beyond local runtime should be first? Current assumption: Vercel and GitHub.

## Environment semantics

- Are environment values normally independent credentials or shared versions promoted between environments?
- How should intentional differences be distinguished from stale synchronization?
- Should production be pinned by default rather than automatically following lower environments?

## Cryptography and trust

- Can the hosted service ever decrypt a secret?
- If not, how are unattended provider syncs implemented?
- Should there be explicit client-only and server-sync secret classes?
- How are project keys shared with new users and revoked from removed users/devices?
- What is the device recovery model after losing all trusted devices?

## Local runtime

- Background daemon versus ephemeral CLI process?
- Default unlock lifetime?
- OS-specific secure storage support required for v1?
- How should process identity and runtime profiles be represented?
- Can a child process request additional capabilities after startup?

## MCP and agents

- Which tools are safe enough to expose by default?
- Should raw secret retrieval exist at all over MCP?
- How are agent sessions identified distinctly from the human who launched them?
- How are human approvals represented for temporary elevated access?
- How are prompt-injection-driven credential operations constrained?

## Synchronization

- Is the source of truth always this system?
- Is importing from a destination a one-time migration feature or an ongoing two-way sync?
- How is drift detected where provider APIs cannot return secret values?
- How are partial failures represented when one of several destinations fails?
- Should sync be transactional, best-effort or eventually consistent?

## Lifecycle

- Distinguish metadata expiry from actual provider credential expiry.
- Define how warning windows work.
- Define what "expired" means for local runtime and already-synchronized destinations.
- Decide when automatic rotation enters scope.
