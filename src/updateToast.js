import { apiUrl } from './basePath.js';

/**
 * Update-available toast for hosted deployments.
 *
 * The server reports its build via `GET /api/version` (server/mw/meta.mjs):
 * version, sha, builtAt, and the release notes cut from the CHANGELOG
 * (docs/agi/RELEASING.md). At boot the client remembers the build it loaded
 * from; a later poll (or tab-refocus check) that reports a different build
 * means a deploy happened, so the toast offers "Update now" / "Later" with
 * the shipped improvements and an honest promise: scenes, layer setup,
 * panel layout and settings live in localStorage, and the live view rides
 * the share hash (src/sharelink.js flushes it on `gev:before-update`), so a
 * reload loses nothing.
 *
 * No service worker on purpose: the app is fully dynamic, and reload-based
 * pickup avoids a cache layer's failure modes.
 */

const POLL_MS = 10 * 60 * 1000;
const MIN_CHECK_GAP_MS = 60 * 1000;
const SNOOZE_KEY = 'gev:update-toast-snooze';
const MAX_NOTES = 4;

/** Stable identity of a build report; null when the report is unusable. */
export function buildIdentity(info) {
  if (!info || typeof info !== 'object') return null;
  return info.sha || info.builtAt || info.version || null;
}

/** Cap and clean the notes list for display. */
export function displayNotes(notes, max = MAX_NOTES) {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((note) => note && typeof note.text === 'string' && note.text.trim())
    .slice(0, max)
    .map((note) => ({
      type: typeof note.type === 'string' && note.type ? note.type : 'note',
      text: note.text.trim(),
    }));
}

/**
 * Start watching for new deployments. Returns {check, dispose} (tests drive
 * `check` directly). Safe no-op when the container element is absent.
 */
export function initUpdateToast({
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
  fetchImpl,
  pollMs = POLL_MS,
} = {}) {
  const container = doc?.getElementById('update-toast');
  if (!container || !win) return { check: async () => null, dispose: () => {} };
  const doFetch = fetchImpl || ((...args) => fetch(...args));

  let baseline = null;
  let visible = false;
  let lastCheckAt = 0;

  const readSnooze = () => {
    try {
      return win.sessionStorage?.getItem(SNOOZE_KEY) || null;
    } catch {
      return null;
    }
  };
  const writeSnooze = (identity) => {
    try {
      win.sessionStorage?.setItem(SNOOZE_KEY, identity);
    } catch {
      /* private windows: the toast simply re-offers */
    }
  };

  const hide = () => {
    visible = false;
    container.hidden = true;
    container.textContent = '';
  };

  const show = (info) => {
    const version = typeof info.version === 'string' && info.version ? `v${info.version}` : 'A new version';
    container.textContent = '';

    const card = doc.createElement('div');
    card.className = 'update-toast-card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');

    const title = doc.createElement('div');
    title.className = 'update-toast-title';
    title.textContent = `${version} is ready`;
    card.appendChild(title);

    const notes = displayNotes(info.notes);
    if (notes.length) {
      const list = doc.createElement('ul');
      list.className = 'update-toast-notes';
      for (const note of notes) {
        const item = doc.createElement('li');
        const chip = doc.createElement('span');
        chip.className = `update-toast-chip update-toast-chip-${note.type}`;
        chip.textContent = note.type;
        item.appendChild(chip);
        item.appendChild(doc.createTextNode(` ${note.text}`));
        list.appendChild(item);
      }
      card.appendChild(list);
    }

    const reassure = doc.createElement('p');
    reassure.className = 'update-toast-reassure';
    reassure.textContent = 'Nothing will be lost: your scenes, layer setup, panel layout and settings are saved on this device, and updating returns you to exactly this view.';
    card.appendChild(reassure);

    const actions = doc.createElement('div');
    actions.className = 'update-toast-actions';

    const now = doc.createElement('button');
    now.type = 'button';
    now.className = 'update-toast-apply';
    now.textContent = 'Update now';
    now.addEventListener('click', () => {
      // Give state holders one synchronous chance to flush (share hash).
      win.dispatchEvent(new Event('gev:before-update'));
      win.location.reload();
    });

    const later = doc.createElement('button');
    later.type = 'button';
    later.className = 'update-toast-later';
    later.textContent = 'Later';
    later.addEventListener('click', () => {
      writeSnooze(buildIdentity(info));
      hide();
    });

    actions.appendChild(now);
    actions.appendChild(later);
    card.appendChild(actions);

    container.appendChild(card);
    container.hidden = false;
    visible = true;
  };

  const fetchVersion = async () => {
    try {
      const response = await doFetch(apiUrl('/api/version'), { cache: 'no-store' });
      if (!response.ok) return null;
      const parsed = await response.json();
      return buildIdentity(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const check = async ({ force = false } = {}) => {
    const nowMs = Date.now();
    if (!force && nowMs - lastCheckAt < MIN_CHECK_GAP_MS) return null;
    lastCheckAt = nowMs;

    const info = await fetchVersion();
    if (!info) return null;
    const identity = buildIdentity(info);
    if (!baseline) {
      // First successful read: this IS the build the client loaded from.
      baseline = identity;
      return null;
    }
    if (identity === baseline || visible) return info;
    if (readSnooze() === identity) return info;
    show(info);
    return info;
  };

  const interval = win.setInterval(() => { check(); }, pollMs);
  const onVisible = () => {
    if (!doc.hidden) check();
  };
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('focus', onVisible);
  check({ force: true });

  return {
    check,
    dispose() {
      win.clearInterval(interval);
      doc.removeEventListener('visibilitychange', onVisible);
      win.removeEventListener('focus', onVisible);
      hide();
    },
  };
}
