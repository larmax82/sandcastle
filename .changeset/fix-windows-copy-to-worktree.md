---
"@ai-hero/sandcastle": patch
---

Fix worktree creation failing on Windows with `spawn cp ENOENT`.
`copyToWorktree` previously shelled out to POSIX `cp` to copy files
(including `node_modules`) into the sandbox worktree, which is not on
`PATH` in plain Windows installs. Windows now uses Node's `fs.cp`;
macOS and Linux still get the `cp` copy-on-write fast-path
(APFS clonefile / GNU coreutils reflink).
