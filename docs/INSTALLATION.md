**English** | [Português (Brasil)](INSTALACAO.pt-BR.md)

# Installation and verification (v0.3.1)

Nothing here calls a paid model or publishes a package. Requirements: Node >= 20, git, access to the repository.

## Validation matrix

What was actually executed (GitHub-hosted runners and local runs). Linux is not validation of macOS or Windows.

| Check (CI run #8 at 21bec84: 70 unit tests; run #9 at 6e57c76: 71) | Linux x64 | macOS arm64 (macos-26) | macOS Intel x64 (macos-15-intel) | Windows x64 |
|---|---|---|---|---|
| Unit tests, Node 22 | OK | OK | OK | OK |
| Unit tests, Node 20 | OK | OK (after one rerun) | not run | OK |
| e2e-native: real Claude Code plugin and real OpenCode 1.19.6 vs fake servers | OK | OK (after one rerun) | OK | OK |
| bash e2e scripts (same clients) | OK | OK at 6e57c76 (run #9; not acquired twice at 21bec84) | OK at 6e57c76 (run #9) | not applicable (bash) |

Pre-i18n evidence, kept separate (commit f50909a, run #6): Windows unit 63/63 on Node 20 and 22 and Windows e2e-native OK. All macOS jobs in that run were not acquired.
Not covered: Claude Code and OpenCode have been exercised against fake model servers only, never against a paid real model. The check that reads the `--model` flag of the claude process uses `/proc` and runs on Linux only.

This table is updated from CI results only. Run #9 (commit 6e57c76, docs and CI only, code unchanged from 21bec84) was green in all 14 jobs (all 7 unit jobs 71/71), including the bash e2e on macOS arm64 and Intel.

Official client support on Windows (docs read 2026-11-25): Claude Code runs natively on Windows 10 1809+ / Server 2019+ (Git for Windows recommended; without it Claude Code uses PowerShell) - https://code.claude.com/docs/en/setup . OpenCode can run directly on Windows but its documentation recommends WSL - https://opencode.ai/docs/windows-wsl/ .

## 1. Get it and test it

```
git clone git@github.com:glauberportella/opencode-precost.git && cd opencode-precost
git checkout v0.3.1                  # or stay on main
npm ci && npm test                    # 71 tests
```

End-to-end tests against real third-party clients and FAKE local servers (no spend; they download pinned versions through npx): `npm run e2e:native` (all systems), or the bash variants `e2e:claude-plugin`, `e2e:claude-plugin-failure`, `e2e:claude`, `e2e:claude-tui`, `e2e:claude-failure`, `e2e:opencode`, `e2e:opencode-ledger`, `e2e:opencode-tui` (Linux/macOS).

## 2. Configuration (`~/.config/precost/config.json`, Windows `%APPDATA%\precost\config.json`)

```
{"model":"claude-sonnet-5.5","limitUsd":5}
```

Without `limitUsd` the hook only informs and never blocks. `trustConfiguredModel: true` is your decision to accept an observed or declared model as the effective one (see the README, "Limits").

## 3. Claude Code (tested with 2.1.332)

- **Plugin:** `claude --plugin-dir /path/to/opencode-precost` to try it. After the repository is public: `/plugin marketplace add <repo>` and `/plugin install precost@precost-marketplace`. Hooks are in `hooks/hooks.json` with `onFailure: "block"`. Not published to any marketplace yet.
- **Manual:** copy `adapters/claude-code/settings.example.json` into `~/.claude/settings.json` (or the project's `.claude/settings.json`) and replace `/CAMINHO/opencode-precost` with the clone path. Keep `"onFailure": "block"` on `UserPromptSubmit`; without it a crash, timeout or missing node lets the prompt reach the model.

## 4. OpenCode (tested with 1.19.6; other versions block)

In the project: `npm i opencode-precost @opencode-ai/plugin@1.19.6` (not on npm yet: run `npm pack` in a clone and install the tarball), then create `.opencode/plugins/precost.js`:

```js
import { PrecostPlugin } from 'opencode-precost';
export const P = async (input) => PrecostPlugin(input, { limitUsd: 5 });
```

Verified on Linux with OpenCode 1.19.6: this shim loads the plugin and blocks the message. Not verified: loading it only through `opencode.json` (the `plugin` key did not load it in tests; the `plugins` key is ignored by 1.19.6). Use the shim.

## 5. Check the install (no paid call)

```
node bin/precost.js doctor [--project DIR] [--claude-settings FILE]
```

`doctor` checks config, prices, hook/plugin files, `onFailure` and trackers, and runs the hook locally with temporary state. It exits 1 on any FAIL.
**Limit:** `doctor` cannot prove that the client loaded the hook or plugin in your session. The fail-closed behavior only holds while it is loaded. In a real session type `precost last` first: with the hook loaded, precost answers without a model. If a model answers, the hook is NOT loaded (cost: one short prompt).

## 6. Prices

`precost prices` shows the table in use. `precost update-prices --from FILE_OR_URL` validates and prints a diff; add `--yes` to write it. Without `--from` it uses the default source, the table on `main` of the project repository (see PRICES.md). That works only once the repository is public; until then it fails with HTTP 404, keeps the current table and exits 1. Use `--from` or `PRECOST_PRICES_SOURCE` for another source.

## 7. Use

`precost estimate <task>`, `precost last`, `precost approve CODE`, `precost revoke CODE|all`, typed in the prompt (they do not reach the model). In a terminal: `node bin/precost.js estimate "..." --model ...`.

## Supported scope and limits (summary; details in CAPABILITIES.md)

- An estimate, not a cost. The high end is not a cap. The gate acts before the prompt and does not limit spend during the task.
- OpenCode has no automatic preview before the model. After approval there is one auxiliary call (session title) that the estimate does not include (observed only against a fake provider).
- Approval is a local file of the same user: it protects against accidental spend, not against an agent with a shell.
- Worst-case model = highest price in the supported catalog. It is a label, not a guarantee.
- Not verified: a real invoice, `PostModelSwitch` in your install, subagents and scheduled runs, raw Carbon/Argon price (inferred).

> Model detection from the `--model` flag of the claude process reads `/proc`, so it works on Linux only. On macOS and Windows that source is simply absent: the gate then relies on the other sources (tracker, transcript, declared model, `PRECOST_MODEL`) and otherwise uses the worst case, which is the safe direction.

## Hook failure in the Claude Code plugin (Linux)

`npm run e2e:claude-plugin-failure` (real Claude Code 2.1.332, `--plugin-dir`, fake server, no spend): a script crash, a missing `node` and a hook timeout do NOT let the prompt reach the model (`onFailure: block`). Negative control: with `onFailure: continue` the prompt goes through.

Note on the e2e scripts: the Claude mock server listens on the fixed port 4590 on 127.0.0.1. After an aborted run, stop the leftover mock process before running again, or the next run can fail for that reason.
