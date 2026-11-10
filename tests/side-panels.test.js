import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { fmt, hms } from '../app/src/ui/dom.js';

const nodes = new Map();
const node = () => ({
  children: [], style: {}, dataset: {}, attributes: {},
  append(...children) { this.children.push(...children); },
  replaceChildren(...children) { this.children = children; },
  setAttribute(name, value) { this.attributes[name] = value; },
  set innerHTML(value) { this.html = value; this.textContent = value.replace(/<[^>]*>/g, ''); },
  get innerHTML() { return this.html; },
});
const $ = (selector) => {
  if (!nodes.has(selector)) nodes.set(selector, node());
  return nodes.get(selector);
};
let renderConnection;
const state = {
  machines: [],
  connection: {
    mode: 'mock', status: 'connecting', eventsIn: 1234, eventsOut: 56,
    lastSync: null, latencyMs: null,
  },
};

mock.module('../app/src/ui/dom.js', {
  exports: {
    $, fmt, hms,
    el(_tag, attrs = {}, ...children) {
      const element = node();
      element.append(...children);
      if (attrs.id) nodes.set(`#${attrs.id}`, element);
      return element;
    },
    setText(element, text) { element.textContent = String(text); },
    reconcile() {},
  },
});
mock.module('../app/src/core/state.js', {
  exports: {
    store: {
      subscribe(topics, callback) {
        if (topics.includes('connection')) {
          renderConnection = callback;
          callback(state);
        }
      },
    },
    selectMachine() {},
  },
});

const { mountSidePanels, hydrateChrome } = await import('../app/src/ui/sidePanels.js');
const { factoryProfile } = await import('../app/src/usecases/factory/profile.js');
const { farmProfile } = await import('../app/src/usecases/farm/profile.js');
const { energyProfile } = await import('../app/src/usecases/energy/profile.js');
const { miningProfile } = await import('../app/src/usecases/mining/profile.js');
const { pharmaProfile } = await import('../app/src/usecases/pharma/profile.js');

test('scenario branding and accessible name follow every scenario switch', (t) => {
  const previous = globalThis.document;
  globalThis.document = { title: '' };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  for (const [profile, label] of [
    [factoryProfile, 'Smart Factory'], [farmProfile, 'Smart Farm'],
    [energyProfile, 'Smart Energy'], [miningProfile, 'Smart Mining'],
    [pharmaProfile, 'Smart Pharma'],
    [factoryProfile, 'Smart Factory'],
  ]) {
    hydrateChrome(profile);
    assert.match(document.title, new RegExp(label));
    assert.equal($('#wordmark').textContent, label);
    assert.equal($('.brand-mark').attributes['aria-label'], label);
    assert.equal($('#scenario-select').value, profile.id);
  }
});

test('side panels format synchronization counters on mount and subsequent updates', () => {
  const panels = mountSidePanels({ source: { mode: 'mock' } });
  assert.equal($('#s-in').textContent, fmt(1234));
  assert.equal($('#s-out').textContent, fmt(56));
  assert.equal($('#s-state').textContent, 'Conectando…');

  panels.setSource({ mode: 'fabric' });
  state.connection = {
    ...state.connection, mode: 'fabric', status: 'connected',
    eventsIn: 2345, eventsOut: 67,
  };
  renderConnection(state);
  assert.equal($('#s-in').textContent, fmt(2345));
  assert.equal($('#s-out').textContent, fmt(67));
  assert.equal($('#conn-text').textContent, 'Fabric RTI: conectado');
});
