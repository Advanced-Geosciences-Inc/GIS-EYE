/**
 * Deployment base path support.
 *
 * Hosted deployments serve the app under a path prefix (e.g.
 * geostack.com/portal/gis — see GEV_BASE in vite.config.js), so same-origin
 * requests can't hardcode root-absolute paths. Vite rewrites static asset
 * URLs in index.html at build time; every URL the CLIENT CODE constructs —
 * `/api/*` fetches and runtime-read asset attributes — must go through
 * `withBase` instead.
 *
 * Under `npm run dev`, the Pinokio launcher, and Node-based unit tests the
 * base is '/', so `withBase('/api/x')` returns '/api/x' unchanged.
 */

const RAW_BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';

/** The deployment prefix without a trailing slash ('' when served at root). */
export const BASE_PATH = RAW_BASE === '/' ? '' : RAW_BASE.replace(/\/+$/, '');

/** Prefix a root-absolute app path ('/api/x', '/logo.svg') with the base. */
export function withBase(path) {
  return `${BASE_PATH}${path}`;
}

/**
 * Same-origin API URL builder. Today an alias of `withBase`; the hosted
 * auth session (Phase 3) hangs request policy off this seam.
 */
export function apiUrl(path) {
  return withBase(path);
}
