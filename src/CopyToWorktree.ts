import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
  CopyToWorktreeError,
  CopyToWorktreeTimeoutError,
  withTimeout,
} from "./errors.js";

const COPY_TO_WORKTREE_TIMEOUT_MS = 60_000;

/**
 * Returns `cp` flags for copy-on-write support, or `null` on platforms
 * where shelling out to `cp` isn't viable. When `null`, the caller falls
 * back to Node's `fs.cp` (cross-platform, no copy-on-write).
 * - macOS (darwin): `-cR` uses APFS clonefile
 * - Linux / other POSIX: `-R --reflink=auto` uses GNU coreutils reflink
 * - Windows (win32): `null` — `cp` is not on `PATH`
 */
export const getCopyOnWriteFlags = (platform: string): string[] | null => {
  if (platform === "win32") return null;
  return platform === "darwin" ? ["-cR"] : ["-R", "--reflink=auto"];
};

/**
 * Copy files and directories from the host repo root to the worktree root,
 * using copy-on-write when the filesystem supports it.
 * Missing paths are silently skipped.
 */
export const copyToWorktree = (
  paths: string[],
  hostRepoDir: string,
  worktreePath: string,
  timeoutMs?: number,
): Effect.Effect<void, CopyToWorktreeTimeoutError | CopyToWorktreeError> => {
  const effectiveTimeout = timeoutMs ?? COPY_TO_WORKTREE_TIMEOUT_MS;
  return Effect.gen(function* () {
    const cowFlags = getCopyOnWriteFlags(process.platform);
    for (const relativePath of paths) {
      const src = join(hostRepoDir, relativePath);
      if (!existsSync(src)) {
        continue;
      }
      const dest = join(worktreePath, relativePath);

      if (cowFlags === null) {
        yield* Effect.tryPromise({
          try: () => cp(src, dest, { recursive: true }),
          catch: (error) => {
            const stderr =
              error instanceof Error ? error.message : String(error);
            return new CopyToWorktreeError({
              message: `Failed to copy ${relativePath} to worktree: ${stderr}`,
              path: relativePath,
              stderr,
              exitCode: null,
            });
          },
        });
        continue;
      }

      yield* Effect.async<void, CopyToWorktreeError>((resume) => {
        execFile("cp", [...cowFlags, src, dest], (error) => {
          if (error) {
            // Fall back to a regular copy if copy-on-write is not supported
            execFile("cp", ["-R", src, dest], (fallbackError, _, stderr) => {
              if (fallbackError) {
                resume(
                  Effect.fail(
                    new CopyToWorktreeError({
                      message: `Failed to copy ${relativePath} to worktree: ${stderr || fallbackError.message}`,
                      path: relativePath,
                      stderr: stderr || fallbackError.message,
                      exitCode:
                        typeof fallbackError.code === "number"
                          ? fallbackError.code
                          : null,
                    }),
                  ),
                );
              } else {
                resume(Effect.succeed(undefined));
              }
            });
          } else {
            resume(Effect.succeed(undefined));
          }
        });
      });
    }
  }).pipe(
    withTimeout(
      effectiveTimeout,
      () =>
        new CopyToWorktreeTimeoutError({
          message: `Copying files to worktree timed out after ${effectiveTimeout}ms`,
          timeoutMs: effectiveTimeout,
          paths,
        }),
    ),
  );
};
