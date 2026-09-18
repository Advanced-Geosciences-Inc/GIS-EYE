import test from 'node:test';
import assert from 'node:assert/strict';

import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

import { authMiddleware, buildVerifier, extractToken } from './auth.mjs';

const SECRET = 'test-secret-test-secret-test-secret!';
const ENV = {
  GEV_AUTH_MODE: 'hs256',
  GEV_JWT_HS256_SECRET: SECRET,
  GEV_JWT_ISSUER: 'https://geostack.example',
  GEV_LOGIN_URL: 'https://geostack.example/login',
};

async function mint({ issuer = ENV.GEV_JWT_ISSUER, audience = 'gis-eye', secret = SECRET, expiresIn = '15m', claims = {} } = {}) {
  return new SignJWT({ org: 'agi', entitlements: ['gis'], ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(createSecretKey(Buffer.from(secret, 'utf8')));
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.ended = true; this.body = body ?? null; },
  };
}

async function run(middleware, req) {
  const res = fakeRes();
  let nexted = false;
  await middleware(req, res, () => { nexted = true; });
  return { res, nexted, req };
}

test('extractToken reads Bearer headers and cookies', () => {
  assert.equal(extractToken({ headers: { authorization: 'Bearer abc' } }, 'gev_session'), 'abc');
  assert.equal(extractToken({ headers: { cookie: 'x=1; gev_session=tok%3D%3D; y=2' } }, 'gev_session'), 'tok==');
  assert.equal(extractToken({ headers: {} }, 'gev_session'), null);
});

test('GEV_AUTH_MODE=none leaves every request alone', async () => {
  const middleware = authMiddleware({});
  const { nexted } = await run(middleware, { url: '/api/opensky', headers: {} });
  assert.equal(nexted, true);
});

test('misconfigured modes fail fast at construction', () => {
  assert.throws(() => buildVerifier({ GEV_AUTH_MODE: 'hs256', GEV_JWT_ISSUER: 'x' }), /HS256_SECRET/);
  assert.throws(() => buildVerifier({ GEV_AUTH_MODE: 'hs256', GEV_JWT_HS256_SECRET: SECRET }), /ISSUER/);
  assert.throws(() => buildVerifier({ GEV_AUTH_MODE: 'jwks', GEV_JWT_ISSUER: 'x' }), /JWKS_URL/);
  assert.throws(() => buildVerifier({ GEV_AUTH_MODE: 'saml', GEV_JWT_ISSUER: 'x' }), /Unknown/);
});

test('a valid token passes and carries tenant claims', async () => {
  const middleware = authMiddleware(ENV);
  const token = await mint();
  const { nexted, req } = await run(middleware, {
    url: '/api/opensky',
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(nexted, true);
  assert.equal(req.gevAuth.sub, 'user-1');
  assert.equal(req.gevAuth.org, 'agi');
  assert.deepEqual(req.gevAuth.entitlements, ['gis']);
});

test('missing, expired, wrong-audience and forged tokens all 401 on API routes', async () => {
  const middleware = authMiddleware(ENV);
  const cases = [
    null,
    await mint({ expiresIn: '-1m' }),
    await mint({ audience: 'other-app' }),
    await mint({ secret: 'wrong-secret-wrong-secret-wrong-secret' }),
    'not-a-jwt',
  ];
  for (const token of cases) {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const { res, nexted } = await run(middleware, { url: '/api/opensky', method: 'GET', headers });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.login, ENV.GEV_LOGIN_URL);
    assert.ok(!res.body.includes(SECRET), 'must not leak server config');
  }
});

test('unauthenticated documents bounce to the portal login with a return URL', async () => {
  const middleware = authMiddleware(ENV);
  const { res } = await run(middleware, {
    url: '/?view=x',
    method: 'GET',
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.Location, /^https:\/\/geostack\.example\/login\?return=/);
  assert.match(res.headers.Location, /%3Fview%3Dx/);
});

test('healthz stays open in every mode', async () => {
  const middleware = authMiddleware(ENV);
  const { nexted } = await run(middleware, { url: '/healthz', method: 'GET', headers: {} });
  assert.equal(nexted, true);
});

test('a valid session cookie authenticates like a header', async () => {
  const middleware = authMiddleware(ENV);
  const token = await mint();
  const { nexted } = await run(middleware, {
    url: '/api/tomtom/status',
    method: 'GET',
    headers: { cookie: `gev_session=${token}` },
  });
  assert.equal(nexted, true);
});
