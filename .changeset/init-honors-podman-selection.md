---
"@ai-hero/sandcastle": patch
---

Fix `sandcastle init` so the selected sandbox provider is wired into the scaffolded `main.{ts,mts}`. Previously, picking Podman wrote a `Containerfile` and built a Podman image but left `main.mts` importing and calling `docker()`, which failed at runtime with `spawn docker ENOENT` on machines without Docker installed. The init flow now rewrites the import path, import binding, and every `sandbox: docker()` call site to match the chosen provider.
