# Upstream sync (AGI fork)

This repo is a fork of the active upstream project
[`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view).
Upstream moves quickly; sync monthly (or after notable upstream releases).

## Procedure

```bash
git remote add upstream https://github.com/bilawalsidhu/gods-eye-view.git  # once
git fetch upstream main
git checkout -b upstream-sync origin/main
git merge upstream/main        # merge, never rebase — keeps fork history intact
# resolve conflicts (see mapping table below), run the gates:
npm ci && npm test && npm run build
git push -u origin upstream-sync
# open a PR into main
```

## Conflict guide: `vite.config.js` → `server/`

The AGI fork extracts the API middlewares out of `vite.config.js` into
`server/` so a production container can serve them (upstream keeps them
inline). Upstream diffs that touch `vite.config.js` proxy bodies must be
re-applied to the matching extracted file. Maintain this table as extraction
proceeds:

| Upstream location (vite.config.js) | Fork location |
|---|---|
| shared helpers (body reading, rate limit, SSRF guards) | `server/lib/*.mjs` |
| per-proxy plugin bodies | `server/proxies/<name>.mjs` |
| `defineConfig` tail | stays in `vite.config.js` |

Rules that keep conflicts small:

- Extracted code is moved **verbatim** (names, JSDoc, comments untouched), so
  upstream hunks usually apply cleanly to the new file path with `git apply
  --3way` or by hand.
- Never reformat extracted code while syncing.
- `style.css` token derivation (theming) is a small edit at the top `:root`
  block; re-apply it if upstream rewrites that block.

## What stays fork-local

- `server/`, `Dockerfile`, `fly.*.toml`, `.github/workflows/deploy-*.yml`,
  `docs/agi/`, theming token files, CODEOWNERS, issue/PR templates,
  `package.json` repository/homepage/bugs fields.
