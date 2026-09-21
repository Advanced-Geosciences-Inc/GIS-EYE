#!/usr/bin/env node
/**
 * Post-deploy smoke test against a live deployment.
 *
 *   node scripts/smoke-remote.mjs https://gis-eye-staging.fly.dev/portal/gis/
 *
 * Verifies, with retries while the deploy settles:
 *   - /healthz answers ok
 *   - /api/config answers with a feature map
 *   - the app document loads under the base path
 *   - a proxy route is mounted (its own answer, not the /api 404 fallback)
 */
const baseArg = process.argv[2];
if (!baseArg) {
  console.error('Usage: node scripts/smoke-remote.mjs <base-url>');
  process.exit(2);
}
const base = baseArg.endsWith('/') ? baseArg : `${baseArg}/`;

async function probe(pathname, { attempts = 10, delayMs = 6000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(new URL(pathname, base), {
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      return { status: res.status, text };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
};

console.log(`[smoke-remote] ${base}`);

const health = await probe('healthz');
check(health.status === 200 && JSON.parse(health.text).ok === true, `healthz → ${health.status}`);

const config = await probe('api/config');
let features = null;
try {
  features = JSON.parse(config.text).features;
} catch {
  features = null;
}
check(config.status === 200 && features !== null, `api/config → ${config.status}`);

const doc = await probe('');
check(doc.status === 200 && /God's Eye View/.test(doc.text), `app document → ${doc.status}`);

const proxy = await probe('api/celestrak/active');
const unclaimed = proxy.status === 404 && proxy.text.includes('"Not found"');
check(!unclaimed, `api/celestrak/active mounted → ${proxy.status}`);

if (failures) {
  console.error(`[smoke-remote] ${failures} failure(s)`);
  process.exit(1);
}
console.log('[smoke-remote] deployment healthy');
