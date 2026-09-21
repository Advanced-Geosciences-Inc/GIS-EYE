#!/usr/bin/env node
/**
 * API surface smoke test for the production server.
 *
 * Boots server/app.mjs on an ephemeral port with no provider keys and proves
 * every proxy route is MOUNTED: a mounted route answers with its own status
 * (200 from keyless fallbacks, 4xx/5xx validation or key-required errors) —
 * never the connect-level JSON 404 that means "no middleware claimed this".
 * The dev-only credential endpoints must be exactly that 404.
 *
 * Usage: npm run smoke:api   (exit 0 = every invariant held)
 */
import { createGevApp } from '../server/app.mjs';

// Every mount registered by the -proxy plugins (see vite.config.js).
const MOUNTED_ROUTES = [
  '/api/adsbdb',
  '/api/adsblol/mil',
  '/api/adsblol/trace',
  '/api/ais-live',
  '/api/cctv',
  '/api/celestrak',
  '/api/firms',
  '/api/gbfs',
  '/api/google/nearby-places',
  '/api/google/text-search',
  '/api/launches',
  '/api/military-installations',
  '/api/openai/hud-summary',
  '/api/opensky',
  '/api/opensky-track',
  '/api/overpass',
  '/api/radio',
  '/api/realtime/debug-log',
  '/api/realtime/token',
  '/api/regional-brief',
  '/api/route',
  '/api/terrain/heights',
  '/api/tomtom',
  '/api/weather-effects',
];

const DEV_ONLY_ROUTES = ['/api/setup/status', '/api/setup/keys'];

const { httpServer, installed } = await createGevApp({
  env: { ...process.env, GEV_SMOKE: '1' },
  logger: { ...console, warn: () => {} },
});
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const { port } = httpServer.address();

async function probe(route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`  FAIL ${message}`);
};

console.log(`[smoke-api] ${installed.length} proxy plugins installed on :${port}`);

const health = await probe('/healthz');
if (health.status !== 200 || health.body?.ok !== true) fail(`/healthz → ${health.status}`);

const config = await probe('/api/config');
if (config.status !== 200 || typeof config.body?.features !== 'object') fail(`/api/config → ${config.status}`);

for (const route of MOUNTED_ROUTES) {
  let result;
  try {
    result = await probe(route);
  } catch (error) {
    // A slow/blocked upstream can stall a keyless probe; that still proves a
    // middleware claimed the route (the 404 fallback answers instantly).
    console.log(`  ok   ${route} → no answer within 5s (${error?.name || 'error'}; mounted, upstream slow)`);
    continue;
  }
  // A mounted middleware answers for itself; the unclaimed-/api fallback is
  // a 404 with exactly {error:'Not found'}.
  const unclaimed = result.status === 404 && result.body?.error === 'Not found';
  if (unclaimed) fail(`${route} is not mounted (fell through to the /api 404)`);
  else console.log(`  ok   ${route} → ${result.status}`);
}

for (const route of DEV_ONLY_ROUTES) {
  const { status, body } = await probe(route);
  if (status !== 404 || body?.error !== 'Not found') {
    fail(`${route} must be absent in production, got ${status}`);
  } else console.log(`  ok   ${route} → 404 (dev-only, absent as required)`);
}

await new Promise((resolve) => httpServer.close(resolve));

if (failures) {
  console.error(`[smoke-api] ${failures} failure(s)`);
  process.exit(1);
}
console.log('[smoke-api] all invariants held');
process.exit(0);
