/**
 * Per-deployment feature flags for the hosted server.
 *
 * Some bundled/live data sources carry licenses that permit the local,
 * non-commercial OSS experience but not a hosted commercial deployment until
 * cleared (see DATA_SOURCES.md): OpenSky is non-commercial without a written
 * agreement, and the TeleGeography submarine-cable bundle is NonCommercial.
 *
 * Every feature defaults to ON so `npm run dev` and the Pinokio launcher keep
 * the full upstream experience. Hosted deploys set the env vars explicitly
 * (see fly.*.toml) and flip them on only once the license conversation is
 * settled.
 */

export const FEATURES = Object.freeze([
  // Live layers whose API routes the server can refuse outright.
  { key: 'opensky', env: 'GEV_FEATURE_OPENSKY', routes: ['/api/opensky'] },
  // Bundled client-side layers: no proxy route, gated via /api/config so the
  // client skips registering the layer (see src/runtimeConfig.js).
  { key: 'cables', env: 'GEV_FEATURE_CABLES', routes: [] },
  { key: 'datacenters', env: 'GEV_FEATURE_DATACENTERS', routes: [] },
  { key: 'dams', env: 'GEV_FEATURE_DAMS', routes: [] },
]);

const FALSY = new Set(['0', 'false', 'off', 'no', 'disabled']);
const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled']);

/** Parse one flag value; unset or unrecognized means the default (enabled). */
export function parseFlag(raw, fallback = true) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (FALSY.has(text)) return false;
  if (TRUTHY.has(text)) return true;
  return fallback;
}

/** Resolve the full feature map from an environment object. */
export function resolveFeatures(env = process.env) {
  const resolved = {};
  for (const feature of FEATURES) {
    resolved[feature.key] = parseFlag(env[feature.env]);
  }
  return resolved;
}

/**
 * Connect middleware that refuses API routes belonging to disabled features
 * before the proxy middlewares see the request. Route matching is by prefix,
 * so `/api/opensky` also covers `/api/opensky-track`.
 */
export function featureGate(features, { respond }) {
  const blocked = [];
  for (const feature of FEATURES) {
    if (features[feature.key]) continue;
    for (const route of feature.routes) blocked.push({ route, feature: feature.key });
  }
  if (!blocked.length) return (req, res, next) => next();
  return (req, res, next) => {
    const url = String(req.url || '');
    for (const { route, feature } of blocked) {
      if (url === route || url.startsWith(`${route}/`) || url.startsWith(`${route}-`) || url.startsWith(`${route}?`)) {
        return respond(res, 403, {
          error: 'This layer is disabled on this deployment',
          disabled: true,
          feature,
        });
      }
    }
    next();
  };
}
