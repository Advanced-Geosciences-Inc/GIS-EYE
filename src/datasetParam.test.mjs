import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATASET_LAYER_ID,
  bboxOfFeatures,
  enableDatasetLayer,
  jsonlUrl,
  parseDatasetParam,
  withDatasetLayer,
} from './datasetParam.js';
import { DataLayerManager } from './data/manager.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';

const LOC = { href: 'https://geostack.com/globe/?x=1', hostname: 'geostack.com' };
const GOOD = 'https://geostack.com/gis/api/integrations/globe/geojson/abc.def';
const q = (u) => `?theme=dark&dataset=${encodeURIComponent(u)}`;

test('accepts the signed-link path on geostack.com, on the same host and on localhost', () => {
  assert.equal(parseDatasetParam(q(GOOD), LOC), GOOD);
  assert.ok(parseDatasetParam(q('https://stg.geostack.com/api/integrations/globe/geojson/t'), LOC));
  assert.ok(parseDatasetParam(q('http://localhost:8001/api/integrations/globe/geojson/t'), LOC));
  const other = { href: 'https://globe.example.org/', hostname: 'globe.example.org' };
  assert.ok(parseDatasetParam(q('https://globe.example.org/api/integrations/globe/geojson/t'), other));
});

test('rejects everything else', () => {
  const bad = [
    'https://evil.example/api/integrations/globe/geojson/t',
    'https://geostack.com.evil.example/api/integrations/globe/geojson/t',
    'http://geostack.com/api/integrations/globe/geojson/t',
    'https://geostack.com/other/path',
    'https://user:pw@geostack.com/api/integrations/globe/geojson/t',
    'javascript:alert(1)',
    'not a url at all',
  ];
  for (const u of bad) assert.equal(parseDatasetParam(q(u), LOC), null, u);
  assert.equal(parseDatasetParam('?theme=dark', LOC), null);
  assert.equal(parseDatasetParam('', LOC), null);
});

test('jsonlUrl keeps the token path and adds format=jsonl', () => {
  const u = new URL(jsonlUrl(GOOD));
  assert.equal(u.pathname, '/gis/api/integrations/globe/geojson/abc.def');
  assert.equal(u.searchParams.get('format'), 'jsonl');
});

test('bboxOfFeatures walks points, lines and polygons', () => {
  assert.equal(bboxOfFeatures([]), null);
  assert.equal(bboxOfFeatures([{ geometry: null }]), null);
  const box = bboxOfFeatures([
    { geometry: { type: 'Point', coordinates: [-122.1, 37.2] } },
    { geometry: { type: 'LineString', coordinates: [[-121.9, 37.5], [-122.4, 37.0]] } },
    { geometry: { type: 'Polygon', coordinates: [[[-122, 37.1], [-122, 37.6], [-121.5, 37.6]]] } },
  ]);
  assert.deepEqual(box, [-122.4, 37.0, -121.5, 37.6]);
});

test('withDatasetLayer is a no-op without ?dataset and seals cleanly with it', () => {
  const layers = [];
  const none = withDatasetLayer(layers, LAYER_STATE_REGISTRY, { search: '?theme=dark', loc: LOC });
  assert.equal(none.layers, layers);
  assert.equal(none.registry, LAYER_STATE_REGISTRY);
  assert.equal(none.datasetUrl, null);

  const some = withDatasetLayer([], [], { search: q(GOOD), loc: LOC });
  assert.equal(some.layers.length, 1);
  assert.equal(some.layers[0].id, DATASET_LAYER_ID);
  assert.deepEqual(some.registry.map((e) => e.id), [DATASET_LAYER_ID]);
  const manager = new DataLayerManager();
  some.layers.forEach((l) => manager.register(l));
  assert.equal(manager.finalizeRegistrations(some.registry), true);
});

test('enableDatasetLayer enables the layer then flies to the data; a failed fetch is harmless', async () => {
  const calls = [];
  const manager = { setEnabled: async (...a) => calls.push(a) };
  const flights = [];
  const viewer = { camera: { flyTo: (o) => flights.push(o) } };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ features: [{ geometry: { type: 'Point', coordinates: [-122, 37] } }] }),
  });
  await enableDatasetLayer(manager, viewer, GOOD, { fetchImpl });
  assert.deepEqual(calls[0].slice(0, 2), [DATASET_LAYER_ID, true]);
  assert.equal(flights.length, 1);

  await enableDatasetLayer(manager, viewer, GOOD, { fetchImpl: async () => { throw new Error('offline'); } });
  await enableDatasetLayer(manager, viewer, null);
  assert.equal(flights.length, 1);
});
