import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadBuildInfo } from './buildInfo.mjs';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-root-'));
  fs.mkdirSync(path.join(root, 'server'));
  return root;
}

test('falls back to package.json when no build-info.json is baked', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  const info = loadBuildInfo({ root, env: {} });
  assert.equal(info.version, '9.9.9');
  assert.equal(info.sha, null);
  assert.deepEqual(info.notes, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('prefers the baked build-info.json and tolerates malformed notes', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.0.1' }));
  fs.writeFileSync(path.join(root, 'server', 'build-info.json'), JSON.stringify({
    version: '1.2.3', sha: 'abc1234', builtAt: '2026-09-18T00:00:00Z', notes: 'not-an-array',
  }));
  const info = loadBuildInfo({ root, env: {} });
  assert.equal(info.version, '1.2.3');
  assert.equal(info.sha, 'abc1234');
  assert.equal(info.builtAt, '2026-09-18T00:00:00Z');
  assert.deepEqual(info.notes, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('environment sha fills in when the build did not record one', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.0.1' }));
  const info = loadBuildInfo({ root, env: { GEV_GIT_SHA: 'envsha00' } });
  assert.equal(info.sha, 'envsha00');
  fs.rmSync(root, { recursive: true, force: true });
});

test('repo checkout resolves the real package version', () => {
  const info = loadBuildInfo({ env: {} });
  assert.match(info.version, /^\d+\.\d+\.\d+/);
});
