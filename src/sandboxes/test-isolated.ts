/**
 * Filesystem-based test isolated sandbox provider.
 *
 * Uses a temp directory on the local filesystem as the "sandbox".
 * Intended for testing the isolated provider abstraction without
 * requiring a real remote environment.
 */

import { exec, spawn } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import {
  createIsolatedSandboxProvider,
  type ExecResult,
  type IsolatedSandboxHandle,
  type IsolatedSandboxProvider,
} from "../SandboxProvider.js";

/**
 * Create a filesystem-based test isolated sandbox provider.
 *
 * The "sandbox" is a temp directory. `exec` runs shell commands in it,
 * `copyIn`/`copyFileOut` copy files between host and the temp dir,
 * and `close` removes the temp dir.
 */
export const testIsolated = (): IsolatedSandboxProvider =>
  createIsolatedSandboxProvider({
    name: "test-isolated",
    create: async (): Promise<IsolatedSandboxHandle> => {
      const sandboxRoot = await mkdtemp(join(tmpdir(), "sandcastle-test-"));
      const worktreePath = join(sandboxRoot, "workspace");
      await mkdir(worktreePath, { recursive: true });

      return {
        worktreePath,

        exec: (
          command: string,
          options?: {
            onLine?: (line: string) => void;
            cwd?: string;
            sudo?: boolean;
          },
        ): Promise<ExecResult> => {
          if (options?.onLine) {
            const onLine = options.onLine;
            return new Promise((resolve, reject) => {
              // Use the platform's default shell (sh on POSIX, cmd.exe on
              // Windows). Tests must use shell-agnostic commands.
              const proc = spawn(command, {
                cwd: options?.cwd ?? worktreePath,
                shell: true,
                stdio: ["ignore", "pipe", "pipe"],
              });

              const stdoutChunks: string[] = [];
              const stderrChunks: string[] = [];

              const rl = createInterface({ input: proc.stdout! });
              rl.on("line", (line) => {
                stdoutChunks.push(line);
                onLine(line);
              });

              proc.stderr!.on("data", (chunk: Buffer) => {
                stderrChunks.push(chunk.toString());
              });

              proc.on("error", (error) => {
                reject(new Error(`exec failed: ${error.message}`));
              });

              proc.on("close", (code) => {
                resolve({
                  stdout: stdoutChunks.join("\n"),
                  stderr: stderrChunks.join(""),
                  exitCode: code ?? 0,
                });
              });
            });
          }

          return new Promise((resolve, reject) => {
            exec(
              command,
              {
                cwd: options?.cwd ?? worktreePath,
                maxBuffer: 10 * 1024 * 1024,
              },
              (error, stdout, stderr) => {
                // When the shell binary itself can't spawn, error.code is a
                // string like "ENOENT" — that's a hard failure, not a
                // successful exit. Only treat numeric error.code as exit code.
                if (error && typeof error.code !== "number") {
                  reject(new Error(`exec failed: ${error.message}`));
                } else {
                  resolve({
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                    exitCode: typeof error?.code === "number" ? error.code : 0,
                  });
                }
              },
            );
          });
        },

        copyIn: async (
          hostPath: string,
          sandboxPath: string,
        ): Promise<void> => {
          const info = await stat(hostPath);
          if (info.isDirectory()) {
            await cp(hostPath, sandboxPath, { recursive: true });
          } else {
            await mkdir(dirname(sandboxPath), { recursive: true });
            await copyFile(hostPath, sandboxPath);
          }
        },

        copyFileOut: async (
          sandboxPath: string,
          hostPath: string,
        ): Promise<void> => {
          await mkdir(dirname(hostPath), { recursive: true });
          await copyFile(sandboxPath, hostPath);
        },

        close: async (): Promise<void> => {
          await rm(sandboxRoot, { recursive: true, force: true });
        },
      };
    },
  });
