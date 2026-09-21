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

## Conflict guide: `vite.config.js`

The fork deliberately does NOT extract the proxy middlewares out of
`vite.config.js`. The production server (`server/app.mjs`) imports the
config's default export, calls the factory, and installs every plugin whose
name matches `-proxy`/`-proxies` onto a plain connect app — so upstream's
file stays upstream-shaped and merges cleanly. The fork's only edits inside
`vite.config.js` are:

- one import of `./server/mw/meta.mjs` and the `gevRuntimeMeta()` entry in
  the plugins array (dev/preview parity for `/healthz`, `/api/config`,
  `/api/version`);
- `base: env.GEV_BASE || '/'` in the returned config.

When syncing, keep those three small hunks and take upstream's version of
everything else. Two invariants to re-check after every sync (the server
tests cover both): new upstream proxy plugins must follow the `-proxy` name
suffix to be served in production (server/app.mjs `INSTALL_NAME`), and
`gev-key-setup` must stay out of the installed set.

Other recurring fork hunks:

- Client `/api/*` fetches go through `apiUrl()` from `src/basePath.js`; wrap
  any new upstream call sites during the sync (grep `'/api/` in `src/`).
- `style.css` token derivation (theming) is a small edit at the top `:root`
  block; re-apply it if upstream rewrites that block.

## What stays fork-local

- `server/`, `Dockerfile`, `fly.*.toml`, `.github/workflows/deploy-*.yml`,
  `docs/agi/`, theming token files, CODEOWNERS, issue/PR templates,
  `package.json` repository/homepage/bugs fields.
