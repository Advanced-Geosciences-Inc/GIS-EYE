import test from 'node:test';
import assert from 'node:assert/strict';

import { cutRelease, extractUnreleased, parseNotes } from './releaseNotes.mjs';

const SAMPLE = `# Changelog

Intro text.

## [Unreleased]

### Changed

- One change entry
  that wraps onto a second line.

### Fixed

- A fix.
- Another fix.

## [0.1.1] — 2026-09-01 — Old release

- old content
`;

test('extractUnreleased returns only the unreleased body', () => {
  const { body } = extractUnreleased(SAMPLE);
  assert.match(body, /One change entry/);
  assert.ok(!body.includes('old content'));
});

test('parseNotes groups bullets by subheading and folds continuations', () => {
  const notes = parseNotes(extractUnreleased(SAMPLE).body);
  assert.deepEqual(notes, [
    { type: 'changed', text: 'One change entry that wraps onto a second line.' },
    { type: 'fixed', text: 'A fix.' },
    { type: 'fixed', text: 'Another fix.' },
  ]);
});

test('cutRelease moves content under the new version and empties Unreleased', () => {
  const { changelog, notes } = cutRelease(SAMPLE, '0.2.0', '2026-09-18');
  assert.equal(notes.length, 3);
  assert.match(changelog, /## \[Unreleased\]\n\n## \[0\.2\.0\] — 2026-09-18\n/);
  assert.match(changelog, /## \[0\.1\.1\] — 2026-09-01/);
  const secondCut = () => cutRelease(changelog, '0.3.0', '2026-09-19');
  assert.throws(secondCut, /no entries/);
});

test('cutRelease validates the version shape', () => {
  assert.throws(() => cutRelease(SAMPLE, 'v0.2', '2026-09-18'), /semver/);
});

test('the real CHANGELOG.md parses', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const notes = parseNotes(extractUnreleased(text).body);
  assert.ok(notes.length > 0);
  for (const note of notes) {
    assert.ok(['added', 'changed', 'fixed', 'security', 'note'].includes(note.type), note.type);
  }
});
