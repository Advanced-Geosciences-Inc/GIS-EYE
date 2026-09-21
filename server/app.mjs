import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connect from 'connect';
import sirv from 'sirv';
import { respond } from './lib/respond.mjs';
import { resolveFeatures, featureGate } from './lib/features.mjs';
import { authMiddleware } from './lib/auth.mjs';
import { createQuotaStore, quotaMiddleware, quotaTenant } from './lib/quota.mjs';
import { gevRuntimeMeta } from './mw/meta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Which of the config's plugins the production server installs.
 *
 * Every upstream API middleware is a Vite plugin whose name ends in `-proxy`
 * (or `-proxies` for the track-backfill pair). Allowlisting on that suffix
 * keeps the dev-only pieces out by construction: `vite-plugin-cesium` (build
 * asset handling) and `gev-key-setup` (the Provider Settings endpoint that
 * writes `.env` — a credential-write surface that must never reach a hosted
 * deployment; SECURITY.md and the plugin's own `apply:` pin document this).
 * A future upstream plugin that doesn't follow the naming is skipped, not
 * silently exposed, and the boot log lists both sets.
 */
const INSTALL_NAME = /-prox(y|ies)$/;
const FORBIDDEN_NAMES = new Set(['gev-key-setup']);

/** Normalize a base path to `/prefix/` form ('/' when unset). */
export function normalizeBase(raw) {
  let base = String(raw || '/').trim();
  if (!base || base === '/') return '/';
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

/**
 * Connect middleware that makes the app serve identically with or without
 * the deployment prefix: `/portal/gis/api/x` is rewritten to `/api/x`, while
 * already-bare URLs pass through untouched. This tolerates both a Cloudflare
 * route that forwards the full path and one that strips the prefix.
 */
export function baseStrip(base) {
  if (base === '/') return (req, res, next) => next();
  const bare = base.slice(0, -1); // '/portal/gis'
  return (req, res, next) => {
    const url = String(req.url || '');
    if (url === bare || url.startsWith(`${bare}?`)) {
      res.statusCode = 302;
      res.setHeader('Location', base + url.slice(bare.length));
      return res.end();
    }
    if (url.startsWith(base)) {
      req.url = url.slice(bare.length);
    }
    next();
  };
}

/**
 * Build the production app from the same plugin factories the dev server
 * uses. vite.config.js's default export is the config factory; calling it
 * yields the plugins array, and each `-proxy` plugin's configureServer only
 * needs `{ middlewares, httpServer }` — verified across all registrations —
 * so a connect app plus the node http server is a complete host.
 */
export async function createGevApp({
  env = process.env,
  distDir = path.join(__dirname, '..', 'dist'),
  logger = console,
} = {}) {
  const configModule = await import('../vite.config.js');
  const configFactory = configModule.default;
  const resolved = await configFactory({ mode: env.NODE_ENV || 'production', command: 'serve' });

  const base = normalizeBase(env.GEV_BASE);
  const features = resolveFeatures(env);
  const app = connect();
  const httpServer = http.createServer(app);
  const duckServer = { middlewares: app, httpServer };

  // Same document headers the dev server sets (clickjacking protection for
  // the app document), read from the resolved config so upstream changes
  // carry over, plus nosniff.
  const headers = { ...(resolved.server?.headers || {}) };
  app.use((req, res, next) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use(baseStrip(base));

  // Open endpoints (health checks and the boot-time config the client needs
  // before any sign-in bounce) mount ahead of auth.
  gevRuntimeMeta({ env }).configureServer(duckServer);

  // Portal SSO (no-op under the default GEV_AUTH_MODE=none) and the durable
  // per-tenant quota store (no-op without UPSTASH_REDIS_REST_*).
  app.use(authMiddleware(env));
  const quotaStore = createQuotaStore(env, { logger });
  app.use(quotaMiddleware(quotaStore, { respond }));
  app.use('/api/usage', async (req, res) => {
    if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
    if (!quotaStore) return respond(res, 200, { metered: false, usage: null });
    const usage = await quotaStore.usage(quotaTenant(req));
    respond(res, 200, { metered: true, usage });
  });

  app.use(featureGate(features, { respond }));

  const installed = [];
  const skipped = [];
  const plugins = (resolved.plugins || []).flat().filter((plugin) => plugin && typeof plugin === 'object');
  for (const plugin of plugins) {
    const name = String(plugin.name || '');
    if (FORBIDDEN_NAMES.has(name) || !INSTALL_NAME.test(name) || typeof plugin.configureServer !== 'function') {
      skipped.push(name || '(unnamed)');
      continue;
    }
    try {
      await plugin.configureServer(duckServer);
      installed.push(name);
    } catch (error) {
      logger.error(`[GIS-EYE] Failed to install ${name}:`, error);
      throw error;
    }
  }

  // Any /api path no proxy claimed is a JSON 404, never the SPA fallback.
  app.use('/api', (req, res) => respond(res, 404, { error: 'Not found' }));

  const hasDist = fs.existsSync(path.join(distDir, 'index.html'));
  if (hasDist) {
    app.use(sirv(distDir, {
      etag: true,
      single: true,
      setHeaders(res, pathname) {
        if (pathname.startsWith('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (pathname.endsWith('.html') || pathname === '/') {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=300');
        }
      },
    }));
  } else {
    logger.warn(`[GIS-EYE] No build found at ${distDir} — serving API routes only (run \`npm run build\`).`);
    app.use((req, res) => respond(res, 503, { error: 'No client build present on this server' }));
  }

  return { app, httpServer, base, features, installed, skipped, hasDist };
}
