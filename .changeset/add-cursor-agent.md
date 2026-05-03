---
"@ai-hero/sandcastle": patch
---

Add Cursor agent provider (text-only). `cursor(model, options?)` factory and `CursorOptions` type are now exported from `@ai-hero/sandcastle`. `sandcastle init --agent cursor` scaffolds a project that runs against the Cursor CLI. Tool-call surfacing in the run log is deferred to a follow-up release.
