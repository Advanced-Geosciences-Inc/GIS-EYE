import test from 'node:test';
import assert from 'node:assert/strict';

import { respond } from './respond.mjs';
import { createQuotaStore, quotaMiddleware, quotaTenant } from './quota.mjs';

/** In-memory fake of the Upstash pipeline endpoint. */
function fakeRedis() {
  const data = new Map();
  const exec = async (commands) => commands.map(([op, key, arg]) => {
    if (op === 'INCR') {
      const next = (data.get(key) ?? 0) + 1;
      data.set(key, next);
      return { result: next };
    }
    if (op === 'EXPIRE') return { result: 1 };
    if (op === 'GET') return { result: data.get(key) ?? null };
    throw new Error(`unexpected ${op} ${key} ${arg}`);
  });
  return { data, exec };
}

const ENV = { GEV_QUOTA_OPENAI_PER_MIN: '2', GEV_QUOTA_OPENAI_PER_DAY: '5' };

test('no store configured means quotas are off', () => {
  assert.equal(createQuotaStore({}, { client: null }), null);
});

test('per-minute window blocks after the budget and names the window', async () => {
  const { exec } = fakeRedis();
  const store = createQuotaStore(ENV, { client: exec, now: () => 0 });
  assert.deepEqual(await store.check({ tenant: 'org:agi', provider: 'openai' }), { allowed: true });
  assert.deepEqual(await store.check({ tenant: 'org:agi', provider: 'openai' }), { allowed: true });
  const third = await store.check({ tenant: 'org:agi', provider: 'openai' });
  assert.equal(third.allowed, false);
  assert.equal(third.limited, 'minute');
});

test('tenants and unbudgeted providers are independent', async () => {
  const { exec } = fakeRedis();
  const store = createQuotaStore(ENV, { client: exec, now: () => 0 });
  for (let i = 0; i < 3; i += 1) await store.check({ tenant: 'org:a', provider: 'openai' });
  assert.equal((await store.check({ tenant: 'org:b', provider: 'openai' })).allowed, true);
  assert.equal((await store.check({ tenant: 'org:a', provider: 'google' })).allowed, true, 'no google budget set');
});

test('store outage fails open and warns once', async () => {
  const warnings = [];
  const store = createQuotaStore(ENV, {
    client: async () => { throw new Error('down'); },
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
  });
  const verdict = await store.check({ tenant: 'org:agi', provider: 'openai' });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.degraded, true);
  await store.check({ tenant: 'org:agi', provider: 'openai' });
  assert.equal(warnings.length, 1);
});

test('quotaTenant prefers org, then sub, then edge IP headers', () => {
  assert.equal(quotaTenant({ gevAuth: { org: 'agi', sub: 'u' }, headers: {} }), 'org:agi');
  assert.equal(quotaTenant({ gevAuth: { sub: 'u' }, headers: {} }), 'user:u');
  assert.equal(quotaTenant({ headers: { 'cf-connecting-ip': '1.2.3.4' } }), 'ip:1.2.3.4');
  assert.equal(quotaTenant({ headers: {}, socket: { remoteAddress: '::1' } }), 'ip:::1');
});

test('quotaMiddleware 429s metered routes over budget and ignores others', async () => {
  const { exec } = fakeRedis();
  const store = createQuotaStore(ENV, { client: exec, now: () => 0 });
  const middleware = quotaMiddleware(store, { respond });

  const call = async (url) => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { this.body = body ?? null; },
    };
    let nexted = false;
    await middleware({ url, gevAuth: { org: 'agi' }, headers: {} }, res, () => { nexted = true; });
    return { res, nexted };
  };

  assert.equal((await call('/api/opensky')).nexted, true, 'unmetered route passes untouched');
  assert.equal((await call('/api/realtime/token')).nexted, true);
  assert.equal((await call('/api/openai/hud-summary')).nexted, true);
  const blocked = await call('/api/realtime/token');
  assert.equal(blocked.nexted, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.headers['Retry-After'], '60');
  assert.match(JSON.parse(blocked.res.body).error, /budget/);
});

test('usage reads back current counters per provider', async () => {
  const { exec } = fakeRedis();
  const store = createQuotaStore(ENV, { client: exec, now: () => 0 });
  await store.check({ tenant: 'org:agi', provider: 'openai' });
  await store.check({ tenant: 'org:agi', provider: 'openai' });
  const usage = await store.usage('org:agi');
  assert.equal(usage.openai.per_min, 2);
  assert.equal(usage.openai.per_day, 2);
  assert.equal(usage.google.per_min, 0);
});
