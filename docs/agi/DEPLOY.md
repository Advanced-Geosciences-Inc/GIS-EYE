# Deployment (AGI hosted GIS-EYE)

Architecture: GitHub Actions builds a container (Dockerfile) that runs
`server/index.mjs` — the same API middlewares the dev server mounts (imported
from vite.config.js's plugin factories) plus the built client — on Fly.io,
fronted by Cloudflare on `geostack.com/portal/gis`.

```
merge to main ──▶ deploy-staging.yml ──▶ gis-eye-staging.fly.dev  (auto)
publish Release ─▶ deploy-production.yml ─▶ gis-eye-prod.fly.dev  (approval-gated,
                   promotes the staging-validated image, blue/green, auto-rollback)
```

## One-time setup

### Fly.io

```bash
fly apps create gis-eye-staging
fly apps create gis-eye-prod
```

Deploy tokens are minted by `mint-token.yml` in
[infra-admin](https://github.com/Advanced-Geosciences-Inc/infra-admin) with
`kind=fly-deploy`, `destination=gh-repo-secret`, `target=GIS-EYE`:
`fly_app=gis-eye-staging` → `FLY_DEPLOY_TOKEN_STAGING`, and
`fly_app=gis-eye-prod` → `FLY_DEPLOY_TOKEN_PRODUCTION`. The value never leaves
the runner. Fallback when minting is unavailable: create the token with
`fly tokens create deploy -a <app>` and store it as the `FLY_API_TOKEN` secret
of the matching GitHub environment; the workflows read the minted secret first.

Runtime secrets (per app; never GitHub secrets):

```bash
fly secrets set -a gis-eye-prod \
  OPENAI_API_KEY=… \
  AISSTREAM_API_KEY=… \
  TOMTOM_API_KEY=… \
  FIRMS_MAP_KEY=… \
  LL2_API_TOKEN=… \
  OPENSKY_CLIENT_ID=… OPENSKY_CLIENT_SECRET=…   # only once the license is cleared
```

(Repeat for staging, ideally with separate keys/quotas. Variable names match
`.env.example`.)

### GitHub

Per `docs/agi/REPO-SETTINGS.md`: create the `staging` and `production`
environments (production with a required reviewer), the Fly deploy tokens
above, and repository secrets `GOOGLE_MAPS_API_KEY` /
`CESIUM_ION_TOKEN` (build-time, client-exposed by design — restrict by HTTP
referrer to the hosted origin).

### Cloudflare (geostack.com)

- Route `geostack.com/portal/gis*` to the Fly app: an Origin Rule (or Worker)
  that rewrites the host to `gis-eye-prod.fly.dev` and forwards the full
  path. The server accepts prefixed and bare paths alike (server/app.mjs
  `baseStrip`), so either a path-preserving or path-stripping proxy works.
- Cache rule: bypass cache for `geostack.com/portal/gis/api/*`; cache
  `/portal/gis/assets/*` (immutable, content-hashed).
- Do not publicly route `/healthz` beyond Fly's own checks if avoidable.

## Environment reference (fly.*.toml)

- `GEV_BASE=/portal/gis/` — deployment path prefix (also baked into asset
  URLs at image build via the workflow's `--build-arg GEV_BASE`).
- `GEV_FEATURE_OPENSKY=0`, `GEV_FEATURE_CABLES=0` — license-gated layers stay
  off on hosted deploys until cleared (DATA_SOURCES.md; OpenSky is
  non-commercial without a written agreement, TeleGeography cables are
  NonCommercial). Flip to `1` per app when cleared.
- `GEV_RATELIMIT_OPENAI_PER_MIN` / `GEV_RATELIMIT_GOOGLE_PER_MIN` — the
  upstream limiters are opt-in and UNLIMITED when unset; hosted deploys must
  always set them. Behind Cloudflare/Fly they key on the proxy socket, so
  they act as a blunt PER-MACHINE GLOBAL ceiling (a billing backstop), not a
  per-user limit — per-tenant fairness comes from the quota store below.
- **Portal SSO** (`server/lib/auth.mjs`): `GEV_AUTH_MODE` `none|hs256|jwks`
  with `GEV_JWT_ISSUER`, `GEV_JWT_AUDIENCE` (default `gis-eye`),
  `GEV_JWT_JWKS_URL` or secret `GEV_JWT_HS256_SECRET`, `GEV_JWT_COOKIE`
  (default `gev_session`), `GEV_LOGIN_URL`. The portal signs a short-lived
  JWT (claims: `sub`, `org`, `entitlements`) delivered as an HttpOnly cookie
  scoped to `/portal/gis`; unauthenticated documents 302 to the login URL,
  API calls get 401. `/healthz`, `/api/config`, `/api/version` stay open.
- **Per-tenant quotas** (`server/lib/quota.mjs`): set secrets
  `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` and budgets
  `GEV_QUOTA_{OPENAI,GOOGLE,TOMTOM}_{PER_MIN,PER_DAY}`. Atomic fixed windows
  shared across machines (blue/green safe), keyed org → sub → edge IP;
  outage fails open with one logged warning. `/api/usage` reports the
  caller's counters.

## Deploying

- **Staging**: merge to `main`. The workflow builds an image labeled
  `sha-<commit>`, deploys, and smoke-tests (`scripts/smoke-remote.mjs`).
- **Production**: publish a release (docs/agi/RELEASING.md). The workflow
  waits for the production environment approval, deploys the exact
  `registry.fly.io/gis-eye-staging:sha-<release commit>` image blue/green
  (health-checked before traffic moves), smoke-tests, and rolls back to the
  previous image automatically if the smoke test fails.
- **Manual rollback / hotfix image**: run "Deploy production" via workflow
  dispatch with any previously validated image reference.

## Verifying locally

```bash
npm run build && npm run serve:prod     # http://localhost:8080
npm run smoke:api                       # API surface invariants
docker build -t gis-eye . && docker run -p 8080:8080 gis-eye
```

## Operational notes

- The app is stateless: `.gev-cache` is per-machine and disposable; no Fly
  volumes (that's what keeps blue/green safe). The TomTom daily budget
  (`GEV_TOMTOM_*`, `.gev-cache/tomtom/budget.json`) is therefore per-machine —
  size budgets accordingly (multiply by machine count).
- Each machine holds its own AISStream connection; confirm the AISStream plan
  allows as many concurrent connections as production machines, or keep the
  AIS layer scoped down.
- `min_machines_running=2` on prod; Fly health checks gate blue/green cutover
  via `/healthz`.
