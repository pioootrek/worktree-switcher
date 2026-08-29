# Backlog operating guide

Status: active
Audience: humans and agents maintaining project memory
Source of truth: backlog record workflow for this repository

The backlog is a Git-backed JSON pseudo-database. One canonical JSON file is
one item, completed outcome, or note manifest. The LLM Ops Hub is read-only;
all changes happen through commits to `main` in this repository.

## Required workflow

After any edit in this directory, run from the repository root:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
HUB_DIR="${LLM_OPS_HUB_DIR:-/home/pioootrek/development/llm-ops-hub}"
"$HUB_DIR/.venv/bin/python" "$HUB_DIR/bin/hub.py" fmt --backlog-dir "$REPO_ROOT/docs/backlog"
"$HUB_DIR/.venv/bin/python" "$HUB_DIR/bin/hub.py" validate --backlog-dir "$REPO_ROOT/docs/backlog"
```

Do not manually edit generated `index.json`. Do not commit when validation
fails. JSON uses UTF-8, sorted keys, two-space indentation, and a trailing
newline.

## Records

- Open work lives in `feature/`, `fix/`, `rework/`, or `security/` with IDs
  `TYPE-YYYYMMDD-slug`.
- Finished work lives in one append-only `done/DONE-YYYYMMDD-slug.json` entry.
- Durable findings live in `notes/NOTE-YYYYMMDD-slug/`. `note.json` is the
  canonical manifest; Markdown, JSON, logs, and small images may accompany it.
- `notes[]` inside one backlog item is append-only context for that item.
- Human-authored notes are direction. Product decisions remain proposed until
  a human approves them.

Before starting non-trivial work, scan `index.json`, then open only relevant
items and notes. Prefer updating an existing note over creating a duplicate.
Archive a note when it stops being true. Never store credentials or secrets.

Closing work is one commit: remove the open item, add its done entry, run
`fmt`, and run `validate`. An obsolete item is also removed and represented by
a done entry explaining why it was dropped.

Top-level Markdown pages in `docs/` are validated project documentation. Keep
their canonical frontmatter and update `last_reviewed` only after checking the
document's facts.
