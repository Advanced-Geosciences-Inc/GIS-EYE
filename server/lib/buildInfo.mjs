import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve what build is running.
 *
 * The container image build writes `server/build-info.json`
 * ({version, sha, builtAt, notes}) — see the Dockerfile. A plain git checkout
 * has no such file, so fall back to package.json's version with whatever the
 * environment can add. `notes` is the release-notes array shown by the in-app
 * update toast ({type, text} entries from the CHANGELOG section being shipped).
 */
export function loadBuildInfo({ root = path.join(__dirname, '..', '..'), env = process.env } = {}) {
  const baked = path.join(root, 'server', 'build-info.json');
  let info = null;
  try {
    info = JSON.parse(fs.readFileSync(baked, 'utf8'));
  } catch {
    info = null;
  }
  if (!info || typeof info !== 'object') {
    let version = '0.0.0';
    try {
      version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || version;
    } catch {
      /* keep placeholder */
    }
    info = { version, sha: null, builtAt: null, notes: [] };
  }
  return {
    version: String(info.version || '0.0.0'),
    sha: info.sha ? String(info.sha) : (env.GEV_GIT_SHA ? String(env.GEV_GIT_SHA) : null),
    builtAt: info.builtAt ? String(info.builtAt) : null,
    notes: Array.isArray(info.notes) ? info.notes : [],
  };
}
