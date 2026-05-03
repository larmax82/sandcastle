# Adding a Cursor agent provider to Sandcastle

This document captures the full surface area of what is required to add a new
**agent provider** for Cursor (https://github.com/cursor/cookbook) to the
Sandcastle codebase, alongside the existing `claudeCode`, `codex`, `pi`, and
`opencode` providers.

It is the result of an exploration of:

- The agent provider abstraction (`src/AgentProvider.ts`)
- The init / scaffolding pipeline (`src/InitService.ts`, `src/cli.ts`)
- Tests (`src/AgentProvider.test.ts`, `src/InitService.test.ts`)
- The public package surface (`src/index.ts`, `package.json`)
- Cursor's documented CLI (`agent` binary) and the `@cursor/sdk` cookbook

---

## 1. How Sandcastle's agent abstraction works

### 1.1 The `AgentProvider` contract

Sandcastle defines a single interface in `src/AgentProvider.ts`:

```ts
export interface AgentProvider {
  readonly name: string;
  readonly env: Record<string, string>;
  readonly captureSessions: boolean;
  buildPrintCommand(options: AgentCommandOptions): PrintCommand;
  buildInteractiveArgs?(options: AgentCommandOptions): string[];
  parseStreamLine(line: string): ParsedStreamEvent[];
  parseSessionUsage?(content: string): IterationUsage | undefined;
}
```

Where:

- `buildPrintCommand` returns a shell command string (and optional stdin) used
  during AFK / `run()` mode. The sandbox executes the command inside the
  container.
- `buildInteractiveArgs` returns an argv array used when the user runs
  `interactive()` — the agent CLI is exec'd directly so its TUI can take over.
- `parseStreamLine` consumes one line of the agent's stdout and returns a
  normalized list of `ParsedStreamEvent`s:
  - `{ type: "text", text }`
  - `{ type: "result", result }`
  - `{ type: "tool_call", name, args }`
  - `{ type: "session_id", sessionId }`
- `parseSessionUsage` is Claude-Code-only — it parses the JSONL session file to
  extract per-iteration token usage.

The abstraction is **shell-command based**, not SDK based. Every existing
provider wraps a CLI binary:

| Factory       | Binary              | Auth env var         |
| ------------- | ------------------- | -------------------- |
| `claudeCode`  | `claude`            | `ANTHROPIC_API_KEY`  |
| `codex`       | `codex exec`        | `OPENAI_KEY`         |
| `pi`          | `pi`                | `ANTHROPIC_API_KEY`  |
| `opencode`    | `opencode run`      | `OPENCODE_API_KEY`   |

### 1.2 Wiring points

A new agent has to be registered in **three** places:

1. **Factory** in `src/AgentProvider.ts` — implements the contract.
2. **Public re-export** in `src/index.ts` — exposes `cursor` and `CursorOptions`
   to library consumers.
3. **Init registry entry** in `src/InitService.ts` — used by `sandcastle init`
   to scaffold the `.sandcastle/` directory (Dockerfile, `.env.example`,
   `main.ts` factory call).

`src/cli.ts` reads the agent registry purely via `listAgents()` / `getAgent()`
— no changes needed there.

---

## 2. What Cursor provides

Cursor ships **two** integration surfaces:

### 2.1 `@cursor/sdk` (TypeScript SDK)

Used by the cookbook examples (`sdk/quickstart`, `sdk/coding-agent-cli`).
Programmatic API — `Agent.create(...)`, `agent.send(prompt)`,
`for await (const event of run.stream())`. **Not what Sandcastle integrates**,
because Sandcastle's contract is shell-command based.

### 2.2 `agent` CLI

Standalone binary, installed on macOS/Linux/WSL via:

```bash
curl https://cursor.com/install -fsS | bash
```

Documented flags relevant to headless / sandbox use:

| Flag                                | Meaning                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `-p` / `--print`                    | Non-interactive print mode                           |
| `--output-format text`              | Plain final-answer text (default for `-p`)           |
| `--output-format json`              | Single structured JSON object                        |
| `--output-format stream-json`       | Line-delimited JSON event stream                     |
| `--stream-partial-output`           | Adds incremental deltas to stream-json               |
| `--force` / `--yolo`                | Auto-approve file writes (analogue of Claude's `--dangerously-skip-permissions`) |
| `--model <id>`                      | Model selection (e.g. `composer-2`, `gpt-5.2`)       |
| `--mode plan` / `--mode ask`        | Reasoning / interaction mode                         |
| `--continue`                        | Resume previous session                              |
| `--resume <chat-id>`                | Resume a specific conversation                       |
| `--sandbox enabled` / `disabled`    | Cursor's own internal sandbox toggle                 |

Auth: `CURSOR_API_KEY` env var. Keys are created at
https://cursor.com/dashboard/integrations.

### 2.3 Available models (`--model <id>`)

Pulled from Cursor's pricing docs. Pricing is per million tokens (input/output).
The exact ID strings are what you pass to `--model` and to the
`cursor("<id>")` factory in Sandcastle.

#### Cursor's own models

| Model ID       | Display name   | Pricing (in/out)  | Notes                       |
| -------------- | -------------- | ----------------- | --------------------------- |
| `composer-1`   | Composer 1     | $1.25 / $10       | Older                       |
| `composer-1.5` | Composer 1.5   | $3.50 / $17.50    |                             |
| `composer-2`   | Composer 2     | $0.50 / $2.50     | **Default** — cheapest, Cursor-native |

#### Anthropic Claude

| Model ID            | Display name        | Pricing (in/out) | Notes                  |
| ------------------- | ------------------- | ---------------- | ---------------------- |
| `claude-4-sonnet`   | Claude 4 Sonnet     | $3 / $15         |                        |
| `claude-4-sonnet-1m`| Claude 4 Sonnet 1M  | $6 / $22.50      | 1M-token context       |
| `claude-4.5-haiku`  | Claude 4.5 Haiku    | $1 / $5          | Fast/cheap tier        |
| `claude-4.5-sonnet` | Claude 4.5 Sonnet   | $3 / $15         |                        |
| `claude-4.5-opus`   | Claude 4.5 Opus     | $5 / $25         |                        |
| `claude-4.6-opus`   | Claude 4.6 Opus     | $5 / $25         |                        |
| `claude-4.7-opus`   | Claude 4.7 Opus     | $5 / $25         | Top reasoning          |

#### OpenAI GPT

| Model ID family                                       | Notes                          |
| ----------------------------------------------------- | ------------------------------ |
| `gpt-5`, `gpt-5.1`, `gpt-5.2`, `gpt-5.3`, `gpt-5.4`, `gpt-5.5` and minor variants | General-purpose tiers ($0.20–$5 input range) |
| `gpt-5-codex`, `gpt-5.1-codex`, `gpt-5.2-codex`, `gpt-5.3-codex` | Codex reasoning models — coding-focused |

#### Google Gemini

| Model ID          | Display name     | Pricing (in/out) |
| ----------------- | ---------------- | ---------------- |
| `gemini-2.5-flash`| Gemini 2.5 Flash | $0.30 / $2.50    |
| `gemini-3-flash`  | Gemini 3 Flash   | $0.50 / $3       |
| `gemini-3-pro`    | Gemini 3 Pro     | $2 / $12         |
| `gemini-3.1-pro`  | Gemini 3.1 Pro   | $2 / $12         |

#### Others

| Model ID    | Provider        |
| ----------- | --------------- |
| `grok-4.20` | xAI             |
| `kimi-k2.5` | Moonshot        |

#### Auto

`Auto` — Cursor's automatic model selection. Probably not appropriate as
Sandcastle's `defaultModel` (you want determinism for AFK runs), but accepted
by `--model`.

#### Recommendation for Sandcastle's `defaultModel`

- **`composer-2`** — keep as the registry default. Cheapest, Cursor-native,
  matches the cookbook quickstart.
- For heavy reasoning, users can override at the call site:
  `cursor("claude-4.7-opus")`, `cursor("gpt-5.3-codex")`, etc.

### 2.4 stream-json event shapes (from docs)

```jsonc
// Initialization
{ "type": "system", "subtype": "init", ... }

// Assistant text delta / message
{ "type": "assistant", "timestamp_ms": <n>, "message": { "content": [{ "text": "..." }] } }

// Tool call
{ "type": "tool_call", "subtype": "started",   "tool_call": { ... } }
{ "type": "tool_call", "subtype": "completed", "tool_call": { "result": { "success": { ... } } } }

// Result
{ "type": "result", "duration_ms": <n> }
```

The shape is close enough to Claude Code's stream-json (`{type:"assistant", message:{content:[{type:"text"|"tool_use", ...}]}}`)
that the existing `parseStreamJsonLine` is a reasonable starting model.
Confirm against a live capture — docs are not exhaustive.

---

## 3. Step-by-step implementation plan

### Step 1 — `src/AgentProvider.ts`: add `cursor()` factory

Place it after the `opencode` block (~line 335). Mirror the `codex` factory's
shape since Cursor's CLI flag set is closest to it.

```ts
// ---------------------------------------------------------------------------
// Cursor agent provider
// ---------------------------------------------------------------------------

const parseCursorStreamLine = (line: string): ParsedStreamEvent[] => {
  if (!line.startsWith("{")) return [];
  try {
    const obj = JSON.parse(line);

    // assistant message → text + tool calls (mirror parseStreamJsonLine)
    if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
      const events: ParsedStreamEvent[] = [];
      const texts: string[] = [];
      for (const block of obj.message.content as {
        type: string;
        text?: string;
        name?: string;
        input?: Record<string, unknown>;
      }[]) {
        if (block.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
        } else if (
          block.type === "tool_use" &&
          typeof block.name === "string" &&
          block.input !== undefined
        ) {
          const argField = TOOL_ARG_FIELDS[block.name];
          if (argField === undefined) continue;
          const argValue = block.input[argField];
          if (typeof argValue !== "string") continue;
          if (texts.length > 0) {
            events.push({ type: "text", text: texts.join("") });
            texts.length = 0;
          }
          events.push({ type: "tool_call", name: block.name, args: argValue });
        }
      }
      if (texts.length > 0) events.push({ type: "text", text: texts.join("") });
      return events;
    }

    // session id from system.init (only if Cursor exposes one)
    if (
      obj.type === "system" &&
      obj.subtype === "init" &&
      typeof obj.session_id === "string"
    ) {
      return [{ type: "session_id", sessionId: obj.session_id }];
    }

    // result event
    if (obj.type === "result" && typeof obj.result === "string") {
      return [{ type: "result", result: obj.result }];
    }

    // surface auth/rate-limit/API errors so the orchestrator can show them
    if (obj.type === "error" || obj.type === "agent_error") {
      const msg = extractErrorMessage(obj);
      return msg ? [{ type: "result", result: msg }] : [];
    }
  } catch {
    // not valid JSON — skip
  }
  return [];
};

export interface CursorOptions {
  /** Environment variables injected by this agent provider. */
  readonly env?: Record<string, string>;
  /** Optional reasoning mode flag (--mode plan|ask). */
  readonly mode?: "plan" | "ask";
}

export const cursor = (
  model: string,
  options?: CursorOptions,
): AgentProvider => ({
  name: "cursor",
  env: options?.env ?? {},
  captureSessions: false,

  buildPrintCommand({
    prompt,
    dangerouslySkipPermissions,
    resumeSession,
  }: AgentCommandOptions): PrintCommand {
    const force = dangerouslySkipPermissions ? " --force" : "";
    const modeFlag = options?.mode ? ` --mode ${options.mode}` : "";
    const resumeFlag = resumeSession
      ? ` --resume ${shellEscape(resumeSession)}`
      : "";
    return {
      command: `agent --print --output-format stream-json --model ${shellEscape(model)}${modeFlag}${force}${resumeFlag}`,
      // verify: if `agent` does not read prompt from stdin, fall back to
      // appending `${shellEscape(prompt)}` to command and dropping stdin
      stdin: prompt,
    };
  },

  buildInteractiveArgs({ prompt }: AgentCommandOptions): string[] {
    const args = ["agent", "--model", model];
    if (options?.mode) args.push("--mode", options.mode);
    if (prompt) args.push(prompt);
    return args;
  },

  parseStreamLine(line: string): ParsedStreamEvent[] {
    return parseCursorStreamLine(line);
  },
});
```

Notes:
- `captureSessions: false` — Sandcastle's session capture currently only works
  with Claude Code's JSONL session files.
- Do not implement `parseSessionUsage` — Claude-Code-only.
- The existing `extractErrorMessage` and `TOOL_ARG_FIELDS` helpers at the top
  of the file are reused.

### Step 2 — `src/index.ts`: re-export

```ts
export { claudeCode, codex, cursor, opencode, pi } from "./AgentProvider.js";
export type {
  AgentProvider,
  AgentCommandOptions,
  PrintCommand,
  ClaudeCodeOptions,
  CodexOptions,
  CursorOptions,
  OpenCodeOptions,
  PiOptions,
} from "./AgentProvider.js";
```

This is **public API** — a `patch` changeset is required (see Step 7).

### Step 3 — `src/InitService.ts`: register the agent

#### 3a. Add a Dockerfile constant

After `OPENCODE_DOCKERFILE` (~line 175):

```ts
const CURSOR_DOCKERFILE = `FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  && rm -rf /var/lib/apt/lists/*

{{BACKLOG_MANAGER_TOOLS}}

# Rename the base image's "node" user (UID 1000) to "agent".
# This keeps UID 1000 so that --userns=keep-id (Podman) and
# --user 1000:1000 (Docker) map to the correct home directory owner.
RUN usermod -d /home/agent -m -l agent node
USER agent

# Install Cursor CLI (per-user installer — must run as the agent user)
RUN curl -fsSL https://cursor.com/install | bash

# Add Cursor to PATH (verify the actual install dir on first build)
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at \${SANDBOX_REPO_DIR}
# and overrides the working directory to \${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that \${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
`;
```

**Verification needed**: where Cursor's installer actually places the `agent`
binary. Likely `~/.local/bin/agent` or `~/.cursor/bin/agent`. Run the install
script in a throwaway container and adjust `ENV PATH=` if needed.

#### 3b. Add the registry entry

Append to `AGENT_REGISTRY` (~line 215):

```ts
{
  name: "cursor",
  label: "Cursor",
  defaultModel: "composer-2",
  factoryImport: "cursor",
  dockerfileTemplate: CURSOR_DOCKERFILE,
  envExample: `# Cursor API key
# Get one from https://cursor.com/dashboard/integrations
CURSOR_API_KEY=`,
},
```

That single addition is what powers `sandcastle init --agent cursor`, the
`clack.select` interactive picker (`src/cli.ts:140`), the Dockerfile written
to `.sandcastle/`, and the `rewriteMainTs` step that swaps the `claudeCode`
factory call in scaffolded `main.ts` for `cursor("composer-2")`.

### Step 4 — `src/AgentProvider.test.ts`: add coverage

Mirror the `codex factory` describe block (~line 475, ~150 lines). Cover:

- `name === "cursor"`
- Provider does **not** expose `envManifest` or `dockerfileTemplate`
- `buildPrintCommand` includes the model and `--output-format stream-json`
- Prompt delivered via stdin (or argv if you went that way) — not embedded
  unsafely in the command string
- Model is shell-escaped: `--model 'composer-2'`
- `--force` is appended **iff** `dangerouslySkipPermissions === true`
- `--resume <id>` is appended **iff** `resumeSession` is set; id is
  shell-escaped
- `--mode plan|ask` is appended **iff** the option is set
- `parseStreamLine` extracts text from `{type:"assistant", message:{content:[{type:"text", text}]}}`
- `parseStreamLine` emits a `tool_call` for `Bash`, `WebSearch`, `WebFetch`,
  `Agent` tool blocks; ignores other tool names
- `parseStreamLine` returns `[]` for non-JSON, malformed JSON, unknown event
  types
- `parseStreamLine` surfaces `error` / `agent_error` events as `result` events
  (matches `codex` and `pi` behavior — required for the orchestrator's
  stderr-empty fallback)
- "bakes model into each provider instance independently" (as `codex` does)
- `env` option exposed; defaults to `{}`

### Step 5 — `src/InitService.test.ts`: registry & scaffold tests

Add three tests, mirroring the opencode entries (~line 96–108):

```ts
it("listAgents includes cursor", () => {
  const agents = listAgents();
  expect(agents.some((a) => a.name === "cursor")).toBe(true);
});

it("getAgent returns cursor entry with expected fields", () => {
  const agent = getAgent("cursor");
  expect(agent).toBeDefined();
  expect(agent!.name).toBe("cursor");
  expect(agent!.defaultModel).toBe("composer-2");
  expect(agent!.factoryImport).toBe("cursor");
  expect(agent!.dockerfileTemplate).toContain("cursor.com/install");
});
```

Plus a scaffold integration test, mirroring the existing `codexAgent` /
`opencodeAgent` patterns (~line 26 + 147), to confirm `--agent cursor`
produces a Dockerfile, `.env.example` mentioning `CURSOR_API_KEY`, and a
rewritten `main.ts` calling `cursor("composer-2")`.

### Step 6 — CLI: nothing to change

`src/cli.ts:126–157` reads agents purely via `listAgents()` / `getAgent()`.
The CLI flag `--agent cursor` and the interactive `clack.select` picker both
"just work" once Step 3 is done. Same for `--model`, which falls through to
`selectedAgent.defaultModel` if not provided.

### Step 7 — Docs and changeset

#### `.changeset/`

Per `CLAUDE.md`:

> For user-facing changes, add a changeset to `.changeset`. Check all
> changesets there first to see if there are duplicates. We use
> `@changesets/cli`, but you can create/edit the file manually. Make all
> changesets `patch` (since we're pre-1.0). Use `package.json#name` for the
> name.

Create e.g. `.changeset/add-cursor-agent.md`:

```md
---
"@ai-hero/sandcastle": patch
---

Add Cursor agent provider. New `cursor()` factory and `CursorOptions` type
exported from the package root, plus a `cursor` entry in the init registry
so `sandcastle init --agent cursor` scaffolds a working `.sandcastle/`
directory.
```

#### `README.md`

Mostly uses `claudeCode` examples. Add a one-line mention of Cursor in the
agent list if that section exists; otherwise no doc change is strictly
required by the abstraction (the factory is self-documenting via TypeScript
types).

#### `CONTEXT.md`

Line 22 currently reads `(e.g. Claude Code, Codex)`. Optional: extend to
include Cursor. Not load-bearing.

### Step 8 — Manual verification

Sandcastle is a tool that runs other tools — type checks won't catch a wrong
CLI flag. Before merging:

1. `npm run build && npm run typecheck`
2. `npm test` — including the new test cases
3. `sandcastle init --agent cursor` against a scratch repo; confirm:
   - `.sandcastle/Dockerfile` written with the Cursor template
   - `.sandcastle/.env.example` lists `CURSOR_API_KEY=`
   - `.sandcastle/main.ts` (or `.mts`) calls `cursor("composer-2")`
4. `sandcastle docker build-image` succeeds; `agent --version` works inside
   the resulting container
5. End-to-end: a tiny `run()` against a small task with `CURSOR_API_KEY` set,
   on the `noSandbox()` provider first (fastest feedback) and then `docker()`.
   Confirm:
   - Stream events render as text + tool calls in the run log
   - Iteration ends cleanly when the agent emits the completion signal
   - Errors (auth failure, rate limit) show up via the `result`-event fallback

---

## 4. Pre-implementation decisions

These shape the factory and should be settled **before** writing code:

1. **Default model.** The cookbook quickstart uses `composer-2`. Pick whatever
   Cursor recommends as their general-purpose default at integration time.
2. **Prompt delivery — stdin or argv?** Cursor's `agent -p "<prompt>"` is the
   documented form. If `agent -p -` reads from stdin (Claude-Code-style),
   prefer stdin to dodge the 128 KB Linux argv limit. Confirm via
   `agent --help` after install. Codex and Pi already deliver via stdin;
   OpenCode delivers via argv.
3. **Reasoning mode exposure.** Cursor has `--mode plan|ask`. Either expose via
   `CursorOptions.mode` (cheap, kept above) or defer until requested.
4. **Session resumption.** Cursor's `--resume <chat-id>` exists, but
   `parseStreamLine` can only emit `session_id` events if Cursor's stream-json
   actually includes a session id in `system.init`. If it doesn't, leave the
   provider unable to resume — it'll behave like Codex/Pi/OpenCode (always
   fresh). Only Claude Code captures sessions today.
5. **`--force` semantics.** Map directly to `dangerouslySkipPermissions ===
   true`. This means: container-based providers (Docker, Podman, Vercel)
   pass it (because the sandbox itself contains the blast radius); the
   `noSandbox()` provider does not (its whole point is preserving permission
   prompts).

---

## 5. Estimated scope

| File                                                | Lines |
| --------------------------------------------------- | ----- |
| `src/AgentProvider.ts` — factory + parser           | ~120  |
| `src/AgentProvider.test.ts` — coverage              | ~150  |
| `src/InitService.ts` — Dockerfile + registry entry  | ~40   |
| `src/InitService.test.ts` — registry + scaffold tests | ~30 |
| `src/index.ts` — re-export                          | 3     |
| `.changeset/add-cursor-agent.md`                    | ~10   |

**Total: a single self-contained PR, no architectural changes.**

The hardest part is verifying Cursor's stream-json shape against real output —
write the parser tests against fixtures captured from a live
`agent --print --output-format stream-json --model composer-2` run, not
against assumptions from the docs.

---

## 6. Reference: existing provider patterns

For copy-paste convenience, here is where each existing provider lives in
`src/AgentProvider.ts`:

| Provider     | Factory line | Parser line | Test block line |
| ------------ | ------------ | ----------- | --------------- |
| `pi`         | ~196         | ~130        | ~460            |
| `codex`      | ~272         | ~223        | ~475            |
| `opencode`   | ~311         | (no parser) | (varies)        |
| `claudeCode` | ~348         | ~31         | (varies)        |

And the init service registry:

- `AGENT_REGISTRY` array: `src/InitService.ts:177`
- Dockerfile constants: `src/InitService.ts:59–175`
- `getAgent` lookup: `src/InitService.ts:292`
- CLI consumes the registry at: `src/cli.ts:126–157`

---

## 7. Open questions to resolve at implementation time

- Exact path Cursor's installer puts `agent` into inside a clean
  `node:22-bookworm` container (for the Dockerfile `ENV PATH=`).
- Whether `agent --print` reads stdin (preferred) or only argv.
- Whether `agent --print --output-format stream-json` emits a `system.init`
  event with a `session_id` field, or some other handle suitable for
  `--resume`.
- Whether the `tool_call` event shape (`tool_call.name`, `tool_call.input`,
  `tool_call.tool_call.name`, etc.) matches the Claude-Code-style
  `block.type === "tool_use"` assumption used in the parser sketch above. If
  not, rewrite the tool-call branch of `parseCursorStreamLine` against the
  real shape captured from a live run.

---

## 8. Distributing the fork (private use, no npm publish)

The upstream package is published as `@ai-hero/sandcastle`. For a small group
(yourself and a few colleagues) the simplest distribution path is **install
directly from your GitHub fork** — no npm publish, no scope rename. This
section documents the exact setup required to make `npm install` against a
git source actually produce a working install.

### 8.1 Why a plain git install isn't enough by itself

Sandcastle's `package.json` declares:

```json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
"files": ["dist"]
```

So the importable artifact is the **compiled `dist/`**, produced by
`npm run build` (which runs `tsgo` then a `postbuild` that copies template
files into `dist/templates/`).

When you `npm install github:user/sandcastle#branch`:

- npm clones the repo at the given ref into `node_modules/@ai-hero/sandcastle/`.
- npm does **not** run the `build` script.
- It does run `prepare` if one exists.

The repo currently has `"prepare": "husky"`, which only sets up git hooks —
useless inside a consumer's `node_modules`. Without a build step, `dist/`
doesn't exist and `import { run } from "@ai-hero/sandcastle"` blows up.

### 8.2 The fix: build on install via `prepare`

The fork's `package.json` runs the build through a Node script during the
`prepare` lifecycle:

```json
"scripts": {
  ...
  "postbuild": "node scripts/postbuild.mjs",
  "prepare": "node scripts/prepare.mjs"
}
```

Notes:
- `scripts/prepare.mjs` runs `husky` only when `.git` is present (i.e., a dev
  checkout) and swallows any failure. It then runs `npm run build` and asserts
  that `dist/main.js` exists, exiting non-zero if not. That guard prevents
  a silent empty-package install if the build chain ever produces nothing —
  the original symptom of #12.
- `scripts/postbuild.mjs` uses `fs.rmSync` / `fs.cpSync` to refresh
  `dist/templates`. The previous `rm -rf` / `cp -r` chain only worked on
  POSIX shells and silently broke Windows installs (#12, fixed in
  `v0.5.7-cursor.4`).
- npm runs `prepare` automatically after a git-source install. After the
  consumer's `npm install` completes, `node_modules/@ai-hero/sandcastle/dist/`
  will exist with the compiled output.
- Build dependencies (`tsgo`, `tsx`, `prettier`, etc.) need to be installed
  for `prepare` to run. They live in `devDependencies` — npm installs those
  for git sources, then prunes them after `prepare` finishes. This works
  out of the box; no changes needed.

This keeps the fork shell-agnostic — `cmd.exe`, PowerShell, and POSIX shells
all run the same `node scripts/*.mjs` entrypoints. **Make it on a fork
branch** (e.g. `main` on your fork) so you don't have to commit `dist/`
artifacts.

### 8.3 Tagging releases

Pin consumers to **tags**, not branches. Branches move; force-pushes break
locks.

In your fork:

```bash
git tag v0.5.7-cursor.1
git push origin v0.5.7-cursor.1
```

Suggested tag scheme: `v<upstream-version>-<your-suffix>.<n>`, e.g.
`v0.5.7-cursor.1`, `v0.5.7-cursor.2`. Lets you stay aligned with upstream
while iterating on your own changes.

### 8.4 Consumer install commands

In any project that wants to use your fork:

```bash
npm install --save-dev github:<your-username>/sandcastle#v0.5.7-cursor.1
```

Or in `package.json` (for `npm install` reproducibility):

```json
{
  "devDependencies": {
    "@ai-hero/sandcastle": "github:<your-username>/sandcastle#v0.5.7-cursor.1"
  }
}
```

The dependency **name stays `@ai-hero/sandcastle`** — that's how npm derives
the install path. It's the source URL that points to your fork. Imports in
consumer code (`import { run, cursor } from "@ai-hero/sandcastle"`) work
unchanged.

`npm` rewrites the lockfile entry to the resolved git commit SHA, so
reinstalls are reproducible even if you later move the tag.

For private repos, the URL needs auth. Easiest:

```bash
npm install --save-dev git+ssh://git@github.com:<your-username>/sandcastle.git#v0.5.7-cursor.1
```

…and rely on each user's SSH key. Avoids embedding tokens in `package.json`.

### 8.5 Things that keep working unchanged

- The CLI binary name stays `sandcastle` (`package.json#bin`). Running
  `npx sandcastle init` works identically.
- Scaffolded `.sandcastle/main.ts` files in user projects still import from
  `@ai-hero/sandcastle` — the import resolves to your fork because that's
  what npm has installed under that name.
- `peerDependencies` (`@vercel/sandbox`, `@daytona/sdk`) behave normally.

### 8.6 Things to watch out for

- **Don't commit `dist/` to your fork.** The `prepare`-on-install hook
  generates it freshly per consumer install; committing it just creates merge
  conflicts when you rebase on upstream.
- **Build time on install.** `tsgo` is fast, but consumers will see a few
  seconds of build during `npm install`. Acceptable for a small private
  group; not acceptable at scale.
- **Upstream rebases.** When you pull from `mattpocock/sandcastle` upstream,
  resolve any `package.json` conflicts on the `prepare` script. Keep your
  fork's version (`husky || true && npm run build`).
- **Husky postinstall.** The original `prepare: "husky"` only runs in dev
  checkouts of the repo itself. Inside `node_modules`, `husky` errors out
  because there's no `.git`. The `|| true` swallow is the standard
  workaround.
- **Multiple devs working on the fork.** They'll each need to update the
  install URL on their consumer projects when you cut a new tag. Document
  the current canonical tag somewhere central (a pinned issue, a Slack
  channel topic, this file).

### 8.7 One-time setup checklist for the fork

1. Fork `mattpocock/sandcastle` to your own GitHub account.
2. On your fork, edit `package.json` `prepare` script to
   `"husky || true && npm run build"`.
3. Commit, push to `main` on the fork.
4. Implement the Cursor agent provider per §3 of this doc.
5. Run `npm test`, `npm run typecheck`, then commit.
6. `git tag v0.5.7-cursor.1 && git push origin v0.5.7-cursor.1`.
7. Share the install command with colleagues:
   `npm i -D github:<you>/sandcastle#v0.5.7-cursor.1`.

### 8.8 Updating consumers when you cut a new tag

```bash
# In the consumer project
npm install --save-dev github:<your-username>/sandcastle#v0.5.7-cursor.2
```

Or edit `package.json` and run `npm install`. The lockfile picks up the new
commit SHA automatically.

### 8.9 Optional: per-user fork override via `npm overrides`

If a colleague wants to test their own branch without modifying the
consumer's `package.json`, they can add to **their** consumer project's
`package.json`:

```json
{
  "overrides": {
    "@ai-hero/sandcastle": "github:<colleague-username>/sandcastle#experiment"
  }
}
```

Useful for local experimentation; don't commit it.
