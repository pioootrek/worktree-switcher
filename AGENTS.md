# Worktree Switcher repository guide

Status: active
Audience: humans and coding agents working on this repository
Source of truth: repository-wide contribution and project-memory rules

## Project intent

Build an open-source, local-first control plane that discovers Git worktrees
and runs several development projects concurrently. Each project owns one
managed server and can switch independently to another worktree while keeping
a stable configured port.

Read `docs/project-brief.md` before making product or architecture decisions.
Keep the control plane independent from every repository it supervises.

## Backlog

This project keeps its backlog and durable agent memory as canonical JSON under
`docs/backlog/`. Read `docs/backlog/AGENTS.md` before adding, updating, or
closing an item or note.

After every edit under `docs/backlog/` or to a top-level project document under
`docs/`, run:

```bash
HUB_DIR="${LLM_OPS_HUB_DIR:-/home/pioootrek/development/llm-ops-hub}"
"$HUB_DIR/.venv/bin/python" "$HUB_DIR/bin/hub.py" fmt --backlog-dir docs/backlog
"$HUB_DIR/.venv/bin/python" "$HUB_DIR/bin/hub.py" validate --backlog-dir docs/backlog
```

Never edit `docs/backlog/index.json` manually. Backlog changes live on `main`
and become visible through the read-only LLM Ops Hub after they are committed
and synchronized.

Check the `notes` section of `docs/backlog/index.json` before non-trivial work.
Persist durable findings under `docs/backlog/notes/` before context compaction.
Completed work moves from an open item to a `done/` entry in one commit.

This project currently has no GitHub feedback integration. If one is configured
later, treat open issues labeled `backlog-feedback` as human instructions and
apply them according to `docs/backlog/AGENTS.md`.
