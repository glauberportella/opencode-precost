# Price table: how it is published and updated

`precost` ships a bundled table (`data/prices.json`). Prices change, so the estimate is only as good as the table date.
`precost prices` shows the table in use, its date and age. After 30 days it prints a warning.

## For users

```sh
precost update-prices            # shows the diff against the table in use; writes nothing
precost update-prices --yes      # applies it (stored next to the config; pending approvals become invalid)
precost update-prices --reset    # back to the bundled table
```

- Default source: `https://raw.githubusercontent.com/glauberportella/opencode-precost/main/data/prices.json`
  (the table on `main` of the project repository). It works only after the repository is public. Before that the command
  fails with an HTTP error, keeps the current table, and exit code is 1.
- Other source: `--from HTTPS_URL|FILE` or `PRECOST_PRICES_SOURCE`. Remote sources must be https.
- Safety checks before anything is written: valid JSON under 1 MB, every model has an https `source`, a table older than
  the current one is refused (`--force` overrides), and removed models or changes above 5x need `--force`.
- A newer table is only used if valid; an invalid one never replaces the current one.

## For the maintainer

1. Check each model price in the vendor's official pricing page. Put that page in the model's `source` and the check date in `read`.
2. Edit `data/prices.json`, run `npm test`, commit to `dev/*`, merge to `main`. The raw URL above serves `main`, so merging is publishing.
3. Check with `precost update-prices --from data/prices.json` (diff only) before merging.
4. Do this at least every 30 days. Older tables warn every user.

The table is an estimate input, not an official price list. The project does not guarantee that prices are current.
