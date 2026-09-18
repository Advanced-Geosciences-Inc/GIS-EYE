import { createGevApp } from './app.mjs';

/**
 * Standalone production entry: the same API middlewares the dev server
 * mounts, plus the built client from dist/, served from a plain Node http
 * server suitable for a container (see Dockerfile / fly.*.toml).
 *
 * Environment:
 *   PORT      — listen port (default 8080)
 *   HOST      — bind address (default 0.0.0.0; this is a container entry,
 *               unlike the dev server's deliberate localhost default)
 *   GEV_BASE  — deployment path prefix, e.g. /portal/gis/
 *   GEV_FEATURE_* — per-deployment layer flags (server/lib/features.mjs)
 *   Provider keys — same names as .env.example, supplied as real environment
 *               variables (Fly secrets); no .env file is read in production.
 */
const port = Number.parseInt(process.env.PORT, 10) || 8080;
const host = process.env.HOST || '0.0.0.0';

const { httpServer, base, features, installed, skipped } = await createGevApp();

httpServer.listen(port, host, () => {
  console.log(`[GIS-EYE] Ready at http://${host}:${port}${base}`);
  console.log(`[GIS-EYE] API middlewares: ${installed.join(', ')}`);
  if (skipped.length) console.log(`[GIS-EYE] Not installed (dev/build-only): ${skipped.join(', ')}`);
  const off = Object.entries(features).filter(([, on]) => !on).map(([key]) => key);
  if (off.length) console.log(`[GIS-EYE] Disabled features: ${off.join(', ')}`);
});

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[GIS-EYE] ${signal} received, closing`);
  // 'close' fires the hooks plugins registered (e.g. the AIS stream dispose).
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
