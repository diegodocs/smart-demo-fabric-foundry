import { effectiveSpeed, telemetrySnapshot } from '../../domain/simulation.js';
import { MINING_HAUL_ROUTES, miningDeliveryRoute, miningRouteLength, miningRoutePose } from './layout.js';

const active = (device) => !device.commLost && effectiveSpeed(device) > 0;
const factor = (device) => active(device) ? Math.min(1.3, effectiveSpeed(device) / 100) : 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const EPSILON = 1e-9;
const YIELD = 0.9;

function transfer(source, sourceKey, target, targetKey, targetCapacity, amount) {
  const moved = Math.max(0, Math.min(source[sourceKey], targetCapacity - target[targetKey], amount));
  source[sourceKey] -= moved;
  target[targetKey] += moved;
  return moved;
}

export function createMiningSimulation(devices) {
  const byId = Object.fromEntries(devices.map((device) => [device.id, device]));
  const excavator = byId['MIN-EXC-001'];
  const haulers = devices.filter((device) => device.type === 'haul-truck');
  const crushers = devices.filter((device) => device.type === 'crusher');
  const conveyor = byId['MIN-CNV-001'];
  const processor = byId['MIN-PRC-001'];
  const silos = devices.filter((device) => device.type === 'product-silo');
  const delivery = byId['MIN-TRK-001'];
  const terminal = byId['MIN-TER-001'];
  const centers = devices.filter((device) => device.type === 'distribution-center');
  if ([excavator, conveyor, processor, delivery, terminal].some((device) => !device)
    || haulers.length !== 4 || crushers.length !== 3 || silos.length !== 6 || centers.length !== 3
    || haulers.some((truck) => !MINING_HAUL_ROUTES[truck.id] || !byId[truck.crusherId])) {
    throw new Error('O catálogo da mineração está incompleto.');
  }

  const newTrip = (origin, destination, points) => ({
    phase: 'loading', distance: 0, idleTime: 0, origin, destination, points, returnPoints: points,
  });
  const haulTrips = new Map(haulers.map((truck) => [
    truck.id, newTrip(excavator, byId[truck.crusherId], MINING_HAUL_ROUTES[truck.id].points),
  ]));
  const deliveryTrip = newTrip(silos[0], centers[0], miningDeliveryRoute(silos[0], centers[0]));
  let siloCursor = 1, centerCursor = 1;

  function moveTruck(truck, trip, dt, outboundState) {
    const { origin, destination } = trip;
    truck.speedKmh = 0;
    if (!active(truck)) {
      truck.vehicleState = 'stopped';
      truck.isRunning = false;
      return { loaded: 0, unloaded: 0, completed: false };
    }

    let moved = 0;
    let working = false;
    let loaded = 0, unloaded = 0, completed = false;
    if (trip.phase === 'loading') {
      if (active(origin)) {
        moved = transfer(origin, 'inventoryT', truck, 'payloadT', truck.capacityT, 2 * factor(truck) * factor(origin) * dt);
        working = moved > EPSILON;
        loaded = moved;
      }
      trip.idleTime = moved > EPSILON || truck.payloadT <= EPSILON ? 0 : trip.idleTime + dt;
      if (truck.payloadT >= truck.capacityT - EPSILON
        || (truck.payloadT > EPSILON && (!active(origin) || trip.idleTime >= 5))) {
        trip.phase = outboundState;
        trip.idleTime = 0;
      }
    } else if (trip.phase === outboundState || trip.phase === 'returning') {
      const points = trip.phase === 'returning' ? trip.returnPoints : trip.points;
      const length = miningRouteLength(points);
      const direction = trip.phase === outboundState ? 1 : -1;
      const before = trip.distance;
      trip.distance = clamp(trip.distance + direction * 2.5 * factor(truck) * dt, 0, length);
      const distance = Math.abs(trip.distance - before);
      const pose = miningRoutePose(points, trip.distance);
      truck.positionX = pose.x;
      truck.positionZ = pose.z;
      truck.heading = pose.heading + (direction < 0 ? Math.PI : 0);
      truck.speedKmh = distance / dt * 3.6;
      working = distance > EPSILON;
      if (trip.distance >= length && direction > 0) trip.phase = 'unloading';
      if (trip.distance <= 0 && direction < 0) trip.phase = 'loading';
    } else if (trip.phase === 'unloading' && active(destination)
      && (destination.type !== 'distribution-center' || active(terminal))) {
      const isDelivery = destination.type === 'distribution-center';
      const key = isDelivery ? 'deliveredT' : 'inventoryT';
      const capacity = isDelivery ? Infinity : destination.capacityT;
      moved = transfer(truck, 'payloadT', destination, key, capacity, 2 * factor(truck) * factor(destination) * dt);
      working = moved > EPSILON;
      unloaded = moved;
      if (truck.payloadT <= EPSILON) {
        truck.payloadT = 0;
        trip.phase = 'returning';
        completed = true;
      }
    }
    truck.vehicleState = trip.phase;
    truck.isRunning = working;
    return { loaded, unloaded, completed };
  }

  function nextAvailable(list, cursor, predicate) {
    for (let offset = 0; offset < list.length; offset++) {
      const index = (cursor + offset) % list.length;
      if (predicate(list[index])) return index;
    }
    return cursor % list.length;
  }

  function scheduleDelivery() {
    const previousDestination = deliveryTrip.destination;
    const siloIndex = nextAvailable(silos, siloCursor, (silo) => active(silo) && silo.inventoryT > EPSILON);
    const centerIndex = nextAvailable(centers, centerCursor, active);
    siloCursor = (siloIndex + 1) % silos.length;
    centerCursor = (centerIndex + 1) % centers.length;
    deliveryTrip.origin = silos[siloIndex];
    deliveryTrip.destination = centers[centerIndex];
    deliveryTrip.points = miningDeliveryRoute(deliveryTrip.origin, deliveryTrip.destination);
    // Return to the next pickup via the current destination, without teleporting between silos.
    deliveryTrip.returnPoints = miningDeliveryRoute(deliveryTrip.origin, previousDestination);
    deliveryTrip.distance = miningRouteLength(deliveryTrip.returnPoints);
  }

  function calculate(dt) {
    for (const device of devices) device.throughputTph = 0;

    const extracted = Math.max(0, Math.min(excavator.capacityT - excavator.inventoryT, excavator.ratedTps * factor(excavator) * dt));
    excavator.inventoryT += extracted;
    excavator.extractedT += extracted;
    excavator.throughputTph = extracted / dt * 3600;

    for (const truck of haulers) moveTruck(truck, haulTrips.get(truck.id), dt, 'hauling');
    let crushed = 0;
    const requests = crushers.map((crusher) => active(crusher) && active(conveyor)
      ? Math.min(crusher.inventoryT, crusher.ratedTps * Math.min(factor(crusher), factor(conveyor)) * dt) : 0);
    const requested = requests.reduce((sum, amount) => sum + amount, 0);
    const share = requested > EPSILON ? Math.min(1, (conveyor.capacityT - conveyor.inventoryT) / requested) : 0;
    for (const [index, crusher] of crushers.entries()) {
      const moved = transfer(crusher, 'inventoryT', conveyor, 'inventoryT', conveyor.capacityT, requests[index] * share);
      crusher.throughputTph = moved / dt * 3600;
      crushed += moved;
    }

    const conveyed = active(conveyor) && active(processor)
      ? transfer(conveyor, 'inventoryT', processor, 'inventoryT', processor.capacityT, conveyor.ratedTps * factor(conveyor) * dt)
      : 0;
    conveyor.throughputTph = conveyed / dt * 3600;

    const storageRoom = silos.map((silo) => active(silo)
      ? Math.max(0, Math.min(silo.capacityT - silo.inventoryT, processor.ratedTps * YIELD * factor(silo) * dt)) : 0);
    const room = storageRoom.reduce((sum, amount) => sum + amount, 0);
    const processed = active(processor)
      ? Math.max(0, Math.min(processor.inventoryT, room / YIELD, processor.ratedTps * factor(processor) * dt)) : 0;
    if (processed > EPSILON) {
      processor.inventoryT -= processed;
      processor.tailingsT += processed * (1 - YIELD);
      for (const [index, silo] of silos.entries()) {
        const product = processed * YIELD * storageRoom[index] / room;
        silo.inventoryT += product;
        silo.throughputTph = product / dt * 3600;
      }
    }
    processor.throughputTph = processed / dt * 3600;
    const pickup = deliveryTrip.origin, destination = deliveryTrip.destination;
    const result = moveTruck(delivery, deliveryTrip, dt, 'delivering');
    pickup.throughputTph += result.loaded / dt * 3600;
    destination.throughputTph = result.unloaded / dt * 3600;
    terminal.deliveredT = centers.reduce((sum, center) => sum + center.deliveredT, 0);
    terminal.throughputTph = result.unloaded / dt * 3600;
    if (result.completed) scheduleDelivery();

    for (const device of devices) {
      if (device.family !== 'transport') {
        device.isRunning = active(device) && (device.throughputTph > EPSILON || (device === conveyor && crushed > EPSILON));
      }
      const load = device.family === 'transport'
        ? device.payloadT / device.capacityT * 100
        : device.type === 'product-silo' ? device.inventoryT / device.capacityT * 100
          : device.ratedTps ? device.throughputTph / (device.ratedTps * 3600) * 100 : 0;
      device.usage = clamp(load, 0, 100);
      const target = (device.isRunning ? device.params.targetTemp : 28) + (device.sensorBias?.temp ?? 0);
      device.temp += (target - device.temp) * (1 - Math.exp(-dt / 20));
      const vibration = (device.isRunning ? device.base.vib * factor(device) : 0) + (device.sensorBias?.vib ?? 0);
      device.vib += (vibration - device.vib) * (1 - Math.exp(-dt / 5));
    }
  }

  const snapshots = () => devices.map((device) => {
    const reading = telemetrySnapshot(device);
    return reading ? { ...reading, isRunning: active(device) && device.isRunning } : null;
  }).filter(Boolean);

  return {
    snapshot: snapshots,
    step(dt) {
      if (!Number.isFinite(dt) || dt < 0 || dt > 3600) throw new Error('Intervalo de simulação inválido (0..3600 s).');
      if (!dt) return snapshots();
      for (let remaining = dt; remaining > EPSILON; remaining -= Math.min(remaining, 0.25)) {
        calculate(Math.min(remaining, 0.25));
      }
      return snapshots();
    },
  };
}
