# Distribution (maintainer notes)

Status: `opencode-precost@0.3.2` is published on npm (https://www.npmjs.com/package/opencode-precost). The repository's own Claude Code marketplace works from GitHub. Nothing is submitted to the Anthropic directory or an OpenCode list yet.

## Claude Code: own marketplace (this repository)

`.claude-plugin/marketplace.json` makes the repository itself a marketplace (`precost-marketplace`, plugin `precost`).

```sh
claude plugin validate .            # before every release
claude plugin marketplace add glauberportella/opencode-precost
claude plugin install precost@precost-marketplace
```

Checked from the public repository: `scripts/claude-marketplace-e2e.sh` installs it with Claude Code 2.1.332 into an isolated home and runs block, approve, single use and fail closed against a local mock model (Linux x64, `-p` mode; not run in CI).
This is a self-hosted marketplace. It is not the Anthropic directory and does not appear there.

## Claude Code: Anthropic directory (optional, separate)

Submit through claude.ai/directory/manage ("Plugin bundle"). Needs a GitHub repo you can push to, a connected GitHub
account, and a plan/role allowed to submit. The directory scans one commit, asks listing and data-handling answers,
and requires compliance with the Anthropic Software Directory Terms and Policy. The repository can be private while
validating and must be public before the listing goes live. Read the current pre-submission checklist first.

## OpenCode

- Local/shim: copy the shim into `.opencode/plugins/` (see INSTALLATION.md). Verified on OpenCode 1.19.6.
- npm (registry install checked on Linux x64 only): on OpenCode 1.19.6 (checked with `opencode debug config`),
  the config key that is honored is `plugin`; `plugins` (shown on the current opencode.ai docs page) is ignored, and
  there is no `opencode plugin add` subcommand (only `opencode plugin <module>`, which installs and edits the config).
  Re-test with the real published package and the exact OpenCode version before documenting an npm install command.
  npm publishing: the owner's account has no 2FA, so `npm publish` needs a granular token with 2FA bypass (npm is restricting those) or 2FA enabled on the account. 0.3.2 was published once with a temporary token that was revoked right after.
- Community lists: pull request to awesome-opencode, form at opencode.im/submit.
- Pinned to OpenCode 1.19.6. Re-test on each OpenCode release before widening the peer range.

## Release checklist

1. `npm test`, e2e scripts, CI green on Linux, Windows and macOS (see the matrix in INSTALLATION.md).
2. Refresh `data/prices.json` (see PRICES.md).
3. Bump version in `package.json` and `.claude-plugin/plugin.json`, tag `vX.Y.Z`.
4. `claude plugin validate .`, `npm pack --dry-run` (check the file list), then publish.
