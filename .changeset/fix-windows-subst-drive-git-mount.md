---
"@ai-hero/sandcastle": patch
---

Fix podman containers failing to start on Windows when the host repo lives
on a `subst` drive (or under a directory junction). Sandcastle resolves the
parent `.git` mount destination by comparing the gitdir line written by
`git worktree add` against the mount's host path. When `E:\` is `subst`'d
to `C:\E`, git canonicalizes through the alias and writes
`gitdir: C:/E/repo/.git/worktrees/...` while Node's `path.join` keeps the
user-facing `E:/repo/.git`, so the two strings no longer match. The mount
then escapes the remap and podman rejects it with
`invalid container path "E:/repo/.git", must be an absolute path`.
The comparison now falls back to a `stat`-based dev+ino check when the
strings differ, so `subst` drives, junctions, and other path aliases on
Windows are recognized as the same parent `.git` directory.
