import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEnergyAssets } from '../app/src/usecases/energy/catalog.js';
import { createEnergySimulation } from '../app/src/usecases/energy/simulation.js';

function setup(options) {
  const devices = createEnergyAssets();
  return { devices, sim: createEnergySimulation(devices, options), byId: Object.fromEntries(devices.map((d) => [d.id, d])) };
}
test('hydro requires water and respects stopped turbines', () => {
  const { sim, devices } = setup({ levelM: 0, inflowM3s: 0 });
  sim.step(1);
  assert.ok(devices.filter((d) => d.family === 'hydro' && d.type !== 'hydro-gate').every((d) => d.powerKw === 0 && d.flowM3s === 0));
});
test('energy balance, proportional supply and isolated grid', () => {
  const { sim, byId, devices } = setup();
  sim.step(1);
  const consumers = devices.filter((d) => ['residential', 'charging'].includes(d.family));
  const served = consumers.reduce((sum, d) => sum + d.servedKw, 0);
  assert.ok(Math.abs(served - byId['RED-CID-001'].powerKw) < 1e-8);
  assert.ok(served <= (byId['RED-SOL-001'].powerKw + byId['RED-HID-001'].powerKw) * 0.98 + 1e-8);
  byId['RED-CID-001'].params.mode = 'off';
  sim.step(2);
  assert.ok(consumers.every((d) => d.servedKw === 0));
  assert.ok(devices.filter((d) => d.family === 'mobility').every((d) => d.chargeKw === 0));
});
test('generation is not double counted, source circuit isolation and kWh integration', () => {
  const { sim, byId, devices } = setup();
  sim.step(1);
  const before = byId['CAS-001'].energyKwh;
  const power = byId['CAS-001'].servedKw;
  sim.step(1);
  assert.ok(Math.abs(byId['CAS-001'].energyKwh - before - power / 3600) < 0.0001);
  byId['RED-SOL-001'].params.mode = 'off';
  byId['RED-HID-001'].params.mode = 'off';
  sim.step(1);
  assert.equal(byId['RED-CID-001'].powerKw, 0);
  assert.ok(devices.filter((d) => d.family === 'residential').every((d) => d.supplyPct === 0));
});
test('battery thresholds trigger reservation and release without charging on dead grid', () => {
  const { sim, byId } = setup();
  const car = byId['VEH-CAR-001'];
  car.batteryPct = 19;
  sim.step(1);
  assert.equal(car.vehicleState, 'seeking');
  car.vehicleState = 'charging';
  car.chargerId = 'EVC-CAR-001';
  car.batteryPct = 79.9999;
  sim.step(1);
  assert.equal(car.vehicleState, 'leaving');
  car.vehicleState = 'charging';
  car.batteryPct = 19;
  byId['RED-CID-001'].params.mode = 'off';
  sim.step(1);
  assert.equal(car.batteryPct, 19);
  assert.equal(car.chargeKw, 0);
});
test('water accounting and timestep subdivision are deterministic', () => {
  const a = setup(), b = setup();
  a.sim.step(4);
  for (let i = 0; i < 16; i++) b.sim.step(0.25);
  for (const key of ['levelM', 'spillM3s']) assert.ok(Math.abs(a.byId['HID-COM-001'][key] - b.byId['HID-COM-001'][key]) < 1e-9);
  assert.throws(() => a.sim.step(-1), /intervalo/i);
});

test('traffic reaches compatible charging bays without collisions and releases them at 80%', () => {
  const { sim, devices } = setup();
  const vehicles = devices.filter((d) => d.family === 'mobility');
  const charging = new Set();
  for (let n = 0; n < 360; n++) {
    sim.step(0.5);
    vehicles.forEach((v) => {
      if (v.vehicleState === 'charging') {
        charging.add(v.id);
        assert.match(v.chargerId, v.type === 'electric-truck' ? /^EVC-TRK/ : /^EVC-CAR/);
      }
    });
    for (let a = 0; a < vehicles.length; a++) for (let b = a + 1; b < vehicles.length; b++) {
      const x = vehicles[a], y = vehicles[b];
      const radius = (v) => v.type === 'electric-truck' ? 2.3 : 1.4;
      assert.ok(Math.hypot(x.positionX - y.positionX, x.positionZ - y.positionZ) >= radius(x) + radius(y) + 0.34);
    }
  }
  assert.ok(charging.has('VEH-CAR-002'));
  assert.ok(charging.has('VEH-TRK-001'));
  for (const v of vehicles.filter((d) => d.vehicleState === 'charging')) v.batteryPct = 80;
  sim.step(60);
  assert.ok(vehicles.filter((v) => charging.has(v.id)).every((v) => !v.chargerId && v.vehicleState === 'driving'));
});
