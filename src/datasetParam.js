import * as Cesium from 'cesium';
import { createLocalGeoJsonLayer } from './data/localGeojson.js';

/**
 * `?dataset=<signed url>` handoff from Ultimate-GIS (docs/GLOBE_INTEGRATION.md there).
 *
 * Ultimate-GIS sends people here with a short-lived, signed link to one dataset's GeoJSON
 * (`.../api/integrations/globe/geojson/<token>`). This module turns that link into a layer
 * through the existing local-GeoJSON path (data/localGeojson.js) and flies the camera to it.
 *
 * Fork note: everything for this feature lives in this file, plus three lines in main.js
 * (the import, the withDatasetLayer() call, the enableDatasetLayer() call). Keep it that
 * way so upstream syncs stay clean (docs/agi/UPSTREAM-SYNC.md).
 *
 * The URL is client-supplied, so it is only fetched when it points at the signed-link path
 * on this deployment's own host or on geostack.com. Anything else is ignored.
 */

export const DATASET_LAYER_ID = 'dataset-handoff';
// Never serialized into share links (the share registry is static), so any unused token will do.
const DATASET_LAYER_TOKEN = 'z';
const SIGNED_PATH = '/api/integrations/globe/geojson/';
const TRUSTED_HOSTS = Object.freeze(['geostack.com']);
const LOCAL_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

/** The validated absolute dataset URL from `search`, or null. */
export function parseDatasetParam(search, loc = globalThis.location) {
  let raw;
  try {
    raw = new URLSearchParams(search || '').get('dataset');
  } catch {
    return null;
  }
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw, loc?.href || undefined);
  } catch {
    return null;
  }
  const local = LOCAL_HOSTS.includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password) return null;
  const host = url.hostname;
  const trusted = local
    || host === loc?.hostname
    || TRUSTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!trusted) return null;
  if (!url.pathname.includes(SIGNED_PATH)) return null;
  return url.toString();
}

/** The link in the one-Feature-per-line form the bundled-layer loader reads. */
export function jsonlUrl(datasetUrl) {
  const url = new URL(datasetUrl);
  url.searchParams.set('format', 'jsonl');
  return url.toString();
}

/** [west, south, east, north] over every coordinate in `features`, or null when none. */
export function bboxOfFeatures(features) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const walk = (c) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
      return;
    }
    c.forEach(walk);
  };
  for (const f of features || []) walk(f?.geometry?.coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/**
 * Add the dataset layer (and its share-registry entry) when the URL asks for one. Returns the
 * inputs unchanged otherwise, so the production registry is exactly what it was.
 */
export function withDatasetLayer(layers, registry, { search, loc } = {}) {
  const datasetUrl = parseDatasetParam(search ?? globalThis.location?.search, loc);
  if (!datasetUrl) return { layers, registry, datasetUrl: null };
  const layer = createLocalGeoJsonLayer({
    id: DATASET_LAYER_ID,
    url: jsonlUrl(datasetUrl),
    name: 'Ultimate-GIS dataset',
    color: '#ffd400',
    icon: '◆',
    source: 'Ultimate-GIS',
    labels: false,
  });
  return {
    layers: [...layers, layer],
    registry: [...registry, Object.freeze({ id: DATASET_LAYER_ID, token: DATASET_LAYER_TOKEN, disposition: 'enabled-only' })],
    datasetUrl,
  };
}

/** Turn the dataset layer on and fly to its extent. Failures are logged, never thrown. */
export async function enableDatasetLayer(manager, viewer, datasetUrl, { fetchImpl = (...a) => fetch(...a) } = {}) {
  if (!datasetUrl) return;
  try {
    await manager.setEnabled(DATASET_LAYER_ID, true, { origin: 'programmatic' });
  } catch (err) {
    console.warn('[datasetParam] could not enable the dataset layer', err);
    return;
  }
  try {
    const response = await fetchImpl(datasetUrl, { cache: 'no-store' });
    if (!response.ok) return;
    const box = bboxOfFeatures((await response.json()).features);
    if (!box) return;
    const pad = 0.005; // keeps a single point or a short line from zooming to the ground
    viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad),
    });
  } catch (err) {
    console.warn('[datasetParam] could not fly to the dataset', err);
  }
}
