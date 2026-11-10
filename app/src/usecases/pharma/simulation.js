import { effectiveSpeed, telemetrySnapshot } from '../../domain/simulation.js';
import { PHARMA_ASSET_DEFINITIONS, pharmaId } from './catalog.js';
import { pharmaDock, pharmaRoute } from './layout.js';

const BATCH_SIZE = 100;
const EPS = 1e-9;
const DOCK_SECONDS = 2;
const active = (asset) => !asset.commLost && effectiveSpeed(asset) > 0;
const safe = (asset) => !asset.cold || (Number.isFinite(asset.temp) && asset.temp >= 2 && asset.temp <= 8);

export function createPharmaSimulation(devices) {
  const byId = Object.fromEntries(devices.map((asset) => [asset.id, asset]));
  const expected = PHARMA_ASSET_DEFINITIONS.map((definition) => pharmaId(definition.code, definition.number));
  if (expected.some((id) => !byId[id]) || new Set(devices.map((asset) => asset.id)).size !== devices.length) {
    throw new Error('O catálogo farmacêutico está incompleto ou contém IDs duplicados.');
  }
  const factory = ['REC', 'PRD', 'QUA', 'EMB', 'ARM'].map((code) => byId[pharmaId(code)]);
  const trucks = devices.filter((asset) => asset.type === 'pharma-truck');
  const centers = devices.filter((asset) => asset.type === 'pharma-distribution');
  const pharmacies = devices.filter((asset) => asset.type === 'pharma-pharmacy');
  const queues = new Map(devices.map((asset) => [asset.id, []]));
  const reserved = new Map([...centers, ...pharmacies].map((asset) => [asset.id, 0]));
  const trips = new Map();
  const repositioning = new Map();
  const origins = [factory[4], ...centers];
  let serial = 0, arrival = 0, originCursor = 0, centerCursor = 0, pharmacyCursor = 0, truckCursor = 0;
  const queue = (asset) => queues.get(asset.id);
  const eligible = (asset) => active(asset) && safe(asset);
  const room = (asset) => (queue(asset).length + (reserved.get(asset.id) || 0)) * BATCH_SIZE + BATCH_SIZE <= asset.capacityUnits;

  function cancelTrip(truck) {
    const trip = trips.get(truck.id);
    if (!trip) return;
    reserved.set(trip.destination.id, reserved.get(trip.destination.id) - 1);
    if (trip.lot.assigned === truck.id) delete trip.lot.assigned;
    trips.delete(truck.id);
  }

  function move(truck, trip, dt) {
    let remaining = 80 / truck.params.cycleTime * dt * effectiveSpeed(truck) / 100;
    let distance = 0;
    while (remaining > EPS && trip.point < trip.points.length) {
      const target = trip.points[trip.point];
      const dx = target.x - truck.positionX, dz = target.z - truck.positionZ;
      const length = Math.hypot(dx, dz);
      if (length <= EPS) { trip.point++; continue; }
      const step = Math.min(length, remaining);
      truck.positionX += dx / length * step;
      truck.positionZ += dz / length * step;
      truck.heading = Math.atan2(dx, dz);
      distance += step;
      remaining -= step;
      if (step + EPS >= length) trip.point++;
    }
    truck.speedKmh = distance / dt * 3.6;
    truck.isRunning = distance > EPS;
    return trip.point >= trip.points.length;
  }

  function route(truck, target) {
    return pharmaRoute({ x: truck.positionX, z: truck.positionZ }, pharmaDock(target));
  }

  function chooseDestination(origin) {
    const targets = origin === factory[4] ? centers : pharmacies;
    const cursor = origin === factory[4] ? centerCursor : pharmacyCursor;
    for (let offset = 0; offset < targets.length; offset++) {
      const index = (cursor + offset) % targets.length;
      if (!eligible(targets[index]) || !room(targets[index])) continue;
      if (origin === factory[4]) centerCursor = (index + 1) % targets.length;
      else pharmacyCursor = (index + 1) % targets.length;
      return targets[index];
    }
    return null;
  }

  function schedule(truck) {
    for (let offset = 0; offset < origins.length; offset++) {
      const index = (originCursor + offset) % origins.length;
      const origin = origins[index];
      if (!eligible(origin)) continue;
      const lot = queue(origin).find((item) => item.elapsed + EPS >= origin.params.cycleTime && !item.assigned);
      if (!lot) continue;
      const destination = chooseDestination(origin);
      if (!destination) continue;
      originCursor = (index + 1) % origins.length;
      lot.assigned = truck.id;
      reserved.set(destination.id, reserved.get(destination.id) + 1);
      trips.set(truck.id, { origin, destination, lot, phase: 'returning', points: route(truck, origin), point: 1, elapsed: 0 });
      repositioning.delete(truck.id);
      return true;
    }
    return false;
  }

  function calculate(dt) {
    for (const asset of devices) {
      asset.isRunning = false;
      if (asset.type === 'pharma-truck') asset.speedKmh = 0;
      if (!asset.commLost) {
        const target = asset.params.mode === 'off' ? 22 : asset.params.targetTemp;
        asset.temp += (target - asset.temp) * (1 - Math.exp(-dt / 5));
      }
      if (asset.cold && Number.isFinite(asset.temp) && !safe(asset)) {
        asset.quarantinedUnits += queue(asset).length * BATCH_SIZE;
        queue(asset).length = 0;
      }
    }

    const firstTruck = truckCursor;
    for (let offset = 0; offset < trucks.length; offset++) {
      const index = (firstTruck + offset) % trucks.length;
      const truck = trucks[index];
      if (!trips.has(truck.id) && eligible(truck) && schedule(truck)) truckCursor = (index + 1) % trucks.length;
    }

    for (const truck of trucks) {
      const trip = trips.get(truck.id);
      if (trip && !queue(truck).includes(trip.lot) && !queue(trip.origin).includes(trip.lot)) cancelTrip(truck);
    }

    const receiving = factory[0];
    if (active(receiving)) {
      arrival = Math.min(12, arrival + dt * effectiveSpeed(receiving) / 100);
      if (arrival >= 12 && room(receiving)) {
        serial++;
        queue(receiving).push({ id: `LOT-${String(serial).padStart(5, '0')}`, serial, elapsed: 0, released: false });
        receiving.receivedUnits += BATCH_SIZE;
        arrival = 0;
      }
    }

    for (const asset of pharmacies) {
      const lot = queue(asset)[0];
      if (!lot || !eligible(asset)) continue;
      asset.isRunning = true;
      lot.elapsed = Math.min(asset.params.cycleTime, lot.elapsed + dt * effectiveSpeed(asset) / 100);
      if (lot.elapsed + EPS >= asset.params.cycleTime) {
        queue(asset).shift();
        asset.processedBatches++;
        asset.deliveredUnits += BATCH_SIZE;
      }
    }

    for (const center of centers) {
      const lot = queue(center).find((item) => item.elapsed + EPS < center.params.cycleTime);
      if (!lot || !eligible(center)) continue;
      center.isRunning = true;
      lot.elapsed = Math.min(center.params.cycleTime, lot.elapsed + dt * effectiveSpeed(center) / 100);
    }

    for (let index = factory.length - 1; index >= 0; index--) {
      const asset = factory[index], lot = queue(asset)[0];
      if (!lot || !eligible(asset)) continue;
      asset.isRunning = true;
      lot.elapsed = Math.min(asset.params.cycleTime, lot.elapsed + dt * effectiveSpeed(asset) / 100);
      if (lot.elapsed + EPS < asset.params.cycleTime || index === factory.length - 1) continue;
      if (index === 2 && lot.serial % 5 === 0) {
        asset.quarantinedUnits += BATCH_SIZE;
        asset.processedBatches++;
        queue(asset).shift();
        continue;
      }
      if (index === 2) lot.released = true;
      const next = factory[index + 1];
      if (!eligible(next) || !room(next)) { asset.isRunning = false; continue; }
      if (index >= 3 && !lot.released) throw new Error(`Lote ${lot.id} sem liberação simulada de qualidade.`);
      queue(asset).shift();
      asset.processedBatches++;
      lot.elapsed = 0;
      queue(next).push(lot);
    }

    for (const truck of trucks) {
      if (!active(truck)) {
        truck.vehicleState = 'stopped';
        continue;
      }
      if (!safe(truck)) {
        truck.vehicleState = 'stopped';
        continue;
      }
      const trip = trips.get(truck.id);
      if (!trip) {
        let reposition = repositioning.get(truck.id);
        if (!reposition) {
          const index = trucks.indexOf(truck);
          const target = origins[index % origins.length];
          reposition = { target, points: route(truck, target), point: 1 };
          repositioning.set(truck.id, reposition);
        }
        truck.vehicleState = 'returning';
        if (move(truck, reposition, dt)) {
          reposition.target = origins[(origins.indexOf(reposition.target) + 1) % origins.length];
          reposition.points = route(truck, reposition.target);
          reposition.point = 1;
        }
        continue;
      }
      truck.vehicleState = trip.phase;
      if (trip.phase === 'returning' || trip.phase === 'delivering') {
        if (move(truck, trip, dt)) {
          trip.phase = trip.phase === 'returning' ? 'loading' : 'unloading';
          trip.elapsed = 0;
        }
      } else if (trip.phase === 'loading' && eligible(trip.origin)) {
        truck.isRunning = true;
        trip.elapsed += dt * effectiveSpeed(truck) / 100;
        if (trip.elapsed + EPS >= DOCK_SECONDS) {
          const index = queue(trip.origin).indexOf(trip.lot);
          if (index < 0) throw new Error(`Lote ${trip.lot.id} não encontrado na origem.`);
          queue(trip.origin).splice(index, 1);
          delete trip.lot.assigned;
          trip.origin.processedBatches++;
          trip.lot.elapsed = 0;
          queue(truck).push(trip.lot);
          trip.phase = 'delivering';
          trip.points = route(truck, trip.destination);
          trip.point = 1;
          trip.elapsed = 0;
        }
      } else if (trip.phase === 'unloading' && eligible(trip.destination)) {
        truck.isRunning = true;
        trip.elapsed += dt * effectiveSpeed(truck) / 100;
        if (trip.elapsed + EPS >= DOCK_SECONDS) {
          if (queue(truck)[0] !== trip.lot) throw new Error(`Carga do caminhão ${truck.id} inconsistente.`);
          queue(truck).shift();
          trip.lot.elapsed = 0;
          queue(trip.destination).push(trip.lot);
          truck.processedBatches++;
          cancelTrip(truck);
        }
      }
    }

    for (const asset of devices) {
      const lot = queue(asset)[0];
      asset.inventoryUnits = queue(asset).length * BATCH_SIZE;
      asset.batchId = lot?.id || '';
      asset.batchStatus = lot ? (lot.released ? 'Liberado na simulação' : 'Aguardando qualidade') :
        asset.quarantinedUnits ? 'Há lotes bloqueados' : 'Aguardando lote';
      asset.usage = asset.inventoryUnits / asset.capacityUnits * 100;
    }
  }

  function snapshot() {
    return devices.map((asset) => {
      const reading = telemetrySnapshot(asset);
      return reading ? { ...reading, isRunning: active(asset) && asset.isRunning } : null;
    }).filter(Boolean);
  }
  return {
    snapshot,
    step(dt) {
      if (!Number.isFinite(dt) || dt < 0 || dt > 3600) throw new Error('Intervalo de simulação inválido (0..3600 s).');
      for (let remaining = dt; remaining > EPS; remaining -= Math.min(remaining, 0.1)) calculate(Math.min(remaining, 0.1));
      return snapshot();
    },
  };
}
