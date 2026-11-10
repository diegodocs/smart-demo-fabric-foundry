import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPharmaAssets, pharmaKb, pharmaParamSchema } from '../app/src/usecases/pharma/catalog.js';
import { createPharmaSimulation } from '../app/src/usecases/pharma/simulation.js';
import { pharmaProfile } from '../app/src/usecases/pharma/profile.js';
import { CITY_CAR_RADIUS, CITY_ROADS, CITY_TRAFFIC_COUNT, CITY_TRAFFIC_ROUTES,
  cityTruckObstacles, createCityTraffic, stepCityTraffic } from '../app/src/usecases/pharma/cityTraffic.js';
import { createTruckMotion, updateTruckMotion } from '../app/src/usecases/pharma/truckMotion.js';
import { PHARMA_LAYOUT, pharmaDock } from '../app/src/usecases/pharma/layout.js';
import { evaluate } from '../app/src/domain/rules.js';
import { metricOver } from '../app/src/domain/metrics.js';
import { routePose } from '../app/src/domain/routes.js';
import { extraTelemetry } from '../app/src/domain/telemetry.js';
import { resetScenario, applyTelemetry, attachTelemetrySource, sendCommand, setConnection, store } from '../app/src/core/state.js';
import { buildContext, machineSnapshot } from '../app/src/integration/agent/context.js';
import { answer } from '../app/src/integration/agent/mock.js';
import { createMockSource } from '../app/src/integration/telemetry/mock.js';
import { createDeviceControl } from '../server/deviceControl.js';

function setup() {
  const devices = createPharmaAssets();
  devices.forEach((asset) => { asset.commLost = false; asset.status = 'online'; });
  return { devices, simulation: createPharmaSimulation(devices) };
}
const accounted = (devices) => devices.reduce((sum, asset) => sum + asset.inventoryUnits + asset.quarantinedUnits + asset.deliveredUnits, 0);

test('houses clear pharmacy lots, loading docks, other houses and city streets', () => {
  const pharmacies = createPharmaAssets().filter((asset) => asset.type === 'pharma-pharmacy');
  for (const [index, house] of PHARMA_LAYOUT.houses.entries()) {
    const half = 5.6 / Math.sqrt(2) * (house.scale ?? 1);
    for (const pharmacy of pharmacies) {
      assert.ok(Math.abs(house.x - pharmacy.pos[0]) > half + 8
        || Math.abs(house.z - pharmacy.pos[2]) > half + 7.5, pharmacy.id);
      const dock = pharmaDock(pharmacy);
      assert.ok(Math.abs(house.x - dock.x) > half + 4
        || Math.abs(house.z - dock.z) > half + 1.5, `${pharmacy.id} dock`);
    }
    for (const other of PHARMA_LAYOUT.houses.slice(index + 1)) {
      const otherHalf = 5.6 / Math.sqrt(2) * (other.scale ?? 1);
      assert.ok(Math.abs(house.x - other.x) > half + otherHalf
        || Math.abs(house.z - other.z) > half + otherHalf);
    }
    for (const z of [CITY_ROADS.north, CITY_ROADS.south]) {
      assert.ok(Math.abs(house.z - z) > half + CITY_ROADS.width / 2);
    }
    for (const x of [CITY_ROADS.left, CITY_ROADS.shortcut, CITY_ROADS.right]) {
      assert.ok(house.z + half < CITY_ROADS.north - CITY_ROADS.width / 2
        || Math.abs(house.x - x) > half + CITY_ROADS.width / 2);
    }
  }
});

test('two trucks start connected and move without stock while three stay offline', () => {
  const devices = createPharmaAssets();
  const simulation = createPharmaSimulation(devices);
  const trucks = devices.filter((asset) => asset.type === 'pharma-truck');
  assert.deepEqual(trucks.map((truck) => truck.commLost), [false, false, true, true, true]);
  const before = trucks.map((truck) => [truck.positionX, truck.positionZ]);
  const readings = simulation.step(1);
  trucks.forEach((truck, index) => {
    const distance = Math.hypot(truck.positionX - before[index][0], truck.positionZ - before[index][1]);
    assert.equal(distance > 0, index < 2, truck.id);
    assert.equal(truck.isRunning, index < 2);
    assert.equal(readings.some((reading) => reading.machineId === truck.id), index < 2);
  });
  assert.equal(accounted(devices), 0);
  simulation.step(600);
  assert.equal(accounted(devices), devices[0].receivedUnits);
  assert.ok(devices.some((asset) => asset.type === 'pharma-pharmacy' && asset.deliveredUnits > 0));
  trucks.slice(2).forEach((truck, index) => {
    assert.deepEqual([truck.positionX, truck.positionZ], before[index + 2]);
    assert.equal(truck.inventoryUnits, 0);
    assert.equal(truck.commLost, true);
  });
});

test('HTTP start and resume reconnect offline trucks and publish moving positions', () => {
  for (const command of ['CYCLE_START', 'RESUME']) {
    const control = createDeviceControl(createPharmaAssets);
    const devices = Object.values(control.devices);
    const simulation = createPharmaSimulation(devices);
    const truck = devices.find((asset) => asset.id === 'PHA-TRK-003');
    const before = [truck.positionX, truck.positionZ];
    control.command(truck.id, command);
    const reading = simulation.step(1).find((item) => item.machineId === truck.id);
    assert.equal(truck.commLost, false);
    assert.ok(reading.isRunning && reading.speedKmh > 0);
    assert.ok(Math.hypot(reading.positionX - before[0], reading.positionZ - before[1]) > 0);
    control.command(truck.id, 'PAUSE');
    const paused = [truck.positionX, truck.positionZ];
    simulation.step(1);
    assert.deepEqual([truck.positionX, truck.positionZ], paused);
    control.command(truck.id, command);
    simulation.step(1);
    assert.notDeepEqual([truck.positionX, truck.positionZ], paused);
  }
});

test('city car routes follow the streets without crossing pharmacy buildings', () => {
  const pharmacies = createPharmaAssets().filter((asset) => asset.type === 'pharma-pharmacy');
  for (const route of CITY_TRAFFIC_ROUTES) {
    for (let distance = 0; distance < route.length; distance += 0.25) {
      const { x, z } = routePose(route, distance);
      const horizontal = [CITY_ROADS.north, CITY_ROADS.south].some((road) =>
        Math.abs(z - road) <= CITY_ROADS.width / 2 && x >= CITY_ROADS.left - 3 && x <= CITY_ROADS.right + 3);
      const vertical = [CITY_ROADS.left, CITY_ROADS.shortcut, CITY_ROADS.right].some((road) =>
        Math.abs(x - road) <= CITY_ROADS.width / 2 && z >= CITY_ROADS.north - 3 && z <= CITY_ROADS.south + 3);
      assert.ok(horizontal || vertical, `fora da rua: ${x}, ${z}`);
      for (const pharmacy of pharmacies) {
        assert.ok(Math.abs(x - pharmacy.pos[0]) > 5.5 + CITY_CAR_RADIUS
          || Math.abs(z - pharmacy.pos[2]) > 4.5 + CITY_CAR_RADIUS, pharmacy.id);
      }
    }
  }
});

test('five city cars move with varying speeds and routes while maintaining clearance', () => {
  let seed = 34;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const obstacles = [{ x: 0, z: -34, radius: 4 }];
  const cars = createCityTraffic(obstacles, random);
  assert.equal(cars.length, CITY_TRAFFIC_COUNT);
  const travelled = cars.map(() => 0);
  const routes = new Set(cars.map((car) => car.routeIndex));
  const speeds = cars.map(() => new Set());
  for (let tick = 0; tick < 8000; tick++) {
    stepCityTraffic(cars, 0.1, obstacles, random);
    cars.forEach((car, index) => {
      travelled[index] += car.travelled;
      speeds[index].add(car.targetSpeed);
      routes.add(car.routeIndex);
      for (const other of [...obstacles, ...cars.filter((item) => item !== car).map((item) => ({ ...item, radius: CITY_CAR_RADIUS }))]) {
        assert.ok(Math.hypot(car.x - other.x, car.z - other.z) >= CITY_CAR_RADIUS + other.radius + 0.45 - 1e-8);
      }
    });
  }
  assert.ok(travelled.every((distance) => distance > 30));
  assert.ok(speeds.every((values) => values.size > 1));
  assert.equal(routes.size, CITY_TRAFFIC_ROUTES.length);
  assert.throws(() => stepCityTraffic(cars, NaN), /inválido/);
});

test('a city car waits for an obstacle and continues after the road clears', () => {
  let seed = 120;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const cars = createCityTraffic([], random);
  const car = cars[0];
  const ahead = routePose(CITY_TRAFFIC_ROUTES[car.routeIndex], car.distance + 6);
  const obstacle = { ...ahead, radius: 1.8 };
  for (let tick = 0; tick < 100; tick++) stepCityTraffic(cars, 0.1, [obstacle], random);
  const stoppedAt = [car.x, car.z];
  assert.equal(car.speed, 0);
  for (let tick = 0; tick < 100; tick++) stepCityTraffic(cars, 0.1, [], random);
  assert.ok(Math.hypot(car.x - stoppedAt[0], car.z - stoppedAt[1]) > 1);
});

test('a truck at a pharmacy dock does not permanently block the city street', () => {
  let seed = 120;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  const obstacles = cityTruckObstacles([{ x: 0, z: 5, heading: 0 }]);
  const cars = createCityTraffic(obstacles, random);
  const travelled = cars.map(() => 0);
  for (let tick = 0; tick < 8000; tick++) {
    stepCityTraffic(cars, 0.1, obstacles, random);
    cars.forEach((car, index) => { travelled[index] += car.travelled; });
  }
  assert.ok(travelled.every((distance) => distance > 30), travelled.join(', '));
});

test('truck animation interpolates measured samples and freezes without telemetry', () => {
  const truck = createTruckMotion(0, 20, Math.PI / 2);
  const reading = {
    positionX: 0, positionZ: 20, heading: Math.PI / 2, speedKmh: 10,
    isRunning: true, commLost: false, lastSeen: 1000,
  };
  assert.equal(updateTruckMotion(truck, reading, 0).x, 0);
  reading.positionX = 20;
  reading.lastSeen = 11000;
  assert.equal(updateTruckMotion(truck, reading, 10000).x, 0);
  const halfway = updateTruckMotion(truck, reading, 15000);
  assert.equal(halfway.x, 10);
  assert.equal(halfway.z, 20);
  assert.ok(halfway.travelled > 0);
  reading.commLost = true;
  const offline = updateTruckMotion(truck, reading, 16000);
  assert.equal(offline.x, halfway.x);
  assert.equal(offline.travelled, 0);
  reading.commLost = false;
  reading.positionX = 30;
  reading.lastSeen = 21000;
  assert.equal(updateTruckMotion(truck, reading, 21000).x, 30);
  reading.positionX = 35;
  reading.lastSeen = 31000;
  reading.isRunning = false;
  reading.speedKmh = 0;
  const stopped = updateTruckMotion(truck, reading, 31000);
  assert.equal(stopped.x, 35);
  assert.equal(stopped.travelled, 0);
  assert.equal(updateTruckMotion(truck, reading, 32000).x, 35);
});

test('truck animation follows the connecting road between different delivery spurs', () => {
  const truck = createTruckMotion(0, 5, 0);
  const reading = {
    positionX: 0, positionZ: 5, heading: 0, speedKmh: 12,
    isRunning: true, commLost: false, lastSeen: 1000,
  };
  updateTruckMotion(truck, reading, 0);
  Object.assign(reading, { positionX: 10, positionZ: 10, lastSeen: 11000 });
  updateTruckMotion(truck, reading, 10000);
  const midway = updateTruckMotion(truck, reading, 15000);
  assert.equal(midway.z, 20);
  assert.equal(midway.x, 2.5);
  const arrived = updateTruckMotion(truck, reading, 20000);
  assert.equal(arrived.x, 10);
  assert.equal(arrived.z, 10);
});

test('pharma catalog covers 15 assets with preserved IDs, isolated instances, schemas and knowledge', () => {
  const { devices, simulation } = setup();
  assert.equal(devices.length, 15);
  assert.equal(new Set(devices.map((asset) => asset.id)).size, 15);
  assert.equal(simulation.snapshot().length, 15);
  for (const [type, count] of [['pharma-truck', 5], ['pharma-distribution', 2], ['pharma-pharmacy', 3]]) {
    assert.equal(devices.filter((asset) => asset.type === type).length, count);
  }
  for (const id of ['PHA-REC-001', 'PHA-PRD-001', 'PHA-QUA-001', 'PHA-EMB-001',
    'PHA-ARM-001', 'PHA-TRK-001', 'PHA-DIS-001', 'PHA-FAR-001']) {
    assert.ok(devices.some((asset) => asset.id === id), id);
  }
  for (const asset of devices) {
    assert.ok(pharmaKb[asset.type]);
    assert.equal(asset.metrics.length, 3);
    for (const [key, spec] of Object.entries(pharmaParamSchema(asset.type))) {
      assert.ok(key in asset.params, `${asset.id}.${key}`);
      if (spec.kind !== 'select') assert.ok(asset.params[key] >= spec.min && asset.params[key] <= spec.max);
    }
  }
  devices[0].params.speed = 0;
  assert.equal(createPharmaAssets()[0].params.speed, 100);
  assert.throws(() => createPharmaSimulation(devices.slice(1)), /incompleto/);
  for (const dt of [-1, NaN, Infinity, 3601]) assert.throws(() => simulation.step(dt), /inválido/);
});

test('linked batches conserve units, respect capacities, reach the consumer and retain their ID', () => {
  const { devices, simulation } = setup();
  const visited = new Set();
  const route = [];
  let delivered = 0;
  for (let second = 0; second < 600; second++) {
    simulation.step(1);
    assert.equal(accounted(devices), devices[0].receivedUnits);
    for (const asset of devices) {
      assert.ok(asset.inventoryUnits >= 0 && asset.inventoryUnits <= asset.capacityUnits, asset.id);
      if (asset.batchId === 'LOT-00001') {
        visited.add(asset.id);
        if (route.at(-1) !== asset.type) route.push(asset.type);
      }
    }
    const total = devices.filter((asset) => asset.type === 'pharma-pharmacy')
      .reduce((sum, asset) => sum + asset.deliveredUnits, 0);
    assert.ok(total >= delivered);
    delivered = total;
  }
  assert.equal(visited.size, 9);
  assert.deepEqual(route, ['pharma-receiving', 'pharma-production', 'pharma-quality', 'pharma-packaging',
    'pharma-storage', 'pharma-truck', 'pharma-distribution', 'pharma-truck', 'pharma-pharmacy']);
  assert.ok(delivered >= 1000, String(delivered));
  assert.ok(devices[2].quarantinedUnits >= 100);
  assert.equal(devices.filter((asset) => asset.cold).reduce((sum, asset) => sum + asset.quarantinedUnits, 0), 0);
});

test('all trucks, both centers and three pharmacies participate without exceeding capacities', () => {
  const { devices, simulation } = setup();
  const moved = new Set(), states = new Set();
  for (let second = 0; second < 1800; second++) {
    const previous = new Map(devices.filter((asset) => asset.type === 'pharma-truck')
      .map((truck) => [truck.id, [truck.positionX, truck.positionZ]]));
    simulation.step(1);
    for (const asset of devices) {
      assert.ok(asset.inventoryUnits <= asset.capacityUnits, asset.id);
      if (asset.type !== 'pharma-truck') continue;
      const [x, z] = previous.get(asset.id);
      const distance = Math.hypot(asset.positionX - x, asset.positionZ - z);
      assert.ok(distance <= 80 / asset.params.cycleTime + 1e-6, asset.id);
      if (distance > 0) moved.add(asset.id);
      states.add(asset.vehicleState);
    }
    assert.equal(accounted(devices), devices[0].receivedUnits);
  }
  assert.equal(moved.size, 5);
  assert.ok(['loading', 'unloading', 'delivering', 'returning'].every((state) => states.has(state)));
  for (const asset of devices.filter((item) => item.type === 'pharma-truck' || item.type === 'pharma-distribution')) {
    assert.ok(asset.processedBatches > 0, asset.id);
  }
  for (const pharmacy of devices.filter((item) => item.type === 'pharma-pharmacy')) {
    assert.ok(pharmacy.deliveredUnits > 0, pharmacy.id);
  }
});

test('unavailable branches do not block other destinations and resume without losing lots', () => {
  const { devices, simulation } = setup();
  const unavailable = devices.filter((asset) => ['PHA-DIS-002', 'PHA-FAR-002', 'PHA-FAR-003'].includes(asset.id));
  unavailable.forEach((asset) => { asset.params.mode = 'paused'; });
  simulation.step(1000);
  assert.ok(devices.find((asset) => asset.id === 'PHA-FAR-001').deliveredUnits > 0);
  assert.ok(unavailable.every((asset) => asset.inventoryUnits === 0 && asset.deliveredUnits === 0));
  assert.equal(accounted(devices), devices[0].receivedUnits);
  unavailable.forEach((asset) => { asset.params.mode = 'auto'; });
  simulation.step(1000);
  for (const asset of unavailable) assert.ok(asset.processedBatches > 0, asset.id);
  assert.equal(accounted(devices), devices[0].receivedUnits);
  assert.ok(devices.every((asset) => asset.inventoryUnits <= asset.capacityUnits));
});

test('reserved destinations can pause while shipments wait and resume without duplication', () => {
  const { devices, simulation } = setup();
  const centers = devices.filter((asset) => asset.type === 'pharma-distribution');
  centers[1].params.mode = 'paused';
  for (let second = 0; second < 500 && !devices.some((asset) =>
    asset.type === 'pharma-truck' && asset.inventoryUnits > 0); second++) simulation.step(1);
  assert.ok(devices.some((asset) => asset.type === 'pharma-truck' && asset.inventoryUnits > 0));
  centers[0].params.mode = 'paused';
  simulation.step(150);
  assert.equal(accounted(devices), devices[0].receivedUnits);
  assert.ok(devices.every((asset) => asset.inventoryUnits <= asset.capacityUnits));
  centers[0].params.mode = 'auto';
  simulation.step(500);
  assert.ok(devices.some((asset) => asset.type === 'pharma-pharmacy' && asset.deliveredUnits > 0));
  assert.equal(accounted(devices), devices[0].receivedUnits);
});

test('every fifth lot is blocked by quality and cannot enter packaging', () => {
  const { devices, simulation } = setup();
  for (let second = 0; second < 400; second++) {
    simulation.step(1);
    for (const asset of devices.slice(3)) {
      if (asset.batchId) assert.notEqual(Number(asset.batchId.slice(4)) % 5, 0, asset.id);
    }
  }
  assert.ok(devices[2].quarantinedUnits > 0);
  assert.equal(evaluate(devices[2]).status, 'alert');
});

test('paused, off, disconnected and zero-speed stages cannot receive or process lots', () => {
  for (const condition of ['paused', 'off', 'disconnected', 'zero']) {
    for (let index = 0; index < 15; index++) {
      const { devices, simulation } = setup();
      simulation.step(100);
      const asset = devices[index];
      const before = asset.inventoryUnits + asset.quarantinedUnits;
      const processed = asset.processedBatches, delivered = asset.deliveredUnits;
      if (condition === 'disconnected') asset.commLost = true;
      else if (condition === 'zero') asset.params.speed = 0;
      else asset.params.mode = condition;
      const readings = simulation.step(10);
      assert.equal(asset.inventoryUnits + asset.quarantinedUnits, before, `${asset.id} ${condition}`);
      assert.equal(asset.processedBatches, processed);
      assert.equal(asset.deliveredUnits, delivered);
      assert.equal(asset.isRunning, false);
      if (condition === 'disconnected') assert.ok(!readings.some((reading) => reading.machineId === asset.id));
      assert.equal(accounted(devices), devices[0].receivedUnits);
    }
  }
});

test('cold excursions permanently block exposed lots in every cold asset despite relaxed limits and restart', () => {
  const coldIds = createPharmaAssets().filter((asset) => asset.cold).map((asset) => asset.id);
  for (const id of coldIds) {
    for (const temperature of [1, 12]) {
      const { devices, simulation } = setup();
      const asset = devices.find((item) => item.id === id);
      for (let seconds = 0; seconds < 700 && !asset.inventoryUnits; seconds++) simulation.step(1);
      assert.ok(asset.inventoryUnits > 0, asset.id);
      const units = asset.inventoryUnits;
      asset.temp = temperature;
      asset.params.tempLimit = 50;
      asset.params.tempMin = -10;
      simulation.step(0.1);
      assert.equal(asset.quarantinedUnits, units);
      assert.equal(asset.inventoryUnits, 0);
      asset.temp = 5;
      asset.params.mode = 'auto';
      simulation.step(100);
      assert.equal(asset.quarantinedUnits, units);
      assert.equal(accounted(devices), devices[0].receivedUnits);
    }
  }
});

test('truck pauses in place with its lot and returns continuously before collecting another', () => {
  const { devices, simulation } = setup();
  const truck = devices[5];
  for (let seconds = 0; seconds < 200 && truck.vehicleState !== 'delivering'; seconds++) simulation.step(0.5);
  assert.equal(truck.vehicleState, 'delivering');
  truck.params.mode = 'paused';
  const before = [truck.positionX, truck.inventoryUnits, truck.batchId];
  simulation.step(5);
  assert.deepEqual([truck.positionX, truck.inventoryUnits, truck.batchId], before);
  truck.params.mode = 'auto';
  let returned = false, delivered = false;
  for (let second = 0; second < 100; second++) {
    const x = truck.positionX, z = truck.positionZ;
    simulation.step(0.5);
    assert.ok(Math.hypot(truck.positionX - x, truck.positionZ - z) <= 3.34);
    returned ||= truck.vehicleState === 'returning';
    delivered ||= devices.some((asset) => asset.type === 'pharma-pharmacy' && asset.deliveredUnits > 0);
  }
  assert.ok(returned && delivered);
});

test('temperature bounds and persistent quarantine appear in rules and metric highlighting', () => {
  const asset = createPharmaAssets()[4];
  asset.temp = 1;
  assert.match(evaluate(asset).reasons[0].text, /baixa/);
  assert.equal(metricOver(asset, asset.metrics[1]), true);
  asset.temp = 9;
  assert.match(evaluate(asset).reasons[0].text, /Temperatura/);
  asset.temp = 5;
  asset.quarantinedUnits = 100;
  assert.match(evaluate(asset).reasons[0].text, /bloqueadas/);
  asset.commLost = true;
  assert.equal(evaluate(asset).status, 'offline');
});

test('pharma telemetry, assistant context and missing measurements never substitute seed values', () => {
  const { devices, simulation } = setup();
  resetScenario(setup().devices, pharmaProfile.initialKpis, { scenario: 'pharma' });
  simulation.step(100);
  applyTelemetry(simulation.snapshot());
  const context = buildContext(store.state);
  assert.equal(context.scenario, 'pharma');
  const quality = machineSnapshot(store.state.byId['PHA-QUA-001']);
  const result = answer('Por que PHA-QUA-001 está em alerta?', context, () => quality, {
    kb: pharmaKb, ...pharmaProfile.assistant,
  });
  assert.match(result, /não são liberados/);
  assert.ok(!result.includes('Reduza a velocidade'));
  assert.deepEqual(extraTelemetry({ inventoryUnits: NaN, batchId: 3 }), {});
  assert.equal(context.machines[0].telemetry.receivedUnits, devices[0].receivedUnits);
  setConnection({ mode: 'fabric' });
  applyTelemetry([{ machineId: 'PHA-QUA-001', temp: 22, vib: 0, usage: 0, commLost: false }]);
  assert.equal(store.state.byId['PHA-QUA-001'].batchId, undefined);
  assert.equal(pharmaProfile.kpiRows(store.state).find((row) => row.label === 'Unidades bloqueadas').value, '—');
  assert.match(pharmaProfile.assistant.summary(buildContext(store.state)), /incompletas/);
});

test('delivery KPI and assistant aggregate all pharmacies and signal missing readings', () => {
  const { devices, simulation } = setup();
  simulation.step(1000);
  resetScenario(setup().devices, pharmaProfile.initialKpis, { scenario: 'pharma' });
  applyTelemetry(simulation.snapshot());
  const expected = devices.filter((asset) => asset.type === 'pharma-pharmacy')
    .reduce((sum, asset) => sum + asset.deliveredUnits, 0).toLocaleString('pt-BR');
  assert.equal(pharmaProfile.kpiRows(store.state).find((row) => row.label === 'Entregues ao consumidor').value, expected);
  assert.ok(pharmaProfile.assistant.summary(buildContext(store.state)).includes(`${expected} entregues`));
  applyTelemetry([{ machineId: 'PHA-FAR-003', commLost: true }]);
  assert.equal(pharmaProfile.kpiRows(store.state).find((row) => row.label === 'Entregues ao consumidor').value, '—');
  assert.match(pharmaProfile.assistant.summary(buildContext(store.state)), /incompletas/);
});

test('device controls preserve pharmaceutical schema and simulator-only commands', () => {
  const control = createDeviceControl(createPharmaAssets);
  const asset = control.devices['PHA-ARM-001'];
  control.command(asset.id, 'EMERGENCY_STOP');
  assert.equal(asset.params.mode, 'off');
  control.command(asset.id, 'RESUME');
  assert.equal(asset.params.speed, 100);
  assert.equal(asset.params.tempMin, 2);
  assert.equal(asset.params.tempLimit, 8);
});

test('browser mock source emits the pharmaceutical snapshot contract', async (t) => {
  const source = createMockSource(createPharmaAssets(), { intervalMs: 100, createSimulation: createPharmaSimulation });
  t.after(() => source.stop());
  const readings = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Sem telemetria Pharma')), 5000);
    source.start({ onTelemetry(items) { clearTimeout(timeout); resolve(items); } });
  });
  assert.equal(readings.length, 12);
  assert.ok(readings.every((reading) => typeof reading.isRunning === 'boolean' && reading.inventoryUnits === 0));
});

test('UI start and resume commands reconnect offline mock trucks and animate their telemetry', async (t) => {
  for (const command of ['CYCLE_START', 'RESUME']) {
    await t.test(command, async (t) => {
      const devices = createPharmaAssets();
      resetScenario(devices, pharmaProfile.initialKpis, { scenario: 'pharma' });
      setConnection({ mode: 'mock' });
      const source = createMockSource(devices, { intervalMs: 100, createSimulation: createPharmaSimulation });
      attachTelemetrySource(source);
      t.after(() => { source.stop(); attachTelemetrySource(null); });
      const truck = devices.find((asset) => asset.id === 'PHA-TRK-003');
      const start = [truck.positionX, truck.positionZ];
      const motion = createTruckMotion(...start, truck.heading);
      let resolveMoved;
      const moved = new Promise((resolve, reject) => {
        resolveMoved = resolve;
        const timeout = setTimeout(() => reject(new Error('Caminhão não iniciou movimento na UI')), 5000);
        t.after(() => clearTimeout(timeout));
      });
      source.start({ onTelemetry(items) {
        applyTelemetry(items);
        const pose = updateTruckMotion(motion, truck, performance.now());
        if (!truck.commLost && truck.isRunning && pose.travelled > 0
          && Math.hypot(pose.x - start[0], pose.z - start[1]) > 0) resolveMoved();
      } });
      await sendCommand(truck.id, command);
      await moved;
      assert.equal(truck.status, 'online');
      assert.ok(truck.speedKmh > 0);
    });
  }
});
