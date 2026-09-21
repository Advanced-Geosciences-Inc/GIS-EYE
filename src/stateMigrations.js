/**
 * One-time migrations for user state kept in localStorage.
 *
 * The update toast promises that nothing a user set up is lost across
 * deploys. That holds only if storage-shape changes ship WITH a migration:
 * whenever a `*_STORAGE_VERSION` constant or a `:vN`-suffixed key bumps,
 * add an entry here that carries the old value forward (see the CCTV
 * v1→v2 precedent in src/data/cctv.js), or note an explicit reset in the
 * release notes. CONTRIBUTING.md makes this part of the PR checklist.
 *
 * Durable state inventory (why this file exists):
 *   godsEyeView.sceneProject.v2      — user-authored scene projects
 *   gev:layer-state:v2               — layer enablement/params
 *   godsEyeView.v*.panelPos.* / panelCollapsed.* — panel layout
 *   godsEyeView.cctv.calibration.v2  — CCTV camera calibration
 *   godsEyeView.voiceCost.*          — voice spend tier/limits
 *   gev:first-run-mission:v1, gev:detection-allocation:v1, …
 * The live view itself (camera/style/toggles) rides the URL hash
 * (src/sharelink.js) and needs no migration.
 */

const LEDGER_KEY = 'gev:migrations:v1';

/**
 * Ordered migration registry. Each entry: {id, run(storage)}. `run` must be
 * idempotent and defensive — storage may hold anything.
 */
export const MIGRATIONS = [];

/** Execute every not-yet-recorded migration; returns the ids that ran. */
export function runStateMigrations(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return [];
  let done = [];
  try {
    done = JSON.parse(storage.getItem(LEDGER_KEY) || '[]');
    if (!Array.isArray(done)) done = [];
  } catch {
    done = [];
  }

  const ran = [];
  for (const migration of MIGRATIONS) {
    if (done.includes(migration.id)) continue;
    try {
      migration.run(storage);
      ran.push(migration.id);
      done.push(migration.id);
    } catch (error) {
      // A failed migration must never block boot; the next load retries it.
      console.warn(`[migrations] ${migration.id} failed:`, error?.message || error);
    }
  }

  if (ran.length) {
    try {
      storage.setItem(LEDGER_KEY, JSON.stringify(done));
    } catch {
      /* storage full/blocked: retried next load, still idempotent */
    }
  }
  return ran;
}
