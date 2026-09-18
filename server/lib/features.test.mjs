import test from 'node:test';
import assert from 'node:assert/strict';

import { FEATURES, parseFlag, resolveFeatures } from './features.mjs';

test('parseFlag treats unset and unrecognized values as the default', () => {
  assert.equal(parseFlag(undefined), true);
  assert.equal(parseFlag(''), true);
  assert.equal(parseFlag('maybe'), true);
  assert.equal(parseFlag(undefined, false), false);
});

test('parseFlag understands the usual truthy/falsy spellings', () => {
  for (const value of ['0', 'false', 'off', 'no', 'OFF', ' False ']) {
    assert.equal(parseFlag(value), false, value);
  }
  for (const value of ['1', 'true', 'on', 'yes', 'ON']) {
    assert.equal(parseFlag(value), true, value);
  }
});

test('resolveFeatures defaults everything on and honors env overrides', () => {
  const all = resolveFeatures({});
  for (const feature of FEATURES) assert.equal(all[feature.key], true, feature.key);

  const gated = resolveFeatures({ GEV_FEATURE_OPENSKY: '0', GEV_FEATURE_DAMS: 'off' });
  assert.equal(gated.opensky, false);
  assert.equal(gated.dams, false);
  assert.equal(gated.cables, true);
});

test('license-gated features cover the layers DATA_SOURCES.md flags', () => {
  const keys = new Set(FEATURES.map((feature) => feature.key));
  for (const key of ['opensky', 'cables', 'datacenters', 'dams']) {
    assert.ok(keys.has(key), key);
  }
});
