import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { createGevApp, normalizeBase } from './app.mjs';

/** Build a throwaway dist directory so the static/SPA paths are exercised. */
function makeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>God\'s Eye View</title>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), '// hashed asset');
  return dir;
}

/** One GET against a listening app; resolves {status, headers, body}. */
function get(server, requestPath) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get({ host: '127.0.0.1', port, path: requestPath }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function withApp(env, run) {
  const distDir = makeDist();
  const { httpServer, installed, skipped } = await createGevApp({ env: { ...process.env, ...env }, distDir });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  try {
    await run({ httpServer, installed, skipped });
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
    fs.rmSync(distDir, { recursive: true, force: true });
  }
}

test('normalizeBase canonicalizes deployment prefixes', () => {
  assert.equal(normalizeBase(undefined), '/');
  assert.equal(normalizeBase(''), '/');
  assert.equal(normalizeBase('/'), '/');
  assert.equal(normalizeBase('/portal/gis'), '/portal/gis/');
  assert.equal(normalizeBase('portal/gis/'), '/portal/gis/');
});

test('production app installs every -proxy plugin and never the key-setup endpoint', async () => {
  await withApp({}, async ({ installed, skipped }) => {
    const expected = [
      'opensky-proxy', 'celestrak-proxy', 'tomtom-proxy', 'firms-proxy',
      'rocket-launches-proxy', 'terrain-heights-proxy', 'adsbdb-proxy',
      'overpass-proxy', 'military-installations-proxy', 'regional-brief-proxy',
      'weather-effects-proxy', 'cctv-proxy', 'radio-browser-proxy', 'gbfs-proxy',
      'adsblol-proxy', 'ais-live-proxy', 'track-backfill-proxies',
      'openai-realtime-proxy', 'google-places-context-proxy',
    ];
    for (const name of expected) assert.ok(installed.includes(name), `missing ${name}`);
    assert.ok(!installed.includes('gev-key-setup'));
    assert.ok(skipped.includes('gev-key-setup'));
  });
});

test('meta endpoints, credential-endpoint absence, and document headers', async () => {
  await withApp({}, async ({ httpServer }) => {
    const health = await get(httpServer, '/healthz');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);

    const config = await get(httpServer, '/api/config');
    assert.equal(config.status, 200);
    const parsed = JSON.parse(config.body);
    assert.equal(parsed.features.opensky, true);
    assert.equal(parsed.features.cables, true);

    const version = await get(httpServer, '/api/version');
    assert.equal(version.status, 200);
    assert.ok(JSON.parse(version.body).version.length > 0);

    // The Provider Settings credential-write endpoints are dev-server-only;
    // in production they must not exist at all.
    assert.equal((await get(httpServer, '/api/setup/status')).status, 404);
    assert.equal((await get(httpServer, '/api/setup/keys')).status, 404);

    const doc = await get(httpServer, '/');
    assert.equal(doc.status, 200);
    assert.equal(doc.headers['x-frame-options'], 'DENY');
    assert.match(doc.headers['content-security-policy'] || '', /frame-ancestors 'none'/);
    assert.equal(doc.headers['x-content-type-options'], 'nosniff');
    assert.match(doc.body, /God's Eye View/);
  });
});

test('SPA fallback serves the app while unmatched API routes stay JSON 404s', async () => {
  await withApp({}, async ({ httpServer }) => {
    const deep = await get(httpServer, '/not-a-real-route');
    assert.equal(deep.status, 200);
    assert.match(deep.body, /God's Eye View/);

    const api = await get(httpServer, '/api/definitely-not-a-route');
    assert.equal(api.status, 404);
    assert.equal(JSON.parse(api.body).error, 'Not found');
  });
});

test('base-prefixed and bare URLs both resolve under GEV_BASE', async () => {
  await withApp({ GEV_BASE: '/portal/gis/' }, async ({ httpServer }) => {
    assert.equal((await get(httpServer, '/portal/gis/healthz')).status, 200);
    assert.equal((await get(httpServer, '/healthz')).status, 200);

    const doc = await get(httpServer, '/portal/gis/');
    assert.equal(doc.status, 200);
    assert.match(doc.body, /God's Eye View/);

    const redirect = await get(httpServer, '/portal/gis');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, '/portal/gis/');

    const config = JSON.parse((await get(httpServer, '/portal/gis/api/config')).body);
    assert.equal(config.base, '/portal/gis/');
  });
});

test('Cesium assets nested under the base in dist are served at the prefixed URL', async () => {
  // Mirrors a real `GEV_BASE=/portal/gis/ vite build`: vite-plugin-cesium
  // writes dist/portal/gis/cesium/** while index.html sits at the dist root.
  const distDir = makeDist();
  const cesiumDir = path.join(distDir, 'portal', 'gis', 'cesium', 'Widgets');
  fs.mkdirSync(cesiumDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'portal', 'gis', 'cesium', 'Cesium.js'), '/* cesium */');
  fs.writeFileSync(path.join(cesiumDir, 'widgets.css'), '/* widgets */');
  const { httpServer } = await createGevApp({
    env: { ...process.env, GEV_BASE: '/portal/gis/' },
    distDir,
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  try {
    const script = await get(httpServer, '/portal/gis/cesium/Cesium.js');
    assert.equal(script.status, 200);
    assert.equal(script.body, '/* cesium */');
    assert.match(script.headers['content-type'] || '', /javascript/);

    const css = await get(httpServer, '/portal/gis/cesium/Widgets/widgets.css');
    assert.equal(css.status, 200);
    assert.equal(css.body, '/* widgets */');

    // Root-level assets and the SPA document still resolve.
    assert.equal((await get(httpServer, '/portal/gis/assets/app-abc123.js')).status, 200);
    assert.match((await get(httpServer, '/portal/gis/')).body, /God's Eye View/);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

test('disabled features refuse their API routes and report through /api/config', async () => {
  await withApp({ GEV_FEATURE_OPENSKY: '0', GEV_FEATURE_CABLES: 'off' }, async ({ httpServer }) => {
    const config = JSON.parse((await get(httpServer, '/api/config')).body);
    assert.equal(config.features.opensky, false);
    assert.equal(config.features.cables, false);
    assert.equal(config.features.datacenters, true);

    for (const route of ['/api/opensky', '/api/opensky-track', '/api/opensky/extended']) {
      const res = await get(httpServer, route);
      assert.equal(res.status, 403, route);
      const body = JSON.parse(res.body);
      assert.equal(body.disabled, true);
      assert.equal(body.feature, 'opensky');
    }
  });
});
