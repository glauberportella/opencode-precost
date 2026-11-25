**English** | Português: [CAPACIDADES.md](CAPACIDADES.md) (historical log, longer)

# What each client really allows

Status as of 2026-11-25. VERIFIED = run against the real software. DOC = documentation or types only. No paid model was called.

## Honest summary

- **OpenCode does not preview cost before the model on its own.** This plugin computes the preview inside the `chat.message` hook, which runs before the model.
- **The tool gate (`tool.execute.before` plus a session limit) is not a spending cap.** By the time a tool is requested the model has already been called and billed. Only the prompt gate acts before the first spend of a task, and it does not limit spend inside an approved task.
- Neither gate stops long loops started by an approved prompt.

| Capability | OpenCode 1.19.6 (plugin V1) | Claude Code (hooks) |
|---|---|---|
| Plugin/hook loads | VERIFIED (`opencode serve` listed the `precost_estimate` tool; shim + npm package also verified) | VERIFIED with 2.1.332 (`--plugin-dir`, fake server) |
| Hook receives the prompt before the model | VERIFIED (`chat.message` fired with the real prompt before any processing event) | VERIFIED (`UserPromptSubmit` gets `prompt`, `session_id`, `transcript_path`, `cwd`) |
| Block a prompt | VERIFIED: throwing in `chat.message` keeps the prompt out of the session (0 messages) and away from the model. Undocumented behavior; the client sees a generic error, the TUI shows the text in an error box | VERIFIED: `{"decision":"block","reason":...}` blocks; the model server counter stayed at 0; text visible in `claude -p` and in the interactive TUI |
| Block, approve, resend, single use | VERIFIED on a real server: messages 0, 0, 0, 1, 1 | VERIFIED with real client and fake server (1 model call after approval, blocked again on the next resend) |
| Active model | `chat.message` receives `input.model.modelID` | The event does **not** carry the model. Tracked by `SessionStart.model` (optional) and `PostModelSwitch.to_model`; otherwise by the last transcript response, the process `--model` flag (Linux only), declared sources, or the worst case |
| Real spend per message | `message.updated` of the assistant carries `cost` and `tokens` (checked against a fake provider) | transcript `usage` fields (checked against a fake server) |
| Automatic prompts | n/a | DOC: `UserPromptSubmit` also fires for scheduled tasks, background subagents and messages from other sessions; the gate can block them |

## Approval (explicit and bound)

Resending the same prompt never approves it. To approve, type `precost approve CODE` (a random code for the pending block). The approval binds prompt, model, session, price table hash, limit and estimated ceiling. It lasts a TTL (default 10 minutes), works once, and `precost revoke CODE|all` revokes it. Any change to those items invalidates it.

## Estimator limits

- The observed input is characters. Tokens = chars/4. System/tool overhead is an assumption (8k OpenCode, 13k Claude Code, derived from measured request body size).
- Without history (fewer than 5 sessions of the same model and project): three fixed scenarios with assumptions, not measurements. With history: P25/P50/P75 aggregates.
- Claude 4.7+ tokenizer: observed tokens x1.3 (approximate, from the official note). All new input is priced as 5-minute cache write (conservative, may overestimate).
- Long context: `none` (no tier on the page), an object (e.g. 3.1 Pro, Haiku 5.5 at 100K) or `unknown` (Gemini 4: only a lower bound, requires approval).
- Price table: official pages read on 2026-11-25 (Standard, Global). Not modeled: Batch, Priority, Flex, Fast mode, data residency (1.1x). Raw Carbon/Argon price is inferred (the page describes 50% credits back); the gate uses the raw price. Access to those models on a given account was not verified.

## Safety model

- Approval state lives in files of the same user (`~/.cache/precost`, Windows `%LOCALAPPDATA%\precost\state`). An agent with a shell or write access as that user can forge an approval or read the code. The gate protects against accidental spend, not an adversarial agent.
- `precost approve` is accepted only as typed user prompt text. The local CLI approves nothing; `precost last` only shows the last block.
- **Fail closed** (when `limitUsd` is set): a non-numeric or negative limit, invalid TTL, unreadable config or price table, internal error, unreadable hook input, unknown or unpriced model, a cost with only a lower bound, or a context file that could not be counted (large, outside the project, secret) all block and ask for approval or a fix. Without `limitUsd` the tool only informs and says "NO GATE".
- **Hook failure** (Claude Code): with `onFailure: "block"`, a script crash, missing `node` or timeout never reaches the model (real client, negative control included). Without it, or with `continue`, the prompt goes through.
- **OpenCode:** depends on undocumented throw behavior, so the version is pinned to 1.19.6 (read from `/global/health` or the binary); a different or unknown version blocks unless `allowUnverifiedVersion: true`.
- Files referenced in a prompt (`@path` in Claude Code, `file` parts in OpenCode) are read inside the project, counted in the estimate, and their content hash is part of the approval. Ignored files (secret, large) are not read; their size+mtime signature binds the approval (a change that preserves both is not detected).

## Model resolution in Claude Code

The hook does not receive the model. Chain: `PRECOST_MODEL` (an operator declaration, treated as proven, but it does not force the request) > tracker > last transcript response > process `--model` flag (observed: they do not prove the model of the next prompt after `/model`) > `ANTHROPIC_MODEL`, settings, `config.model` (declared). An unproven model uses the worst case across all candidate `claude-*` models and says so; the approval is bound to that state. Conflicting declared sources are never proven. `trustConfiguredModel: true` accepts a single consistent observed/declared model, except when the transcript records a `/model` after the last response (then the worst case applies).

## History

With at least 5 sessions of the same model and project, the preview uses real consumption. The peak per call is the largest recorded (not a quantile). Each compared line uses only its own model's history. Token semantics were checked against real events and transcripts with fake providers: `input` excludes cache. No comparison with a real invoice has been made.

## Not verified

Real invoice comparison, `PostModelSwitch` in a user install, subagents and scheduled runs, raw Carbon/Argon price, approval flow visuals in the OpenCode TUI beyond the tested pty cycle, and real end-to-end use on macOS and Windows (see the matrix in INSTALLATION.md).
