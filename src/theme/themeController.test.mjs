import test from 'node:test';
import assert from 'node:assert/strict';

import { initTheme, resolveTheme, setTheme } from './themeController.js';

test('resolveTheme precedence: query > cookie > stored > system', () => {
  assert.deepEqual(
    resolveTheme({ search: '?theme=light', cookie: 'gs_theme=dark', stored: 'dark', prefersLight: false }),
    { theme: 'light', source: 'query' },
  );
  assert.deepEqual(
    resolveTheme({ search: '?theme=neon', cookie: 'a=1; gs_theme=light', stored: 'dark' }),
    { theme: 'light', source: 'cookie' },
  );
  assert.deepEqual(resolveTheme({ stored: 'light' }), { theme: 'light', source: 'stored' });
  assert.deepEqual(resolveTheme({ prefersLight: true }), { theme: 'light', source: 'system' });
  assert.deepEqual(resolveTheme({}), { theme: 'dark', source: 'system' });
});

function fakeWindow({ search = '', cookie = '', stored = null, prefersLight = false } = {}) {
  const local = new Map();
  if (stored) local.set('gev:theme:v1', stored);
  return {
    document: { cookie, documentElement: { dataset: {} } },
    location: { search },
    matchMedia: (query) => ({ matches: prefersLight && query.includes('light') }),
    localStorage: {
      getItem: (key) => (local.has(key) ? local.get(key) : null),
      setItem: (key, value) => local.set(key, value),
    },
    _local: local,
  };
}

test('initTheme applies to <html> and persists an explicit query choice', () => {
  const win = fakeWindow({ search: '?theme=light' });
  const resolved = initTheme({ win });
  assert.equal(resolved.theme, 'light');
  assert.equal(win.document.documentElement.dataset.theme, 'light');
  assert.equal(win._local.get('gev:theme:v1'), 'light');
});

test('initTheme does not persist cookie/system choices', () => {
  const win = fakeWindow({ cookie: 'gs_theme=light' });
  initTheme({ win });
  assert.equal(win.document.documentElement.dataset.theme, 'light');
  assert.equal(win._local.has('gev:theme:v1'), false);
});

test('setTheme validates and persists', () => {
  const win = fakeWindow();
  setTheme('light', { win });
  assert.equal(win.document.documentElement.dataset.theme, 'light');
  assert.equal(win._local.get('gev:theme:v1'), 'light');
  setTheme('neon', { win });
  assert.equal(win.document.documentElement.dataset.theme, 'light', 'invalid values ignored');
});
