---
audience: "security and engineering agents working on trust boundaries"
last_reviewed: "2026-09-03"
source_of_truth: "security principles from initial product discussion"
status: "active"
---

# Security principles

## Principle 1: secure must be easier

Security controls that developers routinely bypass are ineffective product design.

The project should minimize extra steps compared with `.env` files and make the secure workflow the fastest normal workflow.

## Principle 2: no persistent plaintext by default

Local runtime injection should not require a plaintext `.env` file that survives process exit or machine reboot.

This reduces exposure to:

- accidental commits;
- backup and sync tooling;
- IDE extensions;
- MCP servers;
- AI coding agents;
- package lifecycle scripts;
- unrelated local tooling;
- some classes of supply-chain compromise.

This does not make runtime secrets invisible. Malicious code running with sufficient access to the process can still read environment variables. The product must not claim otherwise.

## Principle 3: minimize scope

A runtime should receive only the credentials required by its profile and environment.

A coding agent that needs development database access should not automatically receive production credentials.

## Principle 4: lifecycle is security

Versioning, expiry, sync status, stale-target detection and revocation are core security controls, not administrative extras.

## Principle 5: audit everything important

Every privileged lifecycle action should leave an audit event with enough context to answer:

- who or what acted;
- on which project/environment;
- from which device/session where available;
- which secret metadata or runtime profile was involved;
- what action was attempted;
- whether it succeeded;
- when it happened.

Secret values must never be logged.

## Principle 6: agents are principals

AI agents should have distinct identity and policy context where possible.

MCP should favor "use this capability" over "reveal this value".

## Principle 7: open source and self-hosting are trust features

Organizations that do not want to trust a hosted operator should be able to run the control plane themselves and inspect the implementation.


## Principle 8: authentication is portable, authorization is ours

Self-hosted operation must not require a hosted identity vendor. Human login may
use embedded local authentication/passkeys or optional OIDC federation, but
project/environment/device/agent permissions are owned by the product.

Login identity and vault unlock are separate security boundaries. Revoking a
device must invalidate its ability to obtain new grants even when the user's
account remains active.

## Threats to consider early

- compromised hosted control plane;
- compromised local developer machine;
- malicious dependency or package script;
- malicious or overprivileged MCP server;
- AI agent prompt injection causing credential misuse;
- leaked local session token;
- stolen developer device;
- compromised CI runner;
- destination API token compromise;
- audit tampering;
- rollback to old credential versions;
- secrets exposed through logs or command arguments.

## Audit integrity direction

A later hardening step may hash-chain audit events or use another append-only integrity mechanism so silent history modification is detectable.
