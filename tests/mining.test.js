import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMiningAssets, miningKb } from '../app/src/usecases/mining/catalog.js';
import { miningProfile } from '../app/src/usecases/mining/profile.js';
import { createMiningSimulation } from '../app/src/usecases/mining/simulation.js';
import { createMachines } from '../app/src/usecases/factory/catalog.js';
import { createFarmAssets } from '../app/src/usecases/farm/catalog.js';
import { createEnergyAssets } from '../app/src/usecases/energy/catalog.js';
import { extraTelemetry } from '../app/src/domain/telemetry.js';
import { evaluate } from '../app/src/domain/rules.js';
import { createMockSource } from '../app/src/integration/telemetry/mock.js';
import { answer, createMockAgent } from '../app/src/integration/agent/mock.js';
import { buildContext, machineSnapshot } from '../app/src/integration/agent/context.js';
import { applyTelemetry, resetScenario, store } from '../app/src/core/state.js';
import { MINING_HAUL_ROUTES, MINING_POSITIONS, miningDeliveryRoute, miningRouteLength, miningRoutePose } from '../app/src/usecases/mining/layout.js';

function setup() {
  const devices = createMiningAssets();
  return {
    devices,
    byId: Object.fromEntries(devices.map((device) => [device.id, device])),
    simulation: createMiningSimulation(devices),
  };
}

function accountedMass(byId) {
  return Object.values(byId).reduce((sum, device) => sum + (device.inventoryT || 0) + (device.payloadT || 0)
    + (device.tailingsT || 0) + (device.type === 'distribution-center' ? device.deliveredT : 0), 0);
}

test('mining has isolated assets, optional integrations and knowledge for every stage', () => {
  const { devices, simulation } = setup();
  assert.equal(miningProfile.forceMock, false);
  assert.equal(devices.length, 21);
  for (const [type, count] of [['haul-truck', 4], ['crusher', 3], ['product-silo', 6], ['distribution-center', 3]]) {
    assert.equal(devices.filter((device) => device.type === type).length, count, type);
  }
  assert.equal(new Set(devices.map((device) => device.id)).size, devices.length);
  assert.ok(devices.every((device) => device.metrics.length === 3 && miningKb[device.type]));
  const otherIds = new Set([...createMachines(), ...createFarmAssets(), ...createEnergyAssets()].map((device) => device.id));
  assert.ok(devices.every((device) => !otherIds.has(device.id)));
  assert.deepEqual(simulation.snapshot().map((reading) => reading.machineId), devices.map((device) => device.id));
  assert.ok(miningProfile.commandsFor(devices[0]).some((command) => command.id === 'PAUSE'));
});

test('ore, product, vehicle loads, deliveries and tailings conserve mass within capacity', () => {
  const { devices, byId, simulation } = setup();
  let delivered = 0;
  for (let second = 0; second < 300; second++) {
    simulation.step(1);
    assert.ok(Math.abs(accountedMass(byId) - byId['MIN-EXC-001'].extractedT) < 1e-8);
    for (const device of devices) {
      for (const key of ['inventoryT', 'payloadT']) {
        if (Number.isFinite(device[key])) {
          assert.ok(device[key] >= -1e-9, `${device.id}.${key} below zero`);
          assert.ok(device[key] <= device.capacityT + 1e-9, `${device.id}.${key} above capacity`);
        }
      }
    }
    assert.ok(byId['MIN-TER-001'].deliveredT >= delivered);
    delivered = byId['MIN-TER-001'].deliveredT;
  }
  assert.ok(delivered > 50);
  assert.ok(byId['MIN-PRC-001'].tailingsT > 0);
});

test('paused and disconnected equipment cannot generate flow', () => {
  const stages = [
    'MIN-EXC-001', 'MIN-BRI-001', 'MIN-BRI-002', 'MIN-BRI-003', 'MIN-CNV-001', 'MIN-PRC-001',
    ...Array.from({ length: 6 }, (_, index) => `MIN-SIL-00${index + 1}`),
    'MIN-TER-001', 'MIN-DIS-001', 'MIN-DIS-002', 'MIN-DIS-003',
  ];
  for (const condition of ['paused', 'off', 'disconnected', 'zero-speed']) {
    for (const id of stages) {
      const { byId, simulation } = setup();
      simulation.step(20);
      const device = byId[id];
      const extracted = byId['MIN-EXC-001'].extractedT;
      const tailings = byId['MIN-PRC-001'].tailingsT;
      const inventory = device.inventoryT;
      const received = device.deliveredT;
      const delivered = byId['MIN-TER-001'].deliveredT;
      if (condition === 'disconnected') device.commLost = true;
      else if (condition === 'zero-speed') device.params.speed = 0;
      else device.params.mode = condition;
      const readings = simulation.step(4);
      assert.equal(device.throughputTph, 0, `${id} (${condition})`);
      assert.equal(device.isRunning, false, `${id} (${condition})`);
      if (id === 'MIN-EXC-001') assert.equal(device.extractedT, extracted);
      if (id === 'MIN-CNV-001') assert.equal(byId['MIN-BRI-001'].throughputTph, 0);
      if (id === 'MIN-PRC-001') assert.equal(device.tailingsT, tailings);
      if (device.type === 'product-silo') assert.equal(device.inventoryT, inventory);
      if (device.type === 'distribution-center') assert.equal(device.deliveredT, received);
      if (id === 'MIN-TER-001') assert.equal(device.deliveredT, delivered);
      if (condition === 'disconnected') assert.ok(!readings.some((reading) => reading.machineId === id));
      assert.ok(Math.abs(accountedMass(byId) - byId['MIN-EXC-001'].extractedT) < 1e-8);
    }
  }
});

test('a stopped truck preserves its position and load, then continues its route', () => {
  for (const id of ['MIN-HAU-001', 'MIN-HAU-002', 'MIN-HAU-003', 'MIN-HAU-004', 'MIN-TRK-001']) {
    const { byId, simulation } = setup();
    const truck = byId[id];
    for (let i = 0; i < 30 && !['hauling', 'delivering'].includes(truck.vehicleState); i++) simulation.step(1);
    assert.ok(['hauling', 'delivering'].includes(truck.vehicleState), id);
    truck.params.mode = 'paused';
    const before = [truck.positionX, truck.positionZ, truck.payloadT];
    simulation.step(5);
    assert.deepEqual([truck.positionX, truck.positionZ, truck.payloadT], before);
    assert.equal(truck.vehicleState, 'stopped');
    assert.equal(truck.speedKmh, 0);
    truck.params.mode = 'auto';
    simulation.step(1);
    assert.ok(truck.positionX > before[0]);
    assert.ok(['hauling', 'delivering', 'unloading'].includes(truck.vehicleState));
  }
});

test('all added facilities participate in flow and terminal totals do not double-count deliveries', () => {
  const { devices, byId, simulation } = setup();
  const used = new Set();
  for (let second = 0; second < 1200; second++) {
    simulation.step(1);
    for (const device of devices) {
      if (device.throughputTph > 0 || device.payloadT > 0 || device.inventoryT > 0 || device.deliveredT > 0) used.add(device.id);
      if (Number.isFinite(device.capacityT)) {
        assert.ok((device.inventoryT ?? device.payloadT) <= device.capacityT + 1e-8, device.id);
      }
    }
    assert.ok(Math.abs(accountedMass(byId) - byId['MIN-EXC-001'].extractedT) < 1e-8);
    assert.ok(Math.abs(devices.filter((device) => device.type === 'distribution-center')
      .reduce((sum, device) => sum + device.deliveredT, 0) - byId['MIN-TER-001'].deliveredT) < 1e-8);
  }
  assert.ok(devices.every((device) => used.has(device.id)));
  assert.ok(devices.filter((device) => device.type === 'distribution-center').every((device) => device.deliveredT > 0));
});

test('independent crusher, silo and distribution branches continue around a paused peer', () => {
  const { byId, devices, simulation } = setup();
  byId['MIN-BRI-002'].params.mode = 'paused';
  byId['MIN-SIL-002'].params.mode = 'paused';
  byId['MIN-DIS-002'].params.mode = 'paused';
  simulation.step(600);
  assert.equal(byId['MIN-SIL-002'].inventoryT, 0);
  assert.equal(byId['MIN-DIS-002'].deliveredT, 0);
  assert.ok(byId['MIN-TER-001'].deliveredT > 0);
  assert.ok(devices.filter((device) => device.type === 'product-silo' && device.id !== 'MIN-SIL-002')
    .every((device) => device.inventoryT > 0));
  assert.ok(Math.abs(accountedMass(byId) - byId['MIN-EXC-001'].extractedT) < 1e-8);
});

test('three illustrative sensor alerts remain visible after the initial transient', () => {
  const { byId, simulation } = setup();
  for (const seconds of [0, 60, 300, 900]) {
    simulation.step(seconds);
    for (const id of ['MIN-BRI-002', 'MIN-SIL-005', 'MIN-DIS-002']) {
      assert.equal(evaluate(byId[id]).status, 'alert', `${id} after ${seconds}s`);
      assert.ok(evaluate(byId[id]).reasons.some((reason) => /Vibração|Temperatura/.test(reason.text)));
    }
  }
  byId['MIN-BRI-002'].params.vibLimit = 3;
  byId['MIN-SIL-005'].params.tempLimit = 110;
  byId['MIN-DIS-002'].params.tempLimit = 110;
  for (const id of ['MIN-BRI-002', 'MIN-SIL-005', 'MIN-DIS-002']) assert.equal(evaluate(byId[id]).status, 'online');
});

test('haul routes are separate and delivery waypoints do not teleport between silos', () => {
  const { devices, simulation } = setup();
  for (const [id, route] of Object.entries(MINING_HAUL_ROUTES)) {
    assert.equal(miningRouteLength(route.points), 14);
    assert.equal(miningRoutePose(route.points, 0).z, devices.find((device) => device.id === id).positionZ);
  }
  assert.deepEqual(MINING_POSITIONS.haulStarts.map((point) => point[2]), [-17, -7, 3, 13]);
  const pickup = devices.find((device) => device.id === 'MIN-SIL-006');
  const center = devices.find((device) => device.id === 'MIN-DIS-003');
  const route = miningDeliveryRoute(pickup, center);
  assert.equal(miningRoutePose(route, miningRouteLength(route)).x, center.pos[0]);
  const trucks = devices.filter((device) => device.family === 'transport');
  for (let tick = 0; tick < 2400; tick++) {
    const before = trucks.map((truck) => [truck.positionX, truck.positionZ]);
    simulation.step(0.25);
    trucks.forEach((truck, index) => {
      assert.ok(Math.hypot(truck.positionX - before[index][0], truck.positionZ - before[index][1]) <= 0.625 + 1e-8, truck.id);
    });
    const haulers = trucks.filter((truck) => truck.type === 'haul-truck');
    for (let a = 0; a < haulers.length; a++) {
      for (let b = a + 1; b < haulers.length; b++) {
        assert.ok(Math.hypot(haulers[a].positionX - haulers[b].positionX, haulers[a].positionZ - haulers[b].positionZ) >= 10);
      }
    }
  }
});

test('the terminal records a delivery only after it becomes available', () => {
  const { byId, simulation } = setup();
  const terminal = byId['MIN-TER-001'];
  const truck = byId['MIN-TRK-001'];
  terminal.params.mode = 'paused';
  simulation.step(60);
  assert.equal(terminal.deliveredT, 0);
  assert.equal(truck.vehicleState, 'unloading');
  assert.ok(truck.payloadT > 0);
  terminal.params.mode = 'auto';
  simulation.step(2);
  assert.ok(terminal.deliveredT > 0);
  assert.ok(Math.abs(accountedMass(byId) - byId['MIN-EXC-001'].extractedT) < 1e-8);
});

test('a distribution center paused during a trip retains the load until receiving is resumed', () => {
  const { byId, simulation } = setup();
  const truck = byId['MIN-TRK-001'], center = byId['MIN-DIS-001'];
  for (let second = 0; second < 120 && truck.vehicleState !== 'unloading'; second++) simulation.step(1);
  assert.equal(truck.vehicleState, 'unloading');
  center.params.mode = 'paused';
  const before = [truck.payloadT, center.deliveredT, byId['MIN-TER-001'].deliveredT];
  simulation.step(10);
  assert.deepEqual([truck.payloadT, center.deliveredT, byId['MIN-TER-001'].deliveredT], before);
  center.params.mode = 'auto';
  simulation.step(2);
  assert.ok(center.deliveredT > before[1]);
  assert.ok(Math.abs(accountedMass(byId) - byId['MIN-EXC-001'].extractedT) < 1e-8);
});

test('a partially loaded truck delivers remaining product when upstream flow stops', () => {
  const { byId, simulation } = setup();
  byId['MIN-PRC-001'].params.mode = 'paused';
  byId['MIN-SIL-001'].inventoryT = 4;
  byId['MIN-EXC-001'].extractedT -= 4;
  simulation.step(25);
  assert.ok(byId['MIN-TER-001'].deliveredT > 0);
  assert.ok(byId['MIN-TER-001'].deliveredT <= 4 + 1e-9);
  assert.ok(Math.abs(accountedMass(byId) - byId['MIN-EXC-001'].extractedT) < 1e-8);
});

test('simulation subdivides time deterministically and rejects invalid intervals', () => {
  const a = setup(), b = setup();
  a.simulation.step(100);
  for (let i = 0; i < 400; i++) b.simulation.step(0.25);
  for (const device of a.devices) {
    const other = b.byId[device.id];
    for (const key of ['inventoryT', 'payloadT', 'extractedT', 'tailingsT', 'deliveredT', 'positionX', 'positionZ']) {
      if (Number.isFinite(device[key])) assert.ok(Math.abs(device[key] - other[key]) < 1e-9, `${device.id}.${key}`);
    }
    assert.equal(device.vehicleState, other.vehicleState);
  }
  for (const invalid of [-1, NaN, Infinity, 3601]) assert.throws(() => a.simulation.step(invalid), /intervalo/i);
  assert.throws(() => createMiningSimulation([]), /incompleto/i);
});

test('mining telemetry reaches the store, KPIs and assistant without factory production', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const devices = createMiningAssets();
  resetScenario(devices, miningProfile.initialKpis, { scenario: 'mining', plant: miningProfile.plant });
  const source = createMockSource(devices, { createSimulation: createMiningSimulation });
  const received = [];
  source.start({ onTelemetry(items, meta) { received.push(items); applyTelemetry(items, meta); } });
  t.mock.timers.tick(400);
  t.mock.timers.tick(200);
  t.mock.timers.tick(1000);
  t.mock.timers.tick(200);
  source.stop();

  assert.ok(received.length >= 2);
  assert.ok(store.state.byId['MIN-EXC-001'].extractedT > 31);
  assert.equal(store.state.kpis.pieces, 0);
  assert.equal(typeof store.state.byId['MIN-TRK-001'].vehicleState, 'string');
  assert.ok(miningProfile.kpiRows(store.state).some((row) => row.label === 'Produto entregue'));
  const context = buildContext(store.state);
  assert.equal(context.scenario, 'mining');
  assert.equal(context.machines.find((machine) => machine.id === 'MIN-EXC-001').telemetry.extractedT,
    store.state.byId['MIN-EXC-001'].extractedT);
  assert.deepEqual(extraTelemetry({ inventoryT: NaN, payloadT: Infinity, vehicleState: 'invented' }), {});
});

test('local assistant explains the chain, commands and live mining totals', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { devices, simulation } = setup();
  simulation.step(30);
  for (const device of devices) Object.assign(device, evaluate(device));
  const byId = Object.fromEntries(devices.map((device) => [device.id, device]));
  const context = buildContext({ machines: devices, byId, selectedId: null, scenario: 'mining', plant: miningProfile.plant });
  const snapshotOf = (id) => machineSnapshot(byId[id]);
  const pack = { kb: miningKb, ...miningProfile.assistant };
  assert.match(answer('Como funciona MIN-PRC-001?', context, snapshotOf, pack), /90%.*produto/);
  assert.match(answer('Quais comandos posso enviar?', context, snapshotOf, pack), /PAUSE/);
  assert.match(answer('Como funciona MIN-DIS-002?', context, snapshotOf, pack), /três centros/);
  const agent = createMockAgent({ snapshotOf, kb: miningKb, assistant: miningProfile.assistant });
  const reply = agent.send('Resumo da mina', context);
  t.mock.timers.tick(1500);
  assert.match((await reply).text, /entregues.*rejeitos/);
  const stock = devices.filter((device) => device.type === 'product-silo').reduce((sum, device) => sum + device.inventoryT, 0);
  assert.ok(miningProfile.kpiRows({ machines: devices, byId, kpis: { commands: 0, paramChanges: 0 } })
    .some((row) => row.label === 'Produto nos silos' && row.value === `${stock.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`));
});
