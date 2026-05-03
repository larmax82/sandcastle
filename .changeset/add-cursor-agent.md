---
"@ai-hero/sandcastle": patch
---

Add Cursor agent provider. `cursor(model, options?)` factory and `CursorOptions` type are now exported from `@ai-hero/sandcastle`. `sandcastle init --agent cursor` scaffolds a project that runs against the Cursor CLI. Shell tool calls (Cursor's `shellToolCall`) are surfaced in the run log as `Bash` events; other tool keys (`editToolCall`, `globToolCall`, …) are observed but not yet surfaced.
