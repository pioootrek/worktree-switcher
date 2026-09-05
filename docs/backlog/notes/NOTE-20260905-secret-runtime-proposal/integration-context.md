# Secret Runtime v2: source and integration context

The owner supplied this proposal on 2026-09-05 and requested its inclusion in
Worktree Switcher. The original documents describe a separate project discussed
on 2026-09-03. All regular source files are preserved byte-for-byte under
`source/`; `source-checksums.json` records their hashes. No setup instructions
from the archive were executed and no new project/service was registered.

Read [the Switcher integration plan](../../../environment-runtime-plan.md) for
the current direction. The source architecture, six milestone tickets, example
configuration, and setup guide are reference material, not active Switcher
contracts. In particular PostgreSQL-only, Rust, Better Auth, milestone numbering,
all tickets marked `now`, and proposed deployment paths are not adopted here.
Keep the original backlog JSON as note payloads rather than importing six
duplicated active tickets. Current operating rules remain in repository
AGENTS.md files.

The selected first slice is environment profiles and scoped secret delivery to
approved processes, integrated with existing Switcher workers and remote
verification. A central vault, provider synchronization, and rotation remain
later proposals. Reuse the existing profile backlog rather than create a second
runtime owner.

Source entry points:

- [Original overview](source/README.md)
- [Vision](source/docs/product/vision.md)
- [Architecture](source/docs/product/architecture.md)
- [Security](source/docs/product/security.md)
- [MVP and milestone history](source/docs/product/mvp.md)
- [Open questions](source/docs/product/open-questions.md)
- [Competitive framing](source/docs/product/competition.md)

The competition document needs fresh external verification before relying on
its product claims. The setup guide explicitly says the originating session
had no terminal access and did not execute its proposed worker commands. This
explains why the archive itself is not evidence of an installed project.
