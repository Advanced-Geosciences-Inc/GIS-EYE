#!/usr/bin/env node
/**
 * Cut a release from CHANGELOG.md (see docs/agi/RELEASING.md).
 *
 *   node scripts/release-notes.mjs --version 0.2.0
 *
 * - Moves the CHANGELOG [Unreleased] content under `## [<version>] — <date>`
 * - Bumps package.json/package-lock.json via `npm version --no-git-tag-version`
 * - Writes release-notes.json ({version, date, notes}) at the repo root; the
 *   Docker build bakes it into server/build-info.json for /api/version and
 *   the in-app update toast.
 *
 * Commits nothing — the release workflow reviews the diff in a PR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cutRelease } from '../server/lib/releaseNotes.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const versionFlag = process.argv.indexOf('--version');
const version = versionFlag !== -1 ? process.argv[versionFlag + 1] : null;
if (!version) {
  console.error('Usage: node scripts/release-notes.mjs --version <x.y.z>');
  process.exit(2);
}

const changelogPath = path.join(root, 'CHANGELOG.md');
const date = new Date().toISOString().slice(0, 10);
const { changelog, notes } = cutRelease(fs.readFileSync(changelogPath, 'utf8'), version, date);

const bump = spawnSync('npm', ['version', version, '--no-git-tag-version'], {
  cwd: root,
  stdio: 'inherit',
});
if (bump.status !== 0) process.exit(bump.status ?? 1);

fs.writeFileSync(changelogPath, changelog);
fs.writeFileSync(
  path.join(root, 'release-notes.json'),
  `${JSON.stringify({ version, date, notes }, null, 2)}\n`,
);

console.log(`[release-notes] v${version}: ${notes.length} note(s) cut from CHANGELOG [Unreleased]`);
