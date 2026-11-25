# Distribution (maintainer notes)

Status: nothing below is published yet. `package.json` keeps `"private": true` until publication is approved.

## Claude Code: own marketplace (this repository)

`.claude-plugin/marketplace.json` makes the repository itself a marketplace (`precost-marketplace`, plugin `precost`).

```sh
claude plugin validate .            # before every release
claude plugin marketplace add glauberportella/opencode-precost
claude plugin install precost@precost-marketplace
```

Works once the repository is reachable by the user (public, or private with their GitHub access).
This is a self-hosted marketplace. It is not the Anthropic directory and does not appear there.

## Claude Code: Anthropic directory (optional, separate)

Submit through claude.ai/directory/manage ("Plugin bundle"). Needs a GitHub repo you can push to, a connected GitHub
account, and a plan/role allowed to submit. The directory scans one commit, asks listing and data-handling answers,
and requires compliance with the Anthropic Software Directory Terms and Policy. The repository can be private while
validating and must be public before the listing goes live. Read the current pre-submission checklist first.

## OpenCode

- Local/shim: copy the shim into `.opencode/plugins/` (see INSTALLATION.md). Verified on OpenCode 1.19.6.
- npm (NOT validated yet): the package must be published first. On OpenCode 1.19.6 (checked with `opencode debug config`),
  the config key that is honored is `plugin`; `plugins` (shown on the current opencode.ai docs page) is ignored, and
  there is no `opencode plugin add` subcommand (only `opencode plugin <module>`, which installs and edits the config).
  Re-test with the real published package and the exact OpenCode version before documenting an npm install command.
  Publishing also needs removing `private`, then `npm publish` from the owner's account with 2FA.
- Community lists: pull request to awesome-opencode, form at opencode.im/submit.
- Pinned to OpenCode 1.19.6. Re-test on each OpenCode release before widening the peer range.

## Release checklist

1. `npm test`, e2e scripts, CI green on Linux, Windows and macOS (see the matrix in INSTALLATION.md).
2. Refresh `data/prices.json` (see PRICES.md).
3. Bump version in `package.json` and `.claude-plugin/plugin.json`, tag `vX.Y.Z`.
4. `claude plugin validate .`, `npm pack --dry-run` (check the file list), then publish.
