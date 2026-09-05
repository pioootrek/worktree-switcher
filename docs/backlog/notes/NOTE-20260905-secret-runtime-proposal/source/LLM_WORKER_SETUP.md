# llm-worker setup

The current chat session does not have SSH/terminal access to `llm-worker`, so these commands are intentionally not executed here.

Assuming the worker keeps projects under `~/projects` and the hub repository under `~/tools/llm-ops-hub`, adapt paths to the actual machine:

```bash
mkdir -p ~/projects/secret-runtime
cd ~/projects/secret-runtime
# initialize or clone the project's Git repository here
```

The LLM Ops Hub does not monitor an arbitrary local folder directly. Its configured project identity points at a Git repository, backlog ref and backlog directory. Add an entry equivalent to `LLM_OPS_REGISTRATION.example.json` to the worker's schema-version 2 hub config after the project has a Git remote.

Expected project-side contract:

```text
docs/backlog/
  config.json
  feature/
  fix/
  rework/
  security/
  done/
  notes/
```

After installing the llm-ops-hub tool on the worker or development machine, run its `fmt` and `validate` commands against `docs/backlog` before committing backlog changes.
