import { apiUrl } from './basePath.js';

/**
 * Deployment runtime config.
 *
 * Hosted deployments disable license-gated layers per deployment
 * (server/lib/features.mjs); the client learns which from `GET /api/config`
 * (served by server/mw/meta.mjs in dev, preview, and production alike) and
 * keeps those layers off end to end. Local setups without flags see every
 * feature enabled, and ANY failure to fetch the config fails open — the
 * local experience must never lose layers to a missing endpoint.
 */

/** Feature key → data-layer ids it governs (see src/data registrations). */
export const FEATURE_LAYER_IDS = Object.freeze({
  opensky: Object.freeze(['flights']),
  cables: Object.freeze(['telegeography-submarine-cables']),
  datacenters: Object.freeze(['local-datacenters']),
  dams: Object.freeze(['local-dams']),
});

const FALLBACK = Object.freeze({ ok: false, version: null, base: '/', features: Object.freeze({}) });

let _configPromise = null;

/** Fetch (once) the deployment config; resolves the fallback on any failure. */
export function loadRuntimeConfig({ fetchImpl } = {}) {
  if (!_configPromise) {
    const doFetch = fetchImpl || ((...args) => fetch(...args));
    _configPromise = (async () => {
      try {
        const response = await doFetch(apiUrl('/api/config'), {
          cache: 'no-store',
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
            ? AbortSignal.timeout(5000)
            : undefined,
        });
        if (response.status === 401) {
          // Hosted SSO deployment without a session: bounce to the portal
          // login named by the server (server/lib/auth.mjs), returning here.
          try {
            const body = await response.json();
            if (body?.login && typeof window !== 'undefined') {
              const back = encodeURIComponent(window.location.href);
              window.location.assign(`${body.login}${body.login.includes('?') ? '&' : '?'}return=${back}`);
            }
          } catch {
            /* fall through to the fallback config */
          }
          return FALLBACK;
        }
        if (!response.ok) return FALLBACK;
        const parsed = await response.json();
        if (!parsed || typeof parsed !== 'object' || typeof parsed.features !== 'object') return FALLBACK;
        return {
          ok: true,
          version: typeof parsed.version === 'string' ? parsed.version : null,
          base: typeof parsed.base === 'string' ? parsed.base : '/',
          features: parsed.features || {},
        };
      } catch {
        return FALLBACK;
      }
    })();
  }
  return _configPromise;
}

/** Reset the cached fetch (tests only). */
export function resetRuntimeConfigForTests() {
  _configPromise = null;
}

/** Layer ids whose governing feature is explicitly disabled. */
export function disabledLayerIds(config) {
  const features = config?.features || {};
  const ids = [];
  for (const [feature, layerIds] of Object.entries(FEATURE_LAYER_IDS)) {
    if (features[feature] === false) ids.push(...layerIds);
  }
  return ids;
}

/**
 * Enforce disabled features on a DataLayerManager: veto every enable
 * transition (user toggle, share-link restore, voice tool — the guard sits
 * under all of them), force anything already on back off, and hide the
 * toggle rows via an injected stylesheet (immune to panel re-renders).
 * Call before share restoration begins.
 */
export function installFeatureGate(dataManager, config, { documentRef } = {}) {
  const ids = disabledLayerIds(config);
  if (!ids.length) return () => {};

  const blocked = new Set(ids);
  const unsubscribe = dataManager.addVisibilityGuard(({ layerId, enabled }) => {
    if (enabled && blocked.has(layerId)) {
      return { reason: 'This layer is disabled on this deployment' };
    }
    return null;
  });

  for (const layerId of ids) {
    try {
      if (dataManager.isEnabled(layerId)) dataManager.setEnabled(layerId, false);
    } catch {
      /* a not-yet-registered id has nothing to force off */
    }
  }

  const doc = documentRef || (typeof document !== 'undefined' ? document : null);
  let styleEl = null;
  if (doc) {
    styleEl = doc.createElement('style');
    styleEl.dataset.gevFeatureGate = '1';
    styleEl.textContent = ids
      .map((id) => `.data-toggle-row[data-layer-id="${id}"]{display:none !important;}`)
      .join('\n');
    doc.head.appendChild(styleEl);
  }

  return () => {
    unsubscribe();
    styleEl?.remove();
  };
}
