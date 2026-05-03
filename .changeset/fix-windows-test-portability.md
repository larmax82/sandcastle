---
"@ai-hero/sandcastle": patch
---

Fix several Windows portability bugs surfaced by running the test suite on
plain PowerShell (no MSYS / Git Bash / WSL on `PATH`).

- `testSandbox` and the `test-isolated` provider previously hard-coded
  `spawn("sh", "-c", …)`, which fails fast with `spawn sh ENOENT` on
  Windows. They now spawn through Node's built-in shell selector
  (`shell: true`) — `sh` on POSIX, `cmd.exe` on Windows. The test-isolated
  exec path also no longer treats spawn errors (string `error.code` like
  `ENOENT`) as a successful exit-zero result; only numeric exit codes are
  reported as such.
- `syncIn` no longer relies on the sandbox-side `mktemp -d`,
  `rm -rf "…"` and `mv "…"` POSIX utilities. The bundle is staged via
  `copyIn` at a sibling path and the worktree is populated with
  `git init` + `git fetch` + `git checkout -f`, which works in any
  sandbox that has `git` available.
- `sandboxSessionStore` now joins inside-sandbox paths with
  `path.posix.join` so the `~/.claude/projects/<encoded>/<id>.jsonl`
  layout uses forward slashes regardless of the host OS.
- `printFileDisplayStartup` rewrites the `tail -f <log>` hint with
  forward slashes so it stays copy-pasteable on Windows.
