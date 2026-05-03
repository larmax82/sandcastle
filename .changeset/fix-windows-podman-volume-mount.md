---
"@ai-hero/sandcastle": patch
---

Fix podman containers failing to start on Windows because of drive-letter
colons in `-v` volume arguments. Both the docker and podman providers now
build mounts with the long-form `--mount type=bind,source=…,destination=…`
syntax, which uses commas as separators instead of colons, so paths like
`E:/Tandem_dev/.git` no longer confuse the volume parser
(`incorrect volume format, should be [host-dir:]ctr-dir[:option]`).
SELinux labels (`z`/`Z`) and `readonly` map to the equivalent `--mount`
options (`relabel=shared`/`relabel=private`/`readonly`), so behaviour on
Linux/macOS is unchanged.
