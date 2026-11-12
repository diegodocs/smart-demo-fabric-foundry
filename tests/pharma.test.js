import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPharmaAssets, pharmaKb, pharmaParamSchema } from '../app/src/usecases/pharma/catalog.js';
import { createPharmaSimulation } from '../app/src/usecases/pharma/simulation.js';
import { pharmaProfile } from '../app/src/usecases/pharma/profile.js';
import { CITY_CAR_RADIUS, CITY_ROADS, CITY_TRAFFIC_COUNT, CITY_TRAFFIC_ROUTES,
  cityTruckObstacles, createCityTraffic, stepCityTraffic } from '../app/src/usecases/pharma/cityTraffic.js';
import { createTruckMotion, updateTruckMotion } from '../app/src/usecases/pharma/truckMotion.js';
import { startPharmaRenderLoop, updatePharmaControls } from '../app/src/usecases/pharma/renderLoop.js';
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
  devices.filter((asset) => asset.type === 'pharma-truck')
    .forEach((truck) => { truck.params.speed = truck.defaults.speed; });
  return { devices, simulation: createPharmaSimulation(devices, () => 0) };
}
const accounted = (devices) => devices.reduce((sum, asset) => sum + asset.inventoryUnits + asset.quarantinedUnits + asset.deliveredUnits, 0);

function fakeRenderEnvironment(t) {
  const saved = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame']
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), frames = new Map();
  let nextId = 0;
  const page = {
    hidden: false,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      assert.equal(listeners.get(type), handler);
      listeners.delete(type);
    },
    visibilityChanged() { listeners.get('visibilitychange')?.(); },
  };
  Object.assign(globalThis, {
    document: page,
    requestAnimationFrame: (callback) => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: (id) => { frames.delete(id); },
  });
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    page, frames, listeners,
    advance(time) {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(time));
    },
  };
}

test('pharma rendering follows elapsed time and is capped across display refresh rates', async (t) => {
  for (const hz of [24, 30, 60, 120, 144]) await t.test(`${hz} Hz`, (t) => {
    const env = fakeRenderEnvironment(t);
    const times = [];
    const route = CITY_TRAFFIC_ROUTES[0];
    const car = { ...routePose(route, 10), routeIndex: 0, distance: 10,
      speed: 2, targetSpeed: 2, changeIn: 100, travelled: 0 };
    const dispose = startPharmaRenderLoop((dt, time) => {
      times.push({ dt, time });
      stepCityTraffic([car], dt, [], () => 0);
    }, () => {});
    for (let frame = 0; frame <= hz * 10; frame++) env.advance(frame * 1000 / hz);
    const fps = (times.length - 1) / 10;
    assert.ok(Math.abs(fps - Math.min(30, hz)) < 0.2, `${fps} FPS at ${hz} Hz`);
    const elapsed = (times.at(-1).time - times[0].time) / 1000;
    assert.ok(Math.abs(times.reduce((sum, frame) => sum + frame.dt, 0) - elapsed) < 1e-8);
    assert.ok(Math.abs(car.distance - (10 + 2 * elapsed)) < 1e-8);
    dispose();
    assert.equal(env.frames.size, 0);
    assert.equal(env.listeners.size, 0);
  });
});

test('pharma rendering skips missed deadlines rather than replaying frames after a stall', (t) => {
  const env = fakeRenderEnvironment(t);
  const frames = [];
  const dispose = startPharmaRenderLoop((dt, time) => { frames.push({ dt, time }); }, () => {});
  for (const time of [0, 7, 17, 33.4, 49, 66.8, 100, 250, 251, 260]) env.advance(time);
  assert.deepEqual(frames.map((frame) => frame.time), [0, 33.4, 66.8, 100, 250]);
  assert.ok(Math.abs(frames.at(-1).dt - 0.15) < 1e-9);
  env.advance(267);
  assert.equal(frames.at(-1).time, 267);
  dispose();
});

test('pharma rendering pauses while hidden, resynchronizes telemetry, and disposes its loop', (t) => {
  const env = fakeRenderEnvironment(t);
  const motion = createTruckMotion(0, 20, 0);
  const reading = { positionX: 0, positionZ: 20, heading: 0, speedKmh: 10,
    isRunning: true, commLost: false, lastSeen: 1000 };
  const rendered = [];
  let resumes = 0;
  const dispose = startPharmaRenderLoop((dt, time) => {
    rendered.push({ dt, pose: updateTruckMotion(motion, reading, time) });
  }, () => { resumes++; motion.connected = false; });
  env.advance(0);
  env.advance(34);
  env.page.hidden = true;
  env.page.visibilityChanged();
  assert.equal(env.frames.size, 0);
  Object.assign(reading, { positionX: 40, lastSeen: 90000 });
  env.advance(90000);
  assert.equal(rendered.length, 2);
  env.page.hidden = false;
  env.page.visibilityChanged();
  env.page.visibilityChanged();
  assert.equal(resumes, 1);
  assert.equal(env.frames.size, 1);
  env.advance(90000);
  assert.equal(rendered.at(-1).dt, 0);
  assert.equal(rendered.at(-1).pose.x, 40);
  assert.equal(rendered.at(-1).pose.travelled, 0);
  dispose();
  assert.equal(env.frames.size, 0);
  assert.equal(env.listeners.size, 0);
  env.page.hidden = true;
  env.page.visibilityChanged();
  env.page.hidden = false;
  env.page.visibilityChanged();
  assert.equal(env.frames.size, 0);
});

test('pharma camera auto-rotation and damping have consistent speed at different frame rates', () => {
  function angleAt(hz) {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 10);
    const element = { style: {}, addEventListener() {}, removeEventListener() {} };
    const controls = new OrbitControls(camera, element);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.2;
    const damping = controls.dampingFactor;
    for (let frame = 0; frame < hz * 10; frame++) updatePharmaControls(controls, 1 / hz);
    assert.equal(controls.dampingFactor, damping);
    controls.dispose();
    return Math.atan2(camera.position.x, camera.position.z);
  }
  const reference = angleAt(60);
  assert.ok(Math.abs(angleAt(30) - reference) < 0.001);
  assert.ok(Math.abs(angleAt(144) - reference) < 0.001);
});

test('factory stages stay grouped in their production sequence', () => {
  const stages = ['REC', 'PRD', 'QUA', 'EMB', 'ARM'].map((key) => PHARMA_LAYOUT.factory[key]);
  assert.ok(stages.every((pos) => pos[2] === stages[0][2]));
  for (let i = 1; i < stages.length; i++) {
    assert.ok(stages[i][0] - stages[i - 1][0] >= 12 && stages[i][0] - stages[i - 1][0] <= 18);
  }
  const center = PHARMA_LAYOUT.centers[0];
  assert.ok(stages.at(-1)[0] < center[0]);
  assert.ok(PHARMA_LAYOUT.pharmacies.every((pos) => pos[0] > center[0]));
  const buildings = [...stages, center, ...PHARMA_LAYOUT.pharmacies];
  for (const [index, pos] of buildings.entries()) {
    assert.ok(buildings.slice(index + 1).every((other) =>
      Math.abs(pos[0] - other[0]) >= 16 || Math.abs(pos[2] - other[2]) >= 15));
  }
});

test('houses clear pharmacy lots, loading docks, other houses and city streets', () => {
  assert.equal(PHARMA_LAYOUT.houses.length, 5);
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

test('all assets stay connected while two trucks move and one remains parked', () => {
  const devices = createPharmaAssets();
  const simulation = createPharmaSimulation(devices, () => 0);
  const trucks = devices.filter((asset) => asset.type === 'pharma-truck');
  assert.ok(devices.every((asset) => !asset.commLost && asset.status === 'online' && evaluate(asset).status === 'online'));
  assert.deepEqual(trucks.map((truck) => truck.params.speed), [100, 100, 0]);
  const initial = simulation.snapshot().filter((reading) => reading.machineId.startsWith('PHA-TRK-'));
  assert.deepEqual(initial.map((reading) => reading.machineId), trucks.map((truck) => truck.id));
  initial.forEach((reading, index) => {
    assert.equal(reading.isRunning, index < 2);
    assert.equal(reading.speedKmh > 0, index < 2);
    assert.equal(reading.vehicleState, index < 2 ? 'returning' : 'stopped');
  });
  const before = trucks.map((truck) => [truck.positionX, truck.positionZ]);
  const readings = simulation.step(1);
  assert.equal(readings.length, 11);
  trucks.forEach((truck, index) => {
    const distance = Math.hypot(truck.positionX - before[index][0], truck.positionZ - before[index][1]);
    assert.equal(distance > 0, index < 2, truck.id);
    assert.equal(truck.isRunning, index < 2);
    assert.ok(readings.some((reading) => reading.machineId === truck.id), truck.id);
  });
  assert.equal(accounted(devices), 0);
  simulation.step(600);
  assert.equal(accounted(devices), devices[0].receivedUnits);
  assert.ok(devices.some((asset) => asset.type === 'pharma-pharmacy' && asset.deliveredUnits > 0));
  assert.ok(devices.every((asset) => !asset.commLost && evaluate(asset).status !== 'offline'));
  assert.equal(simulation.snapshot().length, 11);
  trucks.slice(2).forEach((truck, index) => {
    assert.deepEqual([truck.positionX, truck.positionZ], before[index + 2]);
    assert.equal(truck.inventoryUnits, 0);
  });
});

test('pharma telemetry reports status changes without inventing readings for disconnected assets', () => {
  const devices = createPharmaAssets();
  const simulation = createPharmaSimulation(devices);
  const receiving = devices.find((asset) => asset.id === 'PHA-REC-001');
  const quality = devices.find((asset) => asset.id === 'PHA-QUA-001');
  const truck = devices.find((asset) => asset.id === 'PHA-TRK-001');
  const reading = (asset) => simulation.snapshot().find((item) => item.machineId === asset.id);

  assert.equal(reading(receiving).status, 'online');
  assert.equal(reading(receiving).isRunning, false);
  receiving.params.mode = 'paused';
  assert.equal(reading(receiving).status, 'alert');
  assert.equal(reading(receiving).isRunning, false);
  receiving.params.mode = 'off';
  assert.equal(reading(receiving).status, 'offline');
  receiving.params.mode = 'auto';
  assert.equal(reading(receiving).status, 'online');

  quality.quarantinedUnits = 100;
  assert.equal(reading(quality).status, 'alert');
  truck.temp = 9;
  assert.equal(reading(truck).status, 'alert');
  assert.equal(reading(truck).isRunning, false);
  receiving.commLost = true;
  assert.equal(reading(receiving), undefined);

  const previousMode = store.state.connection.mode;
  try {
    const readings = simulation.snapshot();
    resetScenario(createPharmaAssets(), pharmaProfile.initialKpis, { scenario: 'pharma' });
    setConnection({ mode: 'fabric' });
    applyTelemetry([
      ...readings.map((item) => ({ ...item, commLost: false })),
      { machineId: receiving.id, commLost: true },
    ]);
    for (const asset of devices) {
      assert.equal(store.state.byId[asset.id].status, evaluate(asset).status, asset.id);
      if (!asset.commLost) assert.equal(reading(asset).status, store.state.byId[asset.id].status, asset.id);
    }
  } finally {
    setConnection({ mode: previousMode });
  }
});

test('initial truck snapshots respect paused controls and unsafe temperature', () => {
  const devices = createPharmaAssets();
  const [paused, unsafe] = devices.filter((asset) => asset.type === 'pharma-truck');
  paused.params.mode = 'paused';
  unsafe.temp = 9;
  const readings = createPharmaSimulation(devices).snapshot();
  for (const truck of [paused, unsafe]) {
    const reading = readings.find((item) => item.machineId === truck.id);
    assert.equal(reading.isRunning, false);
    assert.equal(reading.speedKmh, 0);
    assert.equal(reading.vehicleState, 'stopped');
  }
});

test('initial moving speed reflects controls applied before the first simulation step', () => {
  const devices = createPharmaAssets();
  const truck = devices.find((asset) => asset.id === 'PHA-TRK-001');
  truck.params.speed = 50;
  truck.params.cycleTime = 24;
  const reading = createPharmaSimulation(devices).snapshot().find((item) => item.machineId === truck.id);
  assert.ok(Math.abs(reading.speedKmh - 6) < 1e-9);
  assert.equal(reading.isRunning, true);
});

test('HTTP start and resume activate parked trucks and reconnect offline trucks', () => {
  for (const command of ['CYCLE_START', 'RESUME']) {
    for (const disconnected of [false, true]) {
      const control = createDeviceControl(createPharmaAssets);
      const devices = Object.values(control.devices);
      const simulation = createPharmaSimulation(devices);
      const truck = devices.find((asset) => asset.id === 'PHA-TRK-003');
      truck.commLost = disconnected;
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
  }
});

test('empty trucks alternate between the warehouse and the center without leaving their roads', () => {
  function visitedOrigins(random) {
    const devices = createPharmaAssets();
    devices.find((asset) => asset.id === 'PHA-REC-001').params.mode = 'paused';
    devices.find((asset) => asset.id === 'PHA-TRK-002').params.speed = 0;
    const truck = devices.find((asset) => asset.id === 'PHA-TRK-001');
    const simulation = createPharmaSimulation(devices, random);
    const origins = devices.filter((asset) => ['pharma-storage', 'pharma-distribution'].includes(asset.type));
    const visited = new Set();
    for (let tick = 0; tick < 800; tick++) {
      const before = [truck.positionX, truck.positionZ];
      simulation.step(0.1);
      assert.ok(Math.hypot(truck.positionX - before[0], truck.positionZ - before[1]) <= 2 / 3 + 1e-6);
      assert.ok(Math.abs(truck.positionZ - PHARMA_LAYOUT.roadZ) < 1e-6
        || [truck.pos[0], PHARMA_LAYOUT.factory.ARM[0], ...PHARMA_LAYOUT.centers.map((pos) => pos[0])]
          .some((x) => Math.abs(truck.positionX - x) < 1e-6));
      assert.equal(truck.inventoryUnits, 0);
      const origin = origins.find((asset) =>
        Math.hypot(truck.positionX - pharmaDock(asset).x, truck.positionZ - pharmaDock(asset).z) < 1e-6);
      if (origin) visited.add(origin.id);
      if (visited.size === origins.length) return [...visited];
    }
    throw new Error('O caminhão não alcançou as duas origens.');
  }
  assert.deepEqual(visitedOrigins(() => 0), ['PHA-ARM-001', 'PHA-DIS-001']);
  assert.deepEqual(visitedOrigins(() => 0.999), ['PHA-ARM-001', 'PHA-DIS-001']);
});

test('empty truck repositioning rejects invalid random values', () => {
  for (const value of [-0.01, 1, NaN, Infinity]) {
    const devices = createPharmaAssets();
    devices.find((asset) => asset.id === 'PHA-REC-001').params.mode = 'paused';
    devices.find((asset) => asset.id === 'PHA-TRK-002').params.speed = 0;
    const simulation = createPharmaSimulation(devices, () => value);
    assert.throws(() => simulation.step(100), /Valor aleatório de deslocamento inválido/);
  }
});

test('empty truck movements preserve deliveries and capacity across random seeds', () => {
  for (const initialSeed of [1, 34, 120, 999, 2025]) {
    let seed = initialSeed, draws = 0;
    const random = () => { draws++; seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
    const devices = createPharmaAssets();
    const simulation = createPharmaSimulation(devices, random);
    for (let second = 0; second < 600; second += 10) {
      simulation.step(10);
      assert.equal(accounted(devices), devices[0].receivedUnits, `seed ${initialSeed}`);
      assert.ok(devices.every((asset) => asset.inventoryUnits <= asset.capacityUnits), `seed ${initialSeed}`);
    }
    assert.ok(draws > 0, `seed ${initialSeed}`);
    assert.ok(devices.some((asset) => asset.type === 'pharma-pharmacy' && asset.deliveredUnits > 0),
      `seed ${initialSeed}`);
    assert.ok(devices.every((asset) => !asset.commLost), `seed ${initialSeed}`);
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

test('city cars randomly turn or continue at the shared junction without jumping', () => {
  const fork = CITY_ROADS.shortcut - CITY_ROADS.radius - CITY_ROADS.left - CITY_ROADS.radius;
  for (const initialRoute of [0, 1]) {
    for (const [choice, expectedRoute] of [[0, 0], [0.999, 1]]) {
      const distance = fork - 0.2;
      const car = { ...routePose(CITY_TRAFFIC_ROUTES[initialRoute], distance), routeIndex: initialRoute, distance,
        speed: 2, targetSpeed: 2, changeIn: 100, travelled: 0 };
      const before = { ...car };
      stepCityTraffic([car], 0.2, [], () => choice);
      assert.equal(car.routeIndex, expectedRoute);
      assert.ok(Math.hypot(car.x - before.x, car.z - before.z) <= 0.4 + 1e-8);
      assert.ok(Math.abs(car.heading - before.heading) <= 0.05 + 1e-8);
      assert.ok(expectedRoute === 0 ? car.z > CITY_ROADS.north : Math.abs(car.z - CITY_ROADS.north) < 1e-8);
    }
  }
});

test('a blocked city car keeps its chosen turn until the junction clears', () => {
  const fork = CITY_ROADS.shortcut - CITY_ROADS.radius - CITY_ROADS.left - CITY_ROADS.radius;
  const distance = fork - 0.2;
  const car = { ...routePose(CITY_TRAFFIC_ROUTES[1], distance), routeIndex: 1, distance,
    speed: 2, targetSpeed: 2, changeIn: 100, travelled: 0 };
  const obstacle = { ...routePose(CITY_TRAFFIC_ROUTES[0], fork + 0.2), radius: 1 };
  let choices = 0;
  const random = () => (++choices === 1 ? 0 : 0.999);
  stepCityTraffic([car], 0.2, [obstacle], random);
  assert.equal(car.speed, 0);
  stepCityTraffic([car], 1, [], random);
  assert.equal(car.routeIndex, 0);
  assert.equal(choices, 1);
});

test('three city cars move with varying speeds and routes while maintaining clearance', () => {
  for (const initialSeed of [13, 34]) {
    let seed = initialSeed;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
    const obstacles = [{ x: 0, z: -34, radius: 4 }];
    const cars = createCityTraffic(obstacles, random);
    assert.equal(CITY_TRAFFIC_COUNT, 3);
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
    assert.ok(travelled.every((distance) => distance > 30), `seed ${initialSeed}: ${travelled.join(', ')}`);
    assert.ok(speeds.every((values) => values.size > 1));
    assert.equal(routes.size, CITY_TRAFFIC_ROUTES.length);
    assert.throws(() => stepCityTraffic(cars, NaN), /inválido/);
  }
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

test('truck animation follows the city street when a telemetry interval crosses a turn', () => {
  const truck = createTruckMotion(-48, 12, 0);
  const reading = { positionX: -48, positionZ: 12, heading: 0, speedKmh: 12,
    isRunning: true, commLost: false, lastSeen: 1000 };
  updateTruckMotion(truck, reading, 0);
  Object.assign(reading, { positionX: -44, positionZ: PHARMA_LAYOUT.cityRoadZ, lastSeen: 11000 });
  updateTruckMotion(truck, reading, 10000);
  const midway = updateTruckMotion(truck, reading, 15000);
  assert.equal(midway.z, PHARMA_LAYOUT.cityRoadZ);
  assert.equal(midway.x, -47);
});

test('truck animation follows the highway when a sample begins at the city crossing', () => {
  const truck = createTruckMotion(-48, PHARMA_LAYOUT.cityRoadZ, 0);
  const reading = { positionX: -48, positionZ: PHARMA_LAYOUT.cityRoadZ, heading: 0, speedKmh: 12,
    isRunning: true, commLost: false, lastSeen: 1000 };
  updateTruckMotion(truck, reading, 0);
  Object.assign(reading, { positionX: -44, positionZ: PHARMA_LAYOUT.roadZ, lastSeen: 11000 });
  updateTruckMotion(truck, reading, 10000);
  const midway = updateTruckMotion(truck, reading, 15000);
  assert.equal(midway.x, -48);
  assert.equal(midway.z, 19);
});

test('shipments from the distribution center reach both pharmacies along the city street', () => {
  const { devices, simulation } = setup();
  const centers = devices.filter((asset) => asset.type === 'pharma-distribution');
  const pharmacies = devices.filter((asset) => asset.type === 'pharma-pharmacy');
  const trucks = devices.filter((asset) => asset.type === 'pharma-truck');
  const trips = new Map(), visitedCenters = new Set(), visitedPharmacies = new Set();
  for (let tick = 0; tick < 18000; tick++) {
    simulation.step(0.1);
    for (const truck of trucks) {
      if (!trips.has(truck.id) && truck.inventoryUnits && truck.vehicleState === 'loading') {
        const center = centers.find((asset) => Math.hypot(truck.positionX - pharmaDock(asset).x,
          truck.positionZ - pharmaDock(asset).z) < 1e-6);
        if (center) trips.set(truck.id, center);
      }
      const center = trips.get(truck.id);
      if (!center) continue;
      assert.ok(Math.abs(truck.positionZ - PHARMA_LAYOUT.cityRoadZ) < 1e-6
        || [center, ...pharmacies].some((asset) => Math.abs(truck.positionX - pharmaDock(asset).x) < 1e-6));
      assert.ok(truck.positionZ >= 5 - 1e-6 && truck.positionZ <= PHARMA_LAYOUT.cityRoadZ + 1e-6);
      if (truck.vehicleState === 'unloading') {
        const pharmacy = pharmacies.find((asset) => Math.hypot(truck.positionX - pharmaDock(asset).x,
          truck.positionZ - pharmaDock(asset).z) < 1e-6);
        assert.ok(pharmacy);
        visitedCenters.add(center.id);
        visitedPharmacies.add(pharmacy.id);
        trips.delete(truck.id);
      }
    }
  }
  assert.deepEqual([...visitedCenters], ['PHA-DIS-001']);
  assert.deepEqual([...visitedPharmacies].sort(), ['PHA-FAR-001', 'PHA-FAR-002']);
});

test('pharma catalog covers 11 assets with preserved IDs, isolated instances, schemas and knowledge', () => {
  const { devices, simulation } = setup();
  assert.equal(devices.length, 11);
  assert.equal(new Set(devices.map((asset) => asset.id)).size, 11);
  assert.equal(simulation.snapshot().length, 11);
  for (const [type, count] of [['pharma-truck', 3], ['pharma-distribution', 1], ['pharma-pharmacy', 2]]) {
    assert.equal(devices.filter((asset) => asset.type === type).length, count);
  }
  for (const id of ['PHA-REC-001', 'PHA-PRD-001', 'PHA-QUA-001', 'PHA-EMB-001',
    'PHA-ARM-001', 'PHA-TRK-001', 'PHA-TRK-002', 'PHA-TRK-003',
    'PHA-DIS-001', 'PHA-FAR-001', 'PHA-FAR-002']) {
    assert.ok(devices.some((asset) => asset.id === id), id);
  }
  for (const id of ['PHA-TRK-004', 'PHA-TRK-005', 'PHA-DIS-002', 'PHA-FAR-003']) {
    assert.ok(!devices.some((asset) => asset.id === id), id);
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
  assert.throws(() => createPharmaSimulation([...devices, { ...devices[5], id: 'PHA-TRK-004' }]), /desconhecidos/);
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
  assert.ok(visited.size >= 8);
  assert.deepEqual(route, ['pharma-receiving', 'pharma-production', 'pharma-quality', 'pharma-packaging',
    'pharma-storage', 'pharma-truck', 'pharma-distribution', 'pharma-truck', 'pharma-pharmacy']);
  assert.ok(delivered >= 1000, String(delivered));
  assert.ok(devices[2].quarantinedUnits >= 100);
  assert.equal(devices.filter((asset) => asset.cold).reduce((sum, asset) => sum + asset.quarantinedUnits, 0), 0);
});

test('all trucks, the center and both pharmacies participate without exceeding capacities', () => {
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
  assert.equal(moved.size, 3);
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
  const unavailable = devices.filter((asset) => asset.id === 'PHA-FAR-002');
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
  const center = devices.find((asset) => asset.type === 'pharma-distribution');
  for (let second = 0; second < 500 && !devices.some((asset) =>
    asset.type === 'pharma-truck' && asset.inventoryUnits > 0); second++) simulation.step(1);
  const carrying = devices.find((asset) => asset.type === 'pharma-truck' && asset.inventoryUnits > 0);
  assert.ok(carrying);
  const batch = carrying.batchId;
  center.params.mode = 'paused';
  simulation.step(150);
  assert.equal(carrying.batchId, batch);
  assert.equal(carrying.inventoryUnits, 100);
  assert.equal(carrying.vehicleState, 'unloading');
  assert.equal(accounted(devices), devices[0].receivedUnits);
  assert.ok(devices.every((asset) => asset.inventoryUnits <= asset.capacityUnits));
  center.params.mode = 'auto';
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
  assert.equal(simulation.snapshot().find((item) => item.machineId === devices[2].id).status, 'alert');
});

test('paused, off, disconnected and zero-speed stages cannot receive or process lots', () => {
  for (const condition of ['paused', 'off', 'disconnected', 'zero']) {
    for (let index = 0; index < createPharmaAssets().length; index++) {
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
  applyTelemetry([{ machineId: 'PHA-FAR-002', commLost: true }]);
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
  const source = createMockSource(createPharmaAssets(), { intervalMs: 250, createSimulation: createPharmaSimulation });
  t.after(() => source.stop());
  const batches = await new Promise((resolve, reject) => {
    const received = [];
    const timeout = setTimeout(() => reject(new Error('Sem telemetria Pharma')), 5000);
    t.after(() => clearTimeout(timeout));
    source.start({ onTelemetry(items) {
      received.push(items);
      if (received.length === 2) { clearTimeout(timeout); resolve(received); }
    } });
  });
  for (const readings of batches) {
    assert.equal(readings.length, 11);
    assert.ok(readings.every((reading) => !reading.commLost && typeof reading.isRunning === 'boolean'
      && reading.inventoryUnits === 0));
    const trucks = readings.filter((reading) => reading.machineId.startsWith('PHA-TRK-'));
    assert.deepEqual(trucks.map((reading) => reading.machineId),
      ['PHA-TRK-001', 'PHA-TRK-002', 'PHA-TRK-003']);
    trucks.forEach((reading, index) => {
      assert.equal(reading.isRunning, index < 2);
      assert.equal(reading.speedKmh > 0, index < 2);
    });
  }
});

test('UI start and resume commands activate parked or disconnected trucks', async (t) => {
  for (const command of ['CYCLE_START', 'RESUME']) {
    for (const disconnected of [false, true]) await t.test(`${command}, disconnected=${disconnected}`, async (t) => {
      const devices = createPharmaAssets();
      const truck = devices.find((asset) => asset.id === 'PHA-TRK-003');
      truck.commLost = disconnected;
      resetScenario(devices, pharmaProfile.initialKpis, { scenario: 'pharma' });
      setConnection({ mode: 'mock' });
      const source = createMockSource(devices, { intervalMs: 100, createSimulation: createPharmaSimulation });
      attachTelemetrySource(source);
      t.after(() => { source.stop(); attachTelemetrySource(null); });
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
