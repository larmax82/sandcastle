---
"@ai-hero/sandcastle": patch
---

`sandcastle init` Cursor model picker now probes the live `cursor-agent --list-models` catalog instead of offering a hardcoded list that contained IDs Cursor's API rejects (e.g. bare `claude-4.6-opus`, which requires a `-high` / `-max` / `-thinking` suffix). Falls back to a smaller static list of known-valid IDs when the CLI is missing or the probe fails. Closes #27.
