import test from 'node:test';
import assert from 'node:assert/strict';

import { MIGRATIONS, runStateMigrations } from './stateMigrations.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function withMigrations(entries, run) {
  const before = MIGRATIONS.splice(0, MIGRATIONS.length);
  MIGRATIONS.push(...entries);
  try {
    return run();
  } finally {
    MIGRATIONS.splice(0, MIGRATIONS.length);
    MIGRATIONS.push(...before);
  }
}

test('migrations run once, are recorded, and never repeat', () => {
  const storage = fakeStorage({ 'old:key': 'value' });
  let runs = 0;
  withMigrations([{
    id: '2026-09-old-key-rename',
    run(store) {
      runs += 1;
      const old = store.getItem('old:key');
      if (old !== null) {
        store.setItem('new:key', old);
        store.removeItem('old:key');
      }
    },
  }], () => {
    assert.deepEqual(runStateMigrations(storage), ['2026-09-old-key-rename']);
    assert.equal(storage.getItem('new:key'), 'value');
    assert.equal(storage.getItem('old:key'), null);
    assert.deepEqual(runStateMigrations(storage), [], 'second load skips it');
    assert.equal(runs, 1);
  });
});

test('a throwing migration is skipped without blocking the rest, and retries next load', () => {
  const storage = fakeStorage();
  let secondRan = 0;
  withMigrations([
    { id: 'bad', run() { throw new Error('boom'); } },
    { id: 'good', run() { secondRan += 1; } },
  ], () => {
    assert.deepEqual(runStateMigrations(storage), ['good']);
    assert.equal(secondRan, 1);
    // 'bad' was not recorded, so a later load retries it (and fails again,
    // harmlessly); 'good' stays done.
    assert.deepEqual(runStateMigrations(storage), []);
    assert.equal(secondRan, 1);
  });
});

test('corrupt ledger and missing storage are tolerated', () => {
  const storage = fakeStorage({ 'gev:migrations:v1': '{not json' });
  withMigrations([{ id: 'x', run() {} }], () => {
    assert.deepEqual(runStateMigrations(storage), ['x']);
  });
  assert.deepEqual(runStateMigrations(null), []);
});
