# Repository settings runbook (AGI fork)

Settings that live in GitHub's UI/API rather than in this repo. Applying them
requires org-admin rights on `Advanced-Geosciences-Inc/GIS-EYE`.

## Actions

- Settings → Actions → General: allow GitHub Actions (required for CI and the
  deploy workflows). The first merged PR proves the pipeline.

## Branch protection for `main`

Settings → Branches → Add rule for `main` (or a repository ruleset):

- Require a pull request before merging (no direct pushes).
- Require review from Code Owners (see `.github/CODEOWNERS`).
- Dismiss stale approvals when new commits are pushed.
- Require status checks to pass, and require branches to be up to date.
  Required checks: `Node 24.14.0`, `Node 26.x`, `Windows onboarding`
  (add `docker-smoke` once the deployment pipeline lands).
- Block force pushes and deletions.

Via CLI with an admin token, the equivalent is
`gh api -X PUT repos/Advanced-Geosciences-Inc/GIS-EYE/branches/main/protection`
with the matching JSON payload.

## Environments (for the deploy pipeline)

Settings → Environments:

- `staging` — no required reviewers. Secrets: `FLY_API_TOKEN` (deploy token
  scoped to the staging Fly app).
- `production` — required reviewer: at least one CODEOWNER. Secrets:
  `FLY_API_TOKEN` (deploy token scoped to the production Fly app).

Promotion to production is gated by the environment's required-reviewer
approval on the `deploy-production` workflow run.

## Repository secrets (build-time)

Settings → Secrets and variables → Actions (repository scope):

- `GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN` — these two are deliberately
  client-exposed (inlined into the bundle at build time via Vite `define`;
  see `.env.example`). Restrict them by HTTP referrer in the provider consoles
  to the hosted origin before the first public deploy.

All other provider keys are runtime secrets on the Fly apps
(`fly secrets set …`), never GitHub secrets — see `docs/agi/DEPLOY.md` once
the pipeline lands.
