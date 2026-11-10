import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { build, createServer } from 'vite';
import { activeScenario, readScenarioId, saveScenarioId, setActiveScenario } from '../app/src/usecases/registry.js';

function useStorage(t, initial) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map(initial === undefined ? [] : [['iot-scenario', initial]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  return storage;
}

test('default remains factory when no UI default is configured', (t) => {
  useStorage(t);
  assert.equal(readScenarioId(), 'factory');
  for (const invalid of ['', 'invalid', 'MINING', 'constructor', null]) {
    assert.equal(readScenarioId(invalid), 'factory');
  }
});

test('invalid configured UI defaults are reported', (t) => {
  useStorage(t);
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(readScenarioId('unknown'), 'factory');
  assert.match(warn.mock.calls[0].arguments[0], /VITE_DEFAULT_SCENARIO inválido: unknown/);
});

test('each valid configured UI default applies without a saved selection', (t) => {
  useStorage(t);
  for (const scenario of ['factory', 'farm', 'energy', 'mining', 'pharma']) {
    assert.equal(readScenarioId(scenario), scenario);
  }
});

test('saved selections take precedence and scenario switching remains persistent', (t) => {
  useStorage(t, 'factory');
  t.after(() => setActiveScenario('factory'));
  assert.equal(readScenarioId('mining'), 'factory');
  assert.equal(setActiveScenario('mining').id, 'mining');
  saveScenarioId('mining');
  assert.equal(activeScenario().id, 'mining');
  assert.equal(readScenarioId('factory'), 'mining');
  assert.equal(setActiveScenario('pharma').id, 'pharma');
  saveScenarioId('pharma');
  assert.equal(readScenarioId('mining'), 'pharma');
});

test('invalid saved selections fall back to the configured default', (t) => {
  const storage = useStorage(t, 'unknown');
  assert.equal(readScenarioId('mining'), 'mining');
  assert.equal(readScenarioId('unknown'), 'factory');
  saveScenarioId('unknown');
  assert.equal(storage.getItem('iot-scenario'), 'factory');
});

test('unavailable browser storage uses the configured default', (t) => {
  const storage = useStorage(t);
  const warn = t.mock.method(console, 'warn', () => {});
  storage.getItem = () => { throw new Error('storage unavailable'); };
  storage.setItem = () => { throw new Error('storage unavailable'); };
  assert.equal(readScenarioId('mining'), 'mining');
  assert.equal(readScenarioId('invalid'), 'factory');
  assert.match(warn.mock.calls[0].arguments[0], /Não foi possível ler o cenário salvo/);
  assert.doesNotThrow(() => saveScenarioId('farm'));
});

test('Vite exposes VITE_DEFAULT_SCENARIO to startup, independently of simulator SCENARIO', async (t) => {
  const storage = useStorage(t);
  const oldDefault = process.env.VITE_DEFAULT_SCENARIO;
  const oldScenario = process.env.SCENARIO;
  process.env.SCENARIO = 'mining';
  const cacheDir = path.resolve('tests', `.scenario-default-cache-${randomUUID()}`);
  const envDir = path.resolve('tests', `.scenario-default-no-env-${randomUUID()}`);
  let server;
  try {
    for (const [configured, expected] of [[undefined, 'factory'], ['mining', 'mining']]) {
      if (configured === undefined) delete process.env.VITE_DEFAULT_SCENARIO;
      else process.env.VITE_DEFAULT_SCENARIO = configured;
      server = await createServer({
        configFile: false,
        root: path.resolve('app'),
        envDir,
        cacheDir,
        logLevel: 'silent',
        appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, hmr: false, watch: null },
      });
      const registry = await server.ssrLoadModule('/src/usecases/registry.js');
      assert.equal(registry.readScenarioId(), expected);
      if (configured) {
        storage.setItem('iot-scenario', 'farm');
        assert.equal(registry.readScenarioId(), 'farm');
        storage.removeItem('iot-scenario');
        assert.equal(registry.readScenarioId(), 'mining');
      }
      await server.close();
      server = undefined;
    }
  } finally {
    await server?.close();
    if (oldDefault === undefined) delete process.env.VITE_DEFAULT_SCENARIO;
    else process.env.VITE_DEFAULT_SCENARIO = oldDefault;
    if (oldScenario === undefined) delete process.env.SCENARIO;
    else process.env.SCENARIO = oldScenario;
    await rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a production Vite build embeds the configured default without overriding a saved choice', async (t) => {
  const storage = useStorage(t);
  const oldDefault = process.env.VITE_DEFAULT_SCENARIO;
  const envDir = path.resolve('tests', `.scenario-default-no-env-${randomUUID()}`);
  const stubs = {
    './factory/catalog.js': 'export const createMachines = () => [];',
    './factory/profile.js': 'export const factoryProfile = { id: "factory" };',
    './factory/scene.js': 'export const initScene = () => {};',
    './farm/profile.js': 'export const farmProfile = { id: "farm" };',
    './farm/scene.js': 'export const initFarmScene = () => {};',
    './energy/profile.js': 'export const energyProfile = { id: "energy" };',
    './energy/scene.js': 'export const initEnergyScene = () => {};',
    './mining/profile.js': 'export const miningProfile = { id: "mining" };',
    './mining/scene.js': 'export const initMiningScene = () => {};',
    './pharma/profile.js': 'export const pharmaProfile = { id: "pharma" };',
    './pharma/scene.js': 'export const initPharmaScene = () => {};',
  };
  process.env.VITE_DEFAULT_SCENARIO = 'mining';
  try {
    const result = await build({
      configFile: false,
      root: path.resolve('app'),
      envDir,
      logLevel: 'silent',
      plugins: [{
        name: 'scenario-default-test-stubs',
        enforce: 'pre',
        resolveId(source) { if (Object.hasOwn(stubs, source)) return `\0scenario-default:${source}`; },
        load(id) { if (id.startsWith('\0scenario-default:')) return stubs[id.slice('\0scenario-default:'.length)]; },
      }],
      build: {
        write: false,
        copyPublicDir: false,
        minify: false,
        lib: { entry: path.resolve('app', 'src', 'usecases', 'registry.js'), formats: ['es'] },
      },
    });
    const output = Array.isArray(result) ? result[0] : result;
    const chunk = output.output.find((item) => item.type === 'chunk');
    const registry = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
    assert.equal(registry.readScenarioId(), 'mining');
    storage.setItem('iot-scenario', 'energy');
    assert.equal(registry.readScenarioId(), 'energy');
  } finally {
    if (oldDefault === undefined) delete process.env.VITE_DEFAULT_SCENARIO;
    else process.env.VITE_DEFAULT_SCENARIO = oldDefault;
  }
});
