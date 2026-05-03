---
"@ai-hero/sandcastle": patch
---

`sandcastle init` now prompts for a model when `--model` is omitted. Cursor shows a curated `clack.select` list of model IDs (Composer, Claude, GPT, Gemini, Grok, Kimi) with a final "Custom…" entry that drops to a free-text prompt; other agents (Claude Code, Pi, Codex, OpenCode) show a free-text prompt pre-filled with the agent's default model. The `--model` flag still short-circuits both prompts.
