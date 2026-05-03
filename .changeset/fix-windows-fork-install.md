---
"@ai-hero/sandcastle": patch
---

Fix fork install on Windows producing an empty package. The `postbuild` step
no longer relies on POSIX-only `rm -rf` / `cp -r`; templates are copied via
a Node-based script that works on cmd.exe, PowerShell, and POSIX shells.
The `prepare` hook now exits non-zero when `dist/main.js` is missing, so a
broken build during a git-source install surfaces as a real install error
instead of silently shipping an empty `dist/`.
