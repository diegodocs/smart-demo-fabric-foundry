import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, mock, test } from 'node:test';
import { createEnergyAssets } from '../app/src/usecases/energy/catalog.js';
import { evaluate } from '../app/src/domain/rules.js';
import { createMachines } from '../app/src/usecases/factory/catalog.js';
import { machineSnapshot } from '../app/src/integration/agent/context.js';
import { extraTelemetry } from '../app/src/domain/telemetry.js';
import { createEnergySimulation } from '../app/src/usecases/energy/simulation.js';
import { createMockSource } from '../app/src/integration/telemetry/mock.js';
import { resetScenario, applyTelemetry, store } from '../app/src/core/state.js';

test('energy catalog covers exactly 40 monitored assets in six families', () => {
  const assets = createEnergyAssets();
  assert.equal(assets.length, 40);
  assert.equal(new Set(assets.map((m) => m.id)).size, 40);
  assert.equal(assets.filter((m) => m.type === 'solar-array').length, 10);
  assert.equal(assets.filter((m) => m.type === 'house').length, 10);
  assert.equal(assets.filter((m) => m.family === 'mobility').length, 6);
  assert.deepEqual(
    [...new Set(assets.map((m) => m.family))].sort(),
    ['charging', 'grid', 'hydro', 'mobility', 'residential', 'solar'],
  );
  assert.ok(assets.every((m) => m.metrics?.length === 3), 'every asset declares exactly 3 metrics');

  const gate = assets.find((m) => m.id === 'HID-TUR-003');
  assert.equal(gate.params.mode, 'off');
  assert.equal(gate.params.speed, 0);
  assert.equal(gate.isRunning, false);
  assert.equal(evaluate(gate).status, 'offline');
});

test('energy alerts reuse generic channels with catalog-declared labels (not farm/factory nouns)', () => {
  const assets = createEnergyAssets().map((m) => ({ ...m, ...evaluate(m) }));

  const soiledArray = assets.find((m) => m.id === 'SOL-ARR-003');
  assert.equal(soiledArray.status, 'alert');
  assert.match(soiledArray.reasons[0].text, /Sujidade do painel/);
  assert.doesNotMatch(soiledArray.reasons[0].text, /Umidade/);

  const weakInverter = assets.find((m) => m.id === 'SOL-INV-002');
  assert.equal(weakInverter.status, 'alert');
  assert.match(weakInverter.reasons[0].text, /Fator de potência/);
  assert.doesNotMatch(weakInverter.reasons[0].text, /Combustível/);

  const vibratingTurbine = assets.find((m) => m.id === 'HID-TUR-002');
  assert.equal(vibratingTurbine.status, 'alert');
  assert.match(vibratingTurbine.reasons.map((r) => r.text).join(' '), /Vibração elevada/);

  const overloadedCharger = assets.find((m) => m.id === 'EVC-TRK-001');
  assert.equal(overloadedCharger.status, 'alert');
  assert.match(overloadedCharger.reasons.map((r) => r.text).join(' '), /Corrente de carga elevada/);
  assert.doesNotMatch(overloadedCharger.reasons.map((r) => r.text).join(' '), /Atividade elevada/);
});

test("energy reuse of generic channels does not change factory machines' behavior", () => {
  const factory = createMachines()[0];
  assert.equal(factory.metrics, undefined);
  const evaluated = evaluate(factory);
  assert.equal(evaluated.status, 'online');
});

test('energy snapshot reaches state and assistant without manufacturing missing readings', () => {
  const devices = createEnergyAssets();
  const readings = createEnergySimulation(devices).snapshot();
  resetScenario(createEnergyAssets(), {}, { scenario: 'energy' });
  applyTelemetry(readings);
  const city = store.state.byId['RED-CID-001'];
  assert.ok(city.demandKw > 0);
  assert.equal(machineSnapshot(city).telemetry.demandKw, city.demandKw);
  applyTelemetry([{ machineId: city.id, ts: new Date().toISOString(), temp: 25, vib: 0, usage: 0, commLost: false }]);
  assert.equal(city.demandKw, undefined);
  assert.deepEqual(extraTelemetry({ powerKw: NaN, batteryPct: null, levelM: 0 }), { levelM: 0 });
});

test('mock energy uses the same integrated simulation contract', async () => {
  const source = createMockSource(createEnergyAssets(), { createSimulation: createEnergySimulation, intervalMs: 20 });
  try {
    const readings = await new Promise((resolve) => source.start({ onTelemetry: resolve }));
    assert.equal(readings.length, 40);
    assert.ok(readings.find((d) => d.machineId === 'RED-CID-001').demandKw > 0);
    assert.equal(typeof readings.find((d) => d.machineId === 'VEH-CAR-002').batteryPct, 'number');
  } finally { source.stop(); }
});

mock.module('../server/fabric.js', {
  exports: {
    fabricConfig: () => ({ pollMs: 50 }),
    canPublish: () => false,
    canQuery: () => false,
    latestTelemetry: () => { throw new Error('Loopback must not query Fabric'); },
    getCredential: () => { throw new Error('Control must not authenticate with Azure'); },
  },
});
process.env.API_PORT = '0';
process.env.FABRIC_LOOPBACK = 'true';
const { server } = await import('../server/index.js');
if (!server.listening) await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise((resolve, reject) => {
  server.close((err) => err ? reject(err) : resolve());
  server.closeIdleConnections();
}));

async function post(path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('the proxy serves the energy catalog under its own scenario, isolated from factory', async () => {
  const energy = await (await fetch(`${base}/api/devices/control?scenario=energy`)).json();
  assert.equal(energy.items.length, 40);
  assert.ok(energy.items.some((i) => i.machineId === 'SOL-ARR-001'));

  const factory = await (await fetch(`${base}/api/devices/control`)).json();
  assert.equal(factory.items.length, 16, 'omitting scenario must still default to factory');
  assert.ok(factory.items.some((i) => i.machineId === 'CNC-001'));
});

test('a machineId from another scenario is rejected (params and commands)', async () => {
  const badCommand = await post('/api/commands', { machineId: 'CNC-001', command: 'PAUSE', scenario: 'energy' });
  assert.equal(badCommand.status, 400);

  const device = createEnergyAssets()[0];
  const badParams = await post('/api/params', { machineId: 'CNC-001', params: device.params, scenario: 'energy' });
  assert.equal(badParams.status, 400);
});

test('commands applied to the energy scenario do not leak into the factory scenario', async () => {
  const ok = await post('/api/commands', { machineId: 'SOL-ARR-001', command: 'PAUSE', scenario: 'energy' });
  assert.equal(ok.status, 200);
  const energy = await (await fetch(`${base}/api/devices/control?scenario=energy`)).json();
  assert.equal(energy.items.find((i) => i.machineId === 'SOL-ARR-001').params.mode, 'paused');

  const factory = await (await fetch(`${base}/api/devices/control`)).json();
  assert.equal(factory.items.find((i) => i.machineId === 'CNC-001').params.mode, 'auto');
});

test('energy schemas preserve new limits and reject irrelevant or out-of-range controls', async () => {
  const house = createEnergyAssets().find((d) => d.id === 'CAS-001');
  const response = await post('/api/params', { machineId: house.id, scenario: 'energy', params: { ...house.params, supplyMin: 88 } });
  assert.equal(response.status, 200);
  const data = await (await fetch(`${base}/api/devices/control?scenario=energy`)).json();
  assert.equal(data.items.find((d) => d.machineId === house.id).params.supplyMin, 88);
  assert.equal((await post('/api/commands', { machineId: house.id, scenario: 'energy', command: 'CALIBRATE' })).status, 400);
  assert.equal((await post('/api/params', { machineId: house.id, scenario: 'energy', params: { ...house.params, supplyMin: 101 } })).status, 400);
  const gate = createEnergyAssets().find((d) => d.id === 'HID-COM-001');
  await post('/api/commands', { machineId: gate.id, scenario: 'energy', command: 'SPEED_UP' });
  const control = await (await fetch(`${base}/api/devices/control?scenario=energy`)).json();
  assert.equal(control.items.find((d) => d.machineId === gate.id).params.speed, 100);
});

test('loopback SSE streams the energy catalog when requested', async () => {
  const abort = new AbortController();
  const response = await fetch(`${base}/api/telemetry/stream?scenario=energy`, { signal: abort.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!text.includes('event: telemetry')) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      text += decoder.decode(value, { stream: true });
    }
    const match = /event: telemetry\ndata: (.+)\n/.exec(text);
    assert.ok(match);
    const items = JSON.parse(match[1]).items;
    assert.equal(items.length, 40);
    assert.ok(items.every((i) => i.machineId.match(/^(SOL|HID|EVC|CAS|VEH|RED)-/)));
    assert.ok(items.find((i) => i.machineId === 'RED-CID-001').demandKw > 0);
    assert.equal(typeof items.find((i) => i.machineId === 'VEH-CAR-001').batteryPct, 'number');
  } finally {
    abort.abort();
    await reader.cancel().catch((e) => {
      if (e.name !== 'AbortError') throw e;
    });
  }
});
