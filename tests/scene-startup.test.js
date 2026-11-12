import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

class Element {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.parentNode = null;
  }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

const nodes = new Map();
const $ = (selector) => {
  if (!nodes.has(selector)) nodes.set(selector, new Element());
  return nodes.get(selector);
};
const subscribers = [];
const store = {
  state: { machines: [], byId: {}, selectedId: null, scenario: 'factory', kpis: {}, connection: {} },
  subscribe(_topics, callback) { subscribers.push(callback); },
};
const selectMachine = (id) => {
  store.state.selectedId = id;
  subscribers.forEach((callback) => callback(store.state));
};
let resets = 0;
const sources = [];
const notifications = [];
let resolveFarmRetry;
let farmAttempts = 0;
let selectedAfterRetry;
let farmDisposals = 0;
let badFactoryDisposals = 0;
let factoryBoot = () => ({
  select() { throw new Error('Falha ao selecionar'); },
  dispose() { badFactoryDisposals++; },
});
const farm = {
  id: 'farm', forceMock: true, initialKpis: { commands: 0 },
  createAssets: () => [{ id: 'PUL-001', params: { mode: 'auto' } }, { id: 'TRT-001', params: { mode: 'auto' } }],
  envBadge: () => 'mock',
  bootScene() {
    farmAttempts++;
    if (farmAttempts === 1) return Promise.reject(new Error('Modelo ausente'));
    return new Promise((resolve) => { resolveFarmRetry = resolve; });
  },
};
const factory = {
  id: 'factory', forceMock: true, initialKpis: { commands: 0 },
  createAssets: () => [{ id: 'CNC-001', params: { mode: 'auto' } }],
  envBadge: () => 'mock',
  bootScene: () => factoryBoot(),
};
const pharma = {
  id: 'pharma', forceMock: false, initialKpis: { commands: 0 },
  createAssets: () => [{ id: 'PHA-REC-001', params: { mode: 'auto' }, commLost: false }],
  envBadge: (telemetry) => telemetry,
  bootScene: () => ({ select() {}, dispose() {} }),
};
const profiles = { farm, factory, pharma };
let savedMode = 'fabric';
let active = factory;

mock.module('../app/src/ui/dom.js', {
  exports: {
    $, pad: (value) => String(value).padStart(2, '0'),
    toast: (message, kind) => notifications.push({ message, kind }),
  },
});
mock.module('../app/src/core/state.js', {
  exports: {
    store, selectMachine,
    closeEditor() {},
    attachTelemetrySource() {},
    applyTelemetry() {},
    setConnection(patch) { Object.assign(store.state.connection, patch); },
    resetScenario(machines, kpis, meta) {
      resets++;
      Object.assign(store.state, {
        machines, byId: Object.fromEntries(machines.map((machine) => [machine.id, machine])),
        selectedId: null, scenario: meta.scenario, kpis: { ...kpis },
      });
    },
  },
});
mock.module('../app/src/integration/telemetry/index.js', {
  exports: {
    readTelemetryMode: (_scenario, fallback) => savedMode || fallback,
    saveTelemetryMode: (_scenario, mode) => { savedMode = mode; },
    createTelemetrySource(mode) {
      const source = {
        mode, starts: 0, stops: 0,
        start() { this.starts++; },
        stop() { this.stops++; },
      };
      sources.push(source);
      return source;
    },
  },
});
mock.module('../app/src/integration/agent/index.js', {
  exports: { createAgent: (mode) => ({ mode }) },
});
mock.module('../app/src/integration/agent/context.js', {
  exports: { machineSnapshot: (machine) => machine },
});
mock.module('../app/src/ui/sidePanels.js', {
  exports: { mountSidePanels: () => ({ setSource() {} }), hydrateChrome() {} },
});
mock.module('../app/src/ui/infoPanel.js', { exports: { mountInfoPanel() {} } });
mock.module('../app/src/ui/paramsModal.js', { exports: { mountParamsModal() {} } });
mock.module('../app/src/ui/assistant.js', {
  exports: { mountAssistant: () => ({ open() {}, bind() {} }) },
});
mock.module('../app/src/usecases/registry.js', {
  exports: {
    activeScenario: () => active,
    readScenarioId: () => 'farm',
    saveScenarioId() {},
    setActiveScenario(id) { active = profiles[id]; return active; },
  },
});

test('scene recovery preserves telemetry, state and selection; switching still resets the scenario', async (t) => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = {};
  globalThis.document = { createElement: () => new Element() };
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  });
  t.mock.method(globalThis, 'setInterval', () => 0);
  const errorLog = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  const loggedErrors = () => errorLog.mock.calls
    .map((call) => call.arguments[0])
    .filter((value) => value instanceof Error)
    .map((error) => error.message);

  await import('../app/src/main.js');
  await new Promise((resolve) => setImmediate(resolve));
  const container = $('#canvas-container');
  const select = $('#scenario-select');
  const error = container.children.find((child) => child.className === 'scene-error');
  const retry = error.children.find((child) => child.textContent === 'Tentar novamente');
  assert.equal(error.getAttribute('role'), 'alert');
  assert.match(error.children[0].textContent, /Modelo ausente/);
  assert.equal(error.children.find((child) => child.className === 'scene-error-compact').textContent, 'Cena 3D indisponível');
  assert.deepEqual(loggedErrors(), ['Modelo ausente']);
  assert.equal(notifications[0].kind, 'err');
  assert.equal(container.getAttribute('aria-busy'), 'false');
  assert.equal(sources[0].starts, 1);
  assert.equal(resets, 1);

  const originalMachines = store.state.machines;
  store.state.kpis.commands = 7;
  store.state.byId['PUL-001'].params.mode = 'paused';
  selectMachine('PUL-001');
  const recovery = retry.listeners.click();
  assert.equal(container.getAttribute('aria-busy'), 'true');
  assert.equal(select.disabled, true);
  selectMachine('TRT-001');
  resolveFarmRetry({
    select(id) { selectedAfterRetry = id; },
    dispose() { farmDisposals++; },
  });
  await recovery;
  assert.equal(window.iot.source, sources[0]);
  assert.equal(sources[0].starts, 1);
  assert.equal(sources[0].stops, 0);
  assert.equal(resets, 1);
  assert.equal(store.state.machines, originalMachines);
  assert.equal(store.state.byId['PUL-001'].params.mode, 'paused');
  assert.equal(store.state.kpis.commands, 7);
  assert.equal(store.state.selectedId, 'TRT-001');
  assert.equal(selectedAfterRetry, 'TRT-001');
  assert.equal(notifications.at(-1).message, 'Cena 3D carregada novamente.');
  assert.equal(container.getAttribute('aria-busy'), 'false');
  assert.equal(select.disabled, false);
  assert.equal(container.children.some((child) => child.className === 'scene-error'), false);

  await window.iot.activate('factory');
  assert.equal(sources[0].stops, 1);
  assert.equal(sources[1].starts, 1);
  assert.equal(farmDisposals, 1);
  assert.equal(badFactoryDisposals, 1);
  assert.equal(resets, 2);
  assert.equal(store.state.scenario, 'factory');
  assert.equal(store.state.selectedId, null);
  const factoryError = container.children.find((child) => child.className === 'scene-error');
  assert.match(factoryError.children[0].textContent, /Falha ao selecionar/);
  assert.deepEqual(loggedErrors(), ['Modelo ausente', 'Falha ao selecionar']);

  let factorySelection;
  factoryBoot = () => ({ select(id) { factorySelection = id; }, dispose() {} });
  selectMachine('CNC-001');
  await factoryError.children.find((child) => child.textContent === 'Tentar novamente').listeners.click();
  assert.equal(window.iot.source, sources[1]);
  assert.equal(sources[1].starts, 1);
  assert.equal(sources[1].stops, 0);
  assert.equal(resets, 2);
  assert.equal(factorySelection, 'CNC-001');
  assert.equal(container.children.some((child) => child.className === 'scene-error'), false);

  await window.iot.activate('pharma');
  assert.equal(window.iot.source.mode, 'fabric');
  assert.equal(store.state.machines[0].commLost, true);
  assert.equal($('#telemetry-choice').hidden, false);
  const fabricSource = window.iot.source;
  const telemetrySelect = $('#telemetry-select');
  telemetrySelect.value = 'mock';
  await telemetrySelect.listeners.change({ target: telemetrySelect });
  assert.equal(fabricSource.stops, 1);
  assert.equal(window.iot.source.mode, 'mock');
  assert.equal(savedMode, 'mock');
  assert.equal(store.state.machines[0].commLost, false);
  assert.equal($('#env-badge').textContent, 'mock');

  await window.iot.activate('factory');
  assert.equal($('#telemetry-choice').hidden, true);
  await window.iot.activate('pharma');
  assert.equal(window.iot.source.mode, 'mock');
  telemetrySelect.value = 'fabric';
  await telemetrySelect.listeners.change({ target: telemetrySelect });
  assert.equal(window.iot.source.mode, 'fabric');
  assert.equal(store.state.machines[0].commLost, true);
});
