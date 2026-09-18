/**
 * Minimal JSON response helper for the fork-local server middlewares.
 *
 * The upstream proxies in vite.config.js carry their own copy; this one exists
 * so fork-local code never has to import from the config module.
 */
export function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
