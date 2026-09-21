import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIdentity, displayNotes, initUpdateToast } from './updateToast.js';

function makeEl(tag) {
  const el = {
    tag,
    children: [],
    listeners: {},
    dataset: {},
    hidden: false,
    className: '',
    type: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(event, fn) { (this.listeners[event] ??= []).push(fn); },
    click(event = 'click') { for (const fn of this.listeners[event] || []) fn(); },
  };
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get: () => text,
    set: (value) => { text = value; el.children.length = 0; },
  });
  return el;
}

function harness() {
  const container = makeEl('div');
  container.hidden = true;
  const doc = {
    hidden: false,
    getElementById: (id) => (id === 'update-toast' ? container : null),
    createElement: makeEl,
    createTextNode: (value) => ({ text: value }),
    addEventListener() {},
    removeEventListener() {},
  };
  const session = new Map();
  const win = {
    dispatched: [],
    reloaded: 0,
    setInterval: () => 1,
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent(event) { this.dispatched.push(event.type); },
    location: { reload() { win.reloaded += 1; } },
    sessionStorage: {
      getItem: (key) => (session.has(key) ? session.get(key) : null),
      setItem: (key, value) => session.set(key, value),
    },
  };
  return { container, doc, win };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function versionFetch(state) {
  return async () => ({ ok: true, json: async () => ({ ...state.current }) });
}

test('buildIdentity prefers sha, then builtAt, then version', () => {
  assert.equal(buildIdentity({ sha: 'a', builtAt: 'b', version: 'c' }), 'a');
  assert.equal(buildIdentity({ builtAt: 'b', version: 'c' }), 'b');
  assert.equal(buildIdentity({ version: 'c' }), 'c');
  assert.equal(buildIdentity({}), null);
  assert.equal(buildIdentity(null), null);
});

test('displayNotes caps, cleans, and defaults types', () => {
  const notes = displayNotes([
    { type: 'fixed', text: ' a ' },
    { type: '', text: 'b' },
    { text: '' },
    null,
    { type: 'added', text: 'c' },
    { type: 'x', text: 'd' },
    { type: 'x', text: 'e' },
  ], 4);
  assert.equal(notes.length, 4);
  assert.deepEqual(notes[0], { type: 'fixed', text: 'a' });
  assert.deepEqual(notes[1], { type: 'note', text: 'b' });
});

test('no toast on the build the client loaded from; toast on a new build', async () => {
  const { container, doc, win } = harness();
  const state = { current: { version: '0.1.1', sha: 'aaa', notes: [] } };
  const toast = initUpdateToast({ doc, win, fetchImpl: versionFetch(state) });
  await settle();
  assert.equal(container.hidden, true, 'baseline build shows nothing');

  state.current = {
    version: '0.2.0',
    sha: 'bbb',
    notes: [{ type: 'fixed', text: 'Overpass mirrors rotate on any refusal' }],
  };
  await toast.check({ force: true });
  assert.equal(container.hidden, false, 'new build shows the toast');
  const card = container.children[0];
  assert.match(JSON.stringify(card.children.map((c) => c.textContent || c.className)), /v0\.2\.0 is ready/);
  toast.dispose();
});

test('Update now flushes state and reloads; Later snoozes that build for the session', async () => {
  const { container, doc, win } = harness();
  const state = { current: { version: '0.1.1', sha: 'aaa', notes: [] } };
  const toast = initUpdateToast({ doc, win, fetchImpl: versionFetch(state) });
  await settle();

  state.current = { version: '0.2.0', sha: 'bbb', notes: [] };
  await toast.check({ force: true });
  const card = container.children[0];
  const actions = card.children.at(-1);
  const [applyButton, laterButton] = actions.children;

  laterButton.click();
  assert.equal(container.hidden, true);
  await toast.check({ force: true });
  assert.equal(container.hidden, true, 'snoozed build stays hidden this session');

  state.current = { version: '0.2.1', sha: 'ccc', notes: [] };
  await toast.check({ force: true });
  assert.equal(container.hidden, false, 'a NEWER build re-offers');

  const freshCard = container.children[0];
  const freshApply = freshCard.children.at(-1).children[0];
  freshApply.click();
  assert.deepEqual(win.dispatched, ['gev:before-update'], 'state flush precedes reload');
  assert.equal(win.reloaded, 1);
  void applyButton;
  toast.dispose();
});

test('fetch failures are silent and never establish a bogus baseline', async () => {
  const { container, doc, win } = harness();
  let healthy = false;
  const toast = initUpdateToast({
    doc,
    win,
    fetchImpl: async () => {
      if (!healthy) throw new Error('offline');
      return { ok: true, json: async () => ({ version: '0.1.1', sha: 'aaa', notes: [] }) };
    },
  });
  await settle();
  assert.equal(container.hidden, true);

  healthy = true;
  await toast.check({ force: true });
  assert.equal(container.hidden, true, 'first success is the baseline, not an update');
  toast.dispose();
});

test('missing container is a safe no-op', async () => {
  const toast = initUpdateToast({
    doc: { getElementById: () => null },
    win: {},
  });
  assert.equal(await toast.check(), null);
  toast.dispose();
});
