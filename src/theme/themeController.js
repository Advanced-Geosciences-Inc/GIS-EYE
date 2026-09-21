/**
 * Theme selection for portal-hosted deployments.
 *
 * Sets `data-theme` on <html> so src/theme/palette.css can flip the --gs-*
 * tokens. Precedence: explicit `?theme=` param (portal handoff link) →
 * `gs_theme` cookie (portal-set, same origin under the /portal/gis path) →
 * the user's saved in-app choice → `prefers-color-scheme`. A tiny inline
 * copy of this logic runs in index.html's head to avoid a flash of the
 * wrong theme; this module is the durable API.
 */

const STORAGE_KEY = 'gev:theme:v1';
const VALID = new Set(['light', 'dark']);

/** Resolve the active theme from the provided sources. */
export function resolveTheme({ search = '', cookie = '', stored = null, prefersLight = false } = {}) {
  try {
    const fromQuery = new URLSearchParams(search).get('theme');
    if (VALID.has(fromQuery)) return { theme: fromQuery, source: 'query' };
  } catch {
    /* malformed search string: fall through */
  }
  const cookieMatch = /(?:^|;\s*)gs_theme=(light|dark)(?:;|$)/.exec(cookie);
  if (cookieMatch) return { theme: cookieMatch[1], source: 'cookie' };
  if (VALID.has(stored)) return { theme: stored, source: 'stored' };
  return { theme: prefersLight ? 'light' : 'dark', source: 'system' };
}

/** Apply the resolved theme and persist explicit choices. */
export function initTheme({ win = typeof window !== 'undefined' ? window : null } = {}) {
  if (!win?.document) return { theme: 'dark', source: 'system' };
  let stored = null;
  try {
    stored = win.localStorage?.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const resolved = resolveTheme({
    search: win.location?.search || '',
    cookie: win.document.cookie || '',
    stored,
    prefersLight: !!win.matchMedia?.('(prefers-color-scheme: light)')?.matches,
  });
  win.document.documentElement.dataset.theme = resolved.theme;
  if (resolved.source === 'query') {
    try {
      win.localStorage?.setItem(STORAGE_KEY, resolved.theme);
    } catch {
      /* per-viewer convenience only */
    }
  }
  return resolved;
}

/** Explicit user toggle (future settings surface). */
export function setTheme(theme, { win = typeof window !== 'undefined' ? window : null } = {}) {
  if (!VALID.has(theme) || !win?.document) return;
  win.document.documentElement.dataset.theme = theme;
  try {
    win.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    /* per-viewer convenience only */
  }
}
