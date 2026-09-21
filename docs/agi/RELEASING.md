# Releasing (AGI fork)

## Version scheme

Continue upstream's `0.x` line with fork tags (`v0.2.0`, `v0.3.0`, …).
Upstream has published no git tags, so there is no collision; the CHANGELOG's
"Pre-release development history" section explains the early numbering.

## Release flow

1. Ensure `main` is green and `CHANGELOG.md` `[Unreleased]` reflects
   everything shipping.
2. Run the `release` workflow (Actions → release → Run workflow) with the new
   version. It moves the `[Unreleased]` content under a `## [x.y.z] — date`
   heading, bumps `package.json`, and opens a release PR.
3. Merge the release PR; the workflow tags `vx.y.z` and publishes a GitHub
   Release whose notes are that CHANGELOG section.
4. Publishing the Release triggers `deploy-production` (with the
   `production` environment's required-reviewer approval as the gate).

The published release notes are also what the in-app update toast shows to
users of the hosted deployment, so write `[Unreleased]` entries as
user-readable improvements/fixes, not commit messages.

## Hotfix / rollback

- Rollback: re-run `deploy-production` via workflow dispatch with the
  previous image digest (recorded in each deploy run's log).
- Hotfix: branch from `main`, fix, PR, merge, cut a patch release as above.
