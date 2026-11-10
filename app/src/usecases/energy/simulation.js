import { telemetrySnapshot, effectiveSpeed } from '../../domain/simulation.js';
import { routePose, hasVehicleClearance } from '../../domain/routes.js';
import { CITY_ROUTE, CHARGING_ENTRY_DISTANCE, chargingPath, pathLength, pathPose } from './layout.js';

const active = (d) => !d.commLost && effectiveSpeed(d) > 0;
const factor = (d) => active(d) ? Math.min(1.3, effectiveSpeed(d) / 100) : 0;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const radius = (v) => v.type === 'electric-truck' ? 2.3 : 1.4;

export function createEnergySimulation(devices, { levelM = 3.2, inflowM3s = 2.4, irradiance = 850 } = {}) {
  const byId = Object.fromEntries(devices.map((d) => [d.id, d]));
  const group = (family) => devices.filter((d) => d.family === family);
  const vehicles = group('mobility');
  const chargers = group('charging');
  const houses = group('residential');
  const turbines = devices.filter((d) => d.type === 'hydro-turbine');
  const panels = devices.filter((d) => d.type === 'solar-array');
  const inverters = devices.filter((d) => d.type === 'solar-inverter');
  const gate = byId['HID-COM-001'];
  const solarCircuit = byId['RED-SOL-001'], hydroCircuit = byId['RED-HID-001'], cityCircuit = byId['RED-CID-001'];
  let level = clamp(levelM, 0, 4);
  const pathDistances = new Map();
  const area = 600;

  function moveVehicles(dt) {
    for (const v of vehicles) {
      v.speedKmh = 0;
      if (!active(v) || v.batteryPct <= 0) continue;
      if (v.vehicleState === 'stopped') v.vehicleState = v.batteryPct <= 20 ? 'seeking' : 'driving';
      if (v.batteryPct <= 20 && v.vehicleState === 'driving') v.vehicleState = 'seeking';
      if (v.vehicleState === 'charging') continue;
      let distance = 2.4 * factor(v) * dt;
      let pose;
      const state = v.vehicleState;
      if (state === 'approaching' || state === 'leaving') {
        const index = chargers.findIndex((c) => c.id === v.chargerId);
        if (index < 0) throw new Error(`Posto de recarga inválido para ${v.id}.`);
        const points = chargingPath(index);
        const total = pathLength(points);
        const progress = pathDistances.get(v.id) ?? (state === 'leaving' ? total : 0);
        const next = state === 'leaving' ? Math.max(0, progress - distance) : Math.min(total, progress + distance);
        distance = Math.abs(next - progress);
        pose = pathPose(state === 'leaving' ? [...points].reverse() : points,
          state === 'leaving' ? total - next : next);
        if (!clear(v, pose)) continue;
        pathDistances.set(v.id, next);
        if (state === 'approaching' && next >= total) v.vehicleState = 'charging';
        if (state === 'leaving' && next <= 0) {
          v.vehicleState = 'driving';
          v.routeDistance = CHARGING_ENTRY_DISTANCE;
          v.chargerId = '';
          pathDistances.delete(v.id);
        }
      } else {
        const toEntry = (CHARGING_ENTRY_DISTANCE - v.routeDistance + CITY_ROUTE.length) % CITY_ROUTE.length;
        if (state === 'seeking' && toEntry <= distance) {
          const stationBusy = vehicles.some((o) => o.id !== v.id && ['approaching', 'leaving'].includes(o.vehicleState));
          const charger = !stationBusy && chargers.find((c) =>
            active(c) && c.type === (v.type === 'electric-truck' ? 'ev-charger-truck' : 'ev-charger-car')
            && !vehicles.some((other) => other.chargerId === c.id));
          if (charger) {
            distance = toEntry;
            v.chargerId = charger.id;
            v.vehicleState = 'approaching';
            pathDistances.set(v.id, 0);
          }
        }
        pose = routePose(CITY_ROUTE, v.routeDistance + distance);
        if (!clear(v, pose)) continue;
        v.routeDistance = (v.routeDistance + distance) % CITY_ROUTE.length;
      }
      Object.assign(v, { positionX: pose.x, positionZ: pose.z, heading: pose.heading });
      v.speedKmh = dt ? distance / dt * 3.6 : 0;
      // One scene unit represents one metre; consumption is deliberately simplified.
      v.batteryPct = Math.max(0, v.batteryPct - distance * (v.type === 'electric-truck' ? 0.0007 : 0.0004));
    }
  }

  function clear(v, p) {
    return hasVehicleClearance(p, radius(v), vehicles.filter((o) => o.id !== v.id)
      .map((o) => ({ x: o.positionX, z: o.positionZ, radius: radius(o) })), 0.35);
  }

  function calculate(dt) {
    moveVehicles(dt);
    const opening = factor(gate);
    const requested = turbines.map((t) => 1.2 * factor(t));
    let spill = level > 0 ? 0.3 * opening : 0;
    const totalFlow = requested.reduce((a, b) => a + b, 0) + spill;
    const waterFactor = level > 0 ? Math.min(1, (level * area + inflowM3s * dt) / Math.max(1e-9, totalFlow * dt)) : 0;
    const head = level + 0.8;
    turbines.forEach((t, n) => {
      t.flowM3s = requested[n] * waterFactor;
      t.powerKw = Math.min(t.ratedKw, 9.81 * t.flowM3s * head * 0.86);
      t.usage = t.powerKw / t.ratedKw * 100;
    });
    spill *= waterFactor;
    const outflow = turbines.reduce((sum, t) => sum + t.flowM3s, 0) + spill;
    const volume = level * area + (inflowM3s - outflow) * dt;
    if (dt && volume > area * 4) spill += (volume - area * 4) / dt;
    level = clamp(volume / area, 0, 4);
    Object.assign(gate, { levelM: level, spillM3s: spill, fuel: level / 4 * 100, usage: opening * 100 });
    panels.forEach((p) => {
      p.irradiance = irradiance;
      p.powerKw = p.ratedKw * clamp(irradiance / 1000, 0, 1) * (1 - p.humidity / 100) * factor(p);
      p.usage = p.powerKw / p.ratedKw * 100;
    });
    const solar = inverters.reduce((sum, inv, n) => {
      const input = panels.slice(n * 5, n * 5 + 5).reduce((s, p) => s + p.powerKw, 0);
      inv.powerKw = Math.min(inv.ratedKw * factor(inv), input * 0.96);
      inv.usage = active(inv) ? 96 : 0;
      return sum + inv.powerKw;
    }, 0);
    const hydro = turbines.reduce((sum, t) => sum + t.powerKw, 0);
    function circuit(d, power) {
      d.powerKw = Math.min(power, d.ratedKw * factor(d));
      d.loadPct = d.powerKw / d.ratedKw * 100;
      d.voltageV = active(d) && d.powerKw > 0 ? 400 : 0;
    }
    circuit(solarCircuit, solar);
    circuit(hydroCircuit, hydro);
    houses.forEach((h) => { h.demandKw = h.ratedKw * factor(h); });
    chargers.forEach((c) => {
      const connected = vehicles.find((v) => v.chargerId === c.id && v.vehicleState === 'charging' && active(v) && v.batteryPct < 80);
      c.demandKw = connected ? c.ratedKw * factor(c) : 0;
      c.activity = c.demandKw / c.ratedKw * 100;
      c.outside = vehicles.filter((v) => v.vehicleState === 'seeking'
        && (v.type === 'electric-truck') === (c.type === 'ev-charger-truck')).length;
    });
    const consumers = [...houses, ...chargers];
    const demand = consumers.reduce((sum, c) => sum + c.demandKw, 0);
    const available = (solarCircuit.powerKw + hydroCircuit.powerKw) * 0.98;
    const served = Math.min(demand, available, cityCircuit.ratedKw * factor(cityCircuit));
    circuit(cityCircuit, served);
    cityCircuit.demandKw = demand;
    cityCircuit.unservedKw = demand - served;
    const ratio = demand > 0 ? served / demand : 1;
    for (const c of consumers) {
      c.servedKw = c.demandKw * ratio;
      c.unservedKw = c.demandKw - c.servedKw;
      c.supplyPct = c.demandKw ? ratio * 100 : 100;
      c.voltageV = active(c) && active(cityCircuit) && available > 0 ? 230 : 0;
      c.energyKwh = (c.energyKwh || 0) + c.servedKw * dt / 3600;
      c.powerKw = c.servedKw;
    }
    for (const v of vehicles) {
      const c = byId[v.chargerId];
      v.chargeKw = v.vehicleState === 'charging' && active(v) && c ? c.servedKw : 0;
      v.batteryPct = Math.min(100, v.batteryPct + v.chargeKw * dt / 3600 / v.batteryKwh * 100);
      if (v.vehicleState === 'charging' && v.batteryPct >= 80) v.vehicleState = 'leaving';
      if (!active(v) || v.batteryPct <= 0) v.speedKmh = 0;
      v.isRunning = active(v) && (v.speedKmh > 0 || v.chargeKw > 0);
    }
    for (const d of devices) {
      if (d.family !== 'mobility') d.isRunning = active(d);
      if (d.energyKwh != null && !['residential', 'charging'].includes(d.family)) d.energyKwh += (d.powerKw || 0) * dt / 3600;
    }
  }

  const snapshots = () => devices.map((d) => {
    const snap = telemetrySnapshot(d);
    return snap ? { ...snap, isRunning: d.isRunning } : null;
  }).filter(Boolean);
  return {
    snapshot() { calculate(0); return snapshots(); },
    step(dt) {
      if (!Number.isFinite(dt) || dt < 0 || dt > 3600) throw new Error('Intervalo de simulação inválido (0..3600 s).');
      if (!dt) return this.snapshot();
      for (let remaining = dt; remaining > 1e-9; remaining -= Math.min(remaining, 0.25)) calculate(Math.min(remaining, 0.25));
      return snapshots();
    },
  };
}
