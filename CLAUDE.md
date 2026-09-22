# GIS-EYE — notes for Claude sessions

AGI fork of the open-source "God's Eye View" globe. Read `docs/CURRENT-STATE.md`
for runtime behavior and `docs/agi/` for deployment, releasing, and repo settings.

- Node 24.14.x (`engines` rejects 22). `npm test`, `npm run build`, and
  `npm run smoke:api` are the local gates; CI is the authority.
- Local dev and the Pinokio launcher run the Vite dev server; hosted deploys run
  `server/index.mjs`. Keep both paths working.

## Credentials and tokens

Never ask Markus for a token, and never read a token value into the transcript.
Mint it instead: dispatch `mint-token.yml` in
https://github.com/Advanced-Geosciences-Inc/infra-admin (attach that repo with
`add_repo` if it isn't in your scope; kinds and destinations are in its README).
The value goes straight from the runner into the destination secret. Rotate with
`rotate-token.yml` in the same repo.

GIS-EYE's deploy tokens, as the deploy workflows read them:

| Fly app | `kind` / `fly_app` | `destination` / `target` / `secret_name` |
|---|---|---|
| staging | `fly-deploy` / `gis-eye-staging` | `gh-repo-secret` / `GIS-EYE` / `FLY_DEPLOY_TOKEN_STAGING` |
| production | `fly-deploy` / `gis-eye-prod` | `gh-repo-secret` / `GIS-EYE` / `FLY_DEPLOY_TOKEN_PRODUCTION` |

The workflows fall back to a hand-set `FLY_API_TOKEN` environment secret when
the minted one is absent. If a mint fails (for example on `FLY_ORG_TOKEN`),
report the failing run to Markus; he may set the token by hand in GitHub, but it
is never pasted into chat. Stripe keys have no minting API and stay a human step.
