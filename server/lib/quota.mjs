/**
 * Durable per-tenant quotas over Upstash Redis (REST).
 *
 * The upstream in-memory limiter is per-machine, resets on restart, and keys
 * on the socket address — which collapses to one shared bucket behind
 * Cloudflare/Fly. This store keys on the SSO tenant (org, falling back to
 * the edge-provided client IP), uses atomic fixed windows shared by every
 * machine (blue/green safe — no volumes), and fails OPEN with a logged
 * warning: availability beats strict metering for v1, and the upstream
 * limiter still acts as a blunt per-machine ceiling.
 *
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — store location;
 *     both unset disables quotas (dev/Pinokio).
 *   GEV_QUOTA_<PROVIDER>_PER_MIN / _PER_DAY — per-tenant budgets; unset or
 *     0 means unlimited for that window.
 */

const WINDOWS = Object.freeze([
  { suffix: 'm', seconds: 60, envSuffix: 'PER_MIN' },
  { suffix: 'd', seconds: 86400, envSuffix: 'PER_DAY' },
]);

/** Providers metered on hosted deployments, by API route prefix. */
export const METERED_PROVIDERS = Object.freeze([
  { provider: 'openai', prefixes: ['/api/realtime', '/api/openai'] },
  { provider: 'google', prefixes: ['/api/google'] },
  { provider: 'tomtom', prefixes: ['/api/tomtom'] },
]);

function minuteWindow(nowMs, seconds) {
  return Math.floor(nowMs / 1000 / seconds);
}

/** Minimal Upstash REST pipeline client (no SDK state, easy to fake). */
export function upstashClient(env = process.env, fetchImpl = fetch) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (commands) => {
    const response = await fetchImpl(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`Upstash ${response.status}`);
    return response.json();
  };
}

/**
 * Create the quota checker. Returns null when no store is configured.
 * check({tenant, provider}) → {allowed, limited?: 'minute'|'day'}
 */
export function createQuotaStore(env = process.env, { client, now = Date.now, logger = console } = {}) {
  const exec = client === undefined ? upstashClient(env) : client;
  if (!exec) return null;

  const budgets = {};
  for (const { provider } of METERED_PROVIDERS) {
    budgets[provider] = {};
    for (const window of WINDOWS) {
      const raw = env[`GEV_QUOTA_${provider.toUpperCase()}_${window.envSuffix}`];
      const value = Number.parseInt(raw ?? '', 10);
      budgets[provider][window.suffix] = Number.isFinite(value) && value > 0 ? value : null;
    }
  }

  let warned = false;
  return {
    budgets,
    async check({ tenant, provider }) {
      const providerBudgets = budgets[provider];
      if (!providerBudgets) return { allowed: true };
      const active = WINDOWS.filter((window) => providerBudgets[window.suffix]);
      if (!active.length) return { allowed: true };

      const nowMs = now();
      const commands = [];
      for (const window of active) {
        const key = `quota:${tenant}:${provider}:${window.suffix}${minuteWindow(nowMs, window.seconds)}`;
        commands.push(['INCR', key], ['EXPIRE', key, String(window.seconds + 60)]);
      }
      try {
        const results = await exec(commands);
        for (let i = 0; i < active.length; i += 1) {
          const count = Number(results[i * 2]?.result ?? 0);
          const limit = providerBudgets[active[i].suffix];
          if (count > limit) {
            return { allowed: false, limited: active[i].suffix === 'm' ? 'minute' : 'day' };
          }
        }
        return { allowed: true };
      } catch (error) {
        if (!warned) {
          warned = true;
          logger.warn('[quota] store unreachable — failing open:', error?.message || error);
        }
        return { allowed: true, degraded: true };
      }
    },
    /** Read a tenant's current counters (for /api/usage). */
    async usage(tenant) {
      const nowMs = now();
      const entries = [];
      const commands = [];
      for (const { provider } of METERED_PROVIDERS) {
        for (const window of WINDOWS) {
          entries.push({ provider, window: window.envSuffix.toLowerCase() });
          commands.push(['GET', `quota:${tenant}:${provider}:${window.suffix}${minuteWindow(nowMs, window.seconds)}`]);
        }
      }
      try {
        const results = await exec(commands);
        const usage = {};
        entries.forEach(({ provider, window }, index) => {
          (usage[provider] ??= {})[window] = Number(results[index]?.result ?? 0);
        });
        return usage;
      } catch {
        return null;
      }
    },
  };
}

/** Resolve the quota tenant for a request: SSO org > sub > edge client IP. */
export function quotaTenant(req) {
  const auth = req.gevAuth || {};
  if (auth.org) return `org:${auth.org}`;
  if (auth.sub) return `user:${auth.sub}`;
  const edgeIp = req.headers?.['cf-connecting-ip'] || req.headers?.['fly-client-ip'];
  if (edgeIp) return `ip:${String(edgeIp).split(',')[0].trim()}`;
  return `ip:${req.socket?.remoteAddress || 'unknown'}`;
}

/** Connect middleware enforcing quotas on the metered provider routes. */
export function quotaMiddleware(store, { respond }) {
  if (!store) return (req, res, next) => next();
  return async (req, res, next) => {
    const url = String(req.url || '');
    const metered = METERED_PROVIDERS.find(({ prefixes }) =>
      prefixes.some((prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)));
    if (!metered) return next();
    const verdict = await store.check({ tenant: quotaTenant(req), provider: metered.provider });
    if (verdict.allowed) return next();
    res.setHeader('Retry-After', verdict.limited === 'minute' ? '60' : '3600');
    return respond(res, 429, {
      error: `This deployment's ${metered.provider} budget for the current ${verdict.limited} is spent — try again shortly`,
      quota: metered.provider,
      limited: verdict.limited,
    });
  };
}
