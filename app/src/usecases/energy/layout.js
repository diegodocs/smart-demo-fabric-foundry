import { loop, routePose } from '../../domain/routes.js';

const id = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`;
export const CITY_ROUTE = loop(-2, -2, 34, 24, 3, 2.4);
export const ROAD_WIDTH = 4;
export const GROUND = { width: 88, depth: 76, center: [0, 0, -3] };
export const RESERVOIR = { center: [6, 3.8, -30], width: 30, depth: 12, bottom: 1.8 };
export const DAM = { center: [6, 2, -23], width: 32, height: 4, depth: 1.8 };
export const SOLAR_POSITIONS = Array.from({ length: 10 }, (_, n) =>
  [-32 + (n % 5) * 4.2, 0, -10 + Math.floor(n / 5) * 5]);
export const HOUSE_POSITIONS = Array.from({ length: 10 }, (_, n) =>
  [3 + (n % 5) * 6, 0, n < 5 ? 4.5 : 17.5]);
export const TURBINE_POSITIONS = [[0, 0, -17], [5, 0, -17], [10, 0, -17]];
export const CHARGER_POSITIONS = [
  [-11, 0, 8], [-11, 0, 13], [-11, 0, 18],
  [-22, 0, 12], [-22, 0, 20],
];
export const VEHICLE_IDS = [
  ...Array.from({ length: 4 }, (_, n) => id('VEH-CAR', n + 1)),
  ...Array.from({ length: 2 }, (_, n) => id('VEH-TRK', n + 1)),
];
export const INITIAL_DISTANCES = [0, 20, 40, 60, 85, 110];
export const CHARGING_ENTRY_DISTANCE = CITY_ROUTE.length - 13;

export const CIRCUITS = [
  { id: 'RED-SOL-001', name: 'Circuito solar', pos: [-23, 0, -1],
    poles: [[-23, 0, -1], [-16, 0, -1], [-10, 0, -1], [-6, 0, -7]], capacityKw: 12 },
  { id: 'RED-HID-001', name: 'Circuito hidrelétrico', pos: [6, 0, -12],
    poles: [[6, 0, -12], [0, 0, -10], [-6, 0, -7]], capacityKw: 150 },
  { id: 'RED-CID-001', name: 'Distribuição da cidade', pos: [-6, 0, -7],
    poles: [[-6, 0, -7], [2, 0, -6], [10, 0, -6], [18, 0, -6], [27, 0, -6],
      [37, 0, -6], [37, 0, 5], [37, 0, 14], [37, 0, 27], [27, 0, 27],
      [18, 0, 27], [10, 0, 27], [2, 0, 27], [-6, 0, 27], [-17, 0, 27]], capacityKw: 150 },
];

export function chargingPath(chargerIndex) {
  const [x, , z] = CHARGER_POSITIONS[chargerIndex];
  const entry = routePose(CITY_ROUTE, CHARGING_ENTRY_DISTANCE);
  const laneX = chargerIndex < 3 ? -5 : -15;
  return [
    { x: entry.x, z: entry.z }, { x: laneX, z: entry.z },
    { x: laneX, z }, { x: x + 1.9, z },
  ];
}

export function pathLength(points) {
  return points.slice(1).reduce((sum, p, n) =>
    sum + Math.hypot(p.x - points[n].x, p.z - points[n].z), 0);
}

export function pathPose(points, distance) {
  let remaining = Math.max(0, distance);
  for (let n = 1; n < points.length; n++) {
    const a = points[n - 1], b = points[n];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= length || n === points.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        heading: Math.atan2(a.z - b.z, b.x - a.x) };
    }
    remaining -= length;
  }
  throw new Error('Trajeto de recarga vazio.');
}
