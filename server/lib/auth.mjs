import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSecretKey } from 'node:crypto';
import { respond } from './respond.mjs';

/**
 * Portal SSO for hosted deployments.
 *
 * The GeoStack portal signs a short-lived JWT for each signed-in user and
 * delivers it as an HttpOnly cookie scoped to the app path (or the edge
 * proxy injects it as a Bearer header). This middleware validates it and
 * attaches `req.gevAuth = {sub, org, entitlements}` for the quota layer.
 *
 *   GEV_AUTH_MODE        — 'none' (default; dev/Pinokio/upstream behavior),
 *                          'hs256' (shared secret), 'jwks' (portal JWKS URL)
 *   GEV_JWT_HS256_SECRET — shared secret (hs256 mode)
 *   GEV_JWT_JWKS_URL     — e.g. https://geostack.com/.well-known/jwks.json
 *   GEV_JWT_ISSUER       — expected iss claim (required outside none mode)
 *   GEV_JWT_AUDIENCE     — expected aud claim (default 'gis-eye')
 *   GEV_JWT_COOKIE       — cookie name carrying the token (default 'gev_session')
 *   GEV_LOGIN_URL        — portal login page; document requests without a
 *                          valid token 302 here with ?return=<original URL>
 *
 * Unauthenticated `/api/*` requests get a 401 JSON body that includes the
 * login URL so the client can bounce the user (src/runtimeConfig.js).
 * `/healthz` always stays open for Fly health checks.
 */

/** Parse the token from Authorization: Bearer or the session cookie. */
export function extractToken(req, cookieName) {
  const header = String(req.headers?.authorization || '');
  if (/^Bearer /i.test(header)) return header.slice(7).trim();
  const cookies = String(req.headers?.cookie || '');
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookieName) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Build the verifier for the configured mode; null means auth is off. */
export function buildVerifier(env = process.env, { remoteJwks = createRemoteJWKSet } = {}) {
  const mode = String(env.GEV_AUTH_MODE || 'none').toLowerCase();
  if (mode === 'none') return null;

  const issuer = env.GEV_JWT_ISSUER;
  const audience = env.GEV_JWT_AUDIENCE || 'gis-eye';
  if (!issuer) throw new Error(`GEV_AUTH_MODE=${mode} requires GEV_JWT_ISSUER`);

  let keySource;
  if (mode === 'hs256') {
    const secret = env.GEV_JWT_HS256_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('GEV_AUTH_MODE=hs256 requires GEV_JWT_HS256_SECRET (>=32 chars)');
    }
    keySource = createSecretKey(Buffer.from(secret, 'utf8'));
  } else if (mode === 'jwks') {
    if (!env.GEV_JWT_JWKS_URL) throw new Error('GEV_AUTH_MODE=jwks requires GEV_JWT_JWKS_URL');
    keySource = remoteJwks(new URL(env.GEV_JWT_JWKS_URL));
  } else {
    throw new Error(`Unknown GEV_AUTH_MODE: ${mode}`);
  }

  return async (token) => {
    const { payload } = await jwtVerify(token, keySource, { issuer, audience });
    return {
      sub: String(payload.sub || ''),
      org: String(payload.org || payload.tenant || ''),
      entitlements: Array.isArray(payload.entitlements) ? payload.entitlements : [],
    };
  };
}

/** Connect middleware enforcing the configured auth mode. */
export function authMiddleware(env = process.env, deps = {}) {
  const verifier = deps.verifier ?? buildVerifier(env, deps);
  if (!verifier) return (req, res, next) => next();

  const cookieName = env.GEV_JWT_COOKIE || 'gev_session';
  const loginUrl = env.GEV_LOGIN_URL || null;

  return async (req, res, next) => {
    const url = String(req.url || '');
    if (url === '/healthz' || url.startsWith('/healthz?')) return next();

    const token = extractToken(req, cookieName);
    if (token) {
      try {
        req.gevAuth = await verifier(token);
        return next();
      } catch {
        // fall through to the unauthenticated paths — an expired or forged
        // token gets the same answer as a missing one, leaking nothing.
      }
    }

    if (url === '/api' || url.startsWith('/api/')) {
      return respond(res, 401, { error: 'Sign in through the portal to use this deployment', login: loginUrl });
    }
    const accepts = String(req.headers?.accept || '');
    if (loginUrl && req.method === 'GET' && accepts.includes('text/html')) {
      const back = encodeURIComponent(String(req.originalUrl || req.url || '/'));
      res.statusCode = 302;
      res.setHeader('Location', `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}return=${back}`);
      return res.end();
    }
    return respond(res, 401, { error: 'Sign in through the portal to use this deployment', login: loginUrl });
  };
}
