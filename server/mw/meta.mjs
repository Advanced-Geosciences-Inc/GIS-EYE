import { respond } from '../lib/respond.mjs';
import { loadBuildInfo } from '../lib/buildInfo.mjs';
import { resolveFeatures } from '../lib/features.mjs';

/**
 * Runtime metadata endpoints, shaped as a Vite plugin so the exact same
 * routes exist under `npm run dev`, `vite preview`, and the production
 * server (which installs it through the same configureServer contract):
 *
 *   GET /healthz      — liveness for Fly health checks and smoke tests
 *   GET /api/config   — deployment config the client reads at boot
 *                       (feature flags for license-gated layers, base path)
 *   GET /api/version  — build identity + release notes for the update toast
 *
 * Registered from vite.config.js for dev/preview parity; the production
 * entry installs it explicitly (server/app.mjs).
 */
export function gevRuntimeMeta({ env = process.env } = {}) {
  const install = (server) => {
    const info = loadBuildInfo({ env });
    const startedAt = new Date().toISOString();

    server.middlewares.use('/healthz', (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return respond(res, 405, { error: 'Method not allowed' });
      }
      respond(res, 200, { ok: true, version: info.version, sha: info.sha, startedAt });
    });

    server.middlewares.use('/api/config', (req, res) => {
      if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
      respond(res, 200, {
        ok: true,
        version: info.version,
        base: env.GEV_BASE || '/',
        features: resolveFeatures(env),
      });
    });

    server.middlewares.use('/api/version', (req, res) => {
      if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
      respond(res, 200, {
        version: info.version,
        sha: info.sha,
        builtAt: info.builtAt,
        notes: info.notes,
      });
    });
  };
  return {
    name: 'gev-runtime-meta',
    configureServer: install,
    configurePreviewServer: install,
  };
}
