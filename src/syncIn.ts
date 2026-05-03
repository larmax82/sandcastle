/**
 * Sync-in: transfer a host git repo into an isolated sandbox via git bundle.
 *
 * Creates a git bundle capturing all refs from the host repo,
 * copies it into the sandbox via the provider's copyIn, and
 * clones from the bundle inside the sandbox.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { IsolatedSandboxHandle } from "./SandboxProvider.js";
import { SyncError } from "./errors.js";

/**
 * Execute a command on the host side, returning stdout.
 * Fails with SyncError on non-zero exit.
 */
const execHost = (
  command: string,
  cwd: string,
): Effect.Effect<string, SyncError> =>
  Effect.tryPromise({
    try: async () => {
      const { exec } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execAsync = promisify(exec);
      const { stdout } = await execAsync(command, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    },
    catch: (e) =>
      new SyncError({
        message: `Host command failed: ${command}\n${e instanceof Error ? e.message : String(e)}`,
      }),
  });

/**
 * Execute a command in the sandbox, failing with SyncError if it exits non-zero.
 */
const execOk = (
  handle: IsolatedSandboxHandle,
  command: string,
  options?: { cwd?: string },
): Effect.Effect<
  { stdout: string; stderr: string; exitCode: number },
  SyncError
> =>
  Effect.tryPromise({
    try: () => handle.exec(command, options),
    catch: (e) =>
      new SyncError({
        message: `Sandbox exec failed: ${command}\n${e instanceof Error ? e.message : String(e)}`,
      }),
  }).pipe(
    Effect.flatMap((result) =>
      result.exitCode !== 0
        ? Effect.fail(
            new SyncError({
              message: `Sandbox command failed (exit ${result.exitCode}): ${command}\n${result.stderr}`,
            }),
          )
        : Effect.succeed(result),
    ),
  );

/**
 * Sync a host git repo into an isolated sandbox.
 *
 * 1. `git bundle create --all` on the host
 * 2. `copyIn` the bundle to the sandbox
 * 3. `git clone` from the bundle inside the sandbox
 * 4. Verify HEAD matches
 *
 * @returns The branch name that was checked out
 */
export const syncIn = (
  hostRepoDir: string,
  handle: IsolatedSandboxHandle,
): Effect.Effect<{ branch: string }, SyncError> =>
  Effect.gen(function* () {
    // Get current branch from host
    const branch = (yield* execHost(
      "git rev-parse --abbrev-ref HEAD",
      hostRepoDir,
    )).trim();

    // Create git bundle on host capturing all refs
    const bundleDir = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "sandcastle-bundle-")),
      catch: (e) =>
        new SyncError({
          message: `Failed to create temp dir: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });
    const bundleHostPath = join(bundleDir, "repo.bundle");

    yield* Effect.ensuring(
      Effect.gen(function* () {
        yield* execHost(
          `git bundle create "${bundleHostPath}" --all`,
          hostRepoDir,
        );

        // Stage the bundle inside the sandbox at a path adjacent to the
        // worktree. Using a fixed sibling path (rather than `mktemp -d` inside
        // the sandbox) keeps this routine portable to test sandboxes that run
        // on Windows hosts where `mktemp` is not available. `copyIn` creates
        // the parent directory if needed.
        const worktreePath = handle.worktreePath;
        const bundleSandboxPath = `${worktreePath}.bundle`;

        yield* Effect.tryPromise({
          try: () => handle.copyIn(bundleHostPath, bundleSandboxPath),
          catch: (e) =>
            new SyncError({
              message: `Failed to copy bundle into sandbox: ${e instanceof Error ? e.message : String(e)}`,
            }),
        });

        // Populate the worktree with the host's committed state using git
        // alone — `git init` works in a non-empty dir, `git fetch` brings in
        // every ref from the bundle, and `git checkout -f` materialises the
        // requested branch. This avoids the previous `git clone` +
        // `rm -rf` + `mv` dance which relied on POSIX-only utilities.
        yield* execOk(handle, `git init -q`, { cwd: worktreePath });
        yield* execOk(
          handle,
          `git fetch -q "${bundleSandboxPath}" "+refs/heads/*:refs/heads/*" "+refs/tags/*:refs/tags/*"`,
          { cwd: worktreePath },
        );
        yield* execOk(handle, `git checkout -f "${branch}"`, {
          cwd: worktreePath,
        });

        // Verify sync succeeded
        const hostHead = (yield* execHost(
          "git rev-parse HEAD",
          hostRepoDir,
        )).trim();
        const sandboxHead = (yield* execOk(handle, "git rev-parse HEAD", {
          cwd: worktreePath,
        })).stdout.trim();

        if (hostHead !== sandboxHead) {
          yield* Effect.fail(
            new SyncError({
              message: `HEAD mismatch after sync-in: host=${hostHead} sandbox=${sandboxHead}`,
            }),
          );
        }
      }),
      // Clean up host-side bundle temp dir (runs regardless of success/failure)
      Effect.promise(() => rm(bundleDir, { recursive: true, force: true })),
    );

    return { branch };
  });
