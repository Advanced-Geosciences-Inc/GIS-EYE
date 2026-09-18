import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURE_LAYER_IDS,
  disabledLayerIds,
  installFeatureGate,
  loadRuntimeConfig,
  resetRuntimeConfigForTests,
} from './runtimeConfig.js';

function fakeManager() {
  const guards = new Set();
  const enabled = new Set();
  return {
    guards,
    enabled,
    addVisibilityGuard(cb) {
      guards.add(cb);
      return () => guards.delete(cb);
    },
    isEnabled(id) {
      return enabled.has(id);
    },
    setEnabled(id, on) {
      if (on) enabled.add(id);
      else enabled.delete(id);
    },
  };
}

test('loadRuntimeConfig parses a healthy response and caches it', async () => {
  resetRuntimeConfigForTests();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ ok: true, version: '0.1.1', base: '/portal/gis/', features: { opensky: false } }),
    };
  };
  const first = await loadRuntimeConfig({ fetchImpl });
  const second = await loadRuntimeConfig({ fetchImpl });
  assert.equal(first.ok, true);
  assert.equal(first.base, '/portal/gis/');
  assert.equal(first.features.opensky, false);
  assert.equal(second, first);
  assert.equal(calls, 1);
  resetRuntimeConfigForTests();
});

test('loadRuntimeConfig fails open on network errors and bad payloads', async () => {
  resetRuntimeConfigForTests();
  const failed = await loadRuntimeConfig({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(failed.ok, false);
  assert.deepEqual(disabledLayerIds(failed), []);
  resetRuntimeConfigForTests();

  const badJson = await loadRuntimeConfig({ fetchImpl: async () => ({ ok: true, json: async () => 'nope' }) });
  assert.equal(badJson.ok, false);
  resetRuntimeConfigForTests();
});

test('disabledLayerIds maps only explicitly-false features', () => {
  const ids = disabledLayerIds({ features: { opensky: false, cables: true, datacenters: undefined } });
  assert.deepEqual(ids, FEATURE_LAYER_IDS.opensky.slice());
  assert.deepEqual(disabledLayerIds({ features: {} }), []);
  assert.deepEqual(disabledLayerIds(null), []);
});

test('installFeatureGate vetoes enables, forces off, and is a no-op when nothing is disabled', () => {
  const manager = fakeManager();
  manager.enabled.add('flights');

  const remove = installFeatureGate(manager, { features: { opensky: false } }, { documentRef: null });
  assert.equal(manager.guards.size, 1);
  assert.equal(manager.enabled.has('flights'), false, 'already-on layer forced off');

  const [guard] = manager.guards;
  const veto = guard({ layerId: 'flights', enabled: true });
  assert.match(veto.reason, /disabled on this deployment/);
  assert.equal(guard({ layerId: 'flights', enabled: false }), null);
  assert.equal(guard({ layerId: 'earthquakes', enabled: true }), null);

  remove();
  assert.equal(manager.guards.size, 0);

  const untouched = fakeManager();
  installFeatureGate(untouched, { features: { opensky: true } }, { documentRef: null });
  assert.equal(untouched.guards.size, 0, 'all-enabled config installs nothing');
});
