const haulStarts = [-17, -7, 3, 13].map((z) => [-39, 0, z]);
const haulEnds = [-17, -7, 3, 13].map((z) => [-25, 0, z]);
const crushers = [-16, -1, 14].map((z) => [-17, 0, z]);
const silos = [-16, 0, 16].flatMap((z) => [[23, 0, z], [34, 0, z]]);
const distribution = [-18, -2, 14].map((z) => [59, 0, z]);

export const MINING_POSITIONS = {
  excavator: [-49, 0, -2],
  haulStarts, haulEnds, crushers, silos, distribution,
  haulStart: haulStarts[0], haulEnd: haulEnds[0],
  crusher: crushers[0],
  conveyor: [-4, 0, 0],
  processor: [8, 0, 0],
  silo: silos[0],
  deliveryStart: [24.5, 0, -10],
  deliveryEnd: [59, 0, -12],
  terminal: [49, 0, 31],
};

export const MINING_HAUL_ROUTES = Object.fromEntries(haulStarts.map((start, index) => [
  `MIN-HAU-${String(index + 1).padStart(3, '0')}`,
  { points: [start, haulEnds[index]], crusherId: `MIN-BRI-${String([1, 2, 2, 3][index]).padStart(3, '0')}` },
]));

export function miningDeliveryRoute(silo, center) {
  const z = silo.pos[2] + 6;
  const destinationZ = center.pos[2] + 6;
  return [[silo.pos[0] + 1.5, 0, z], [43, 0, z], [43, 0, destinationZ], [center.pos[0], 0, destinationZ]];
}

export function miningRouteLength(points) {
  return points.slice(1).reduce((length, point, index) =>
    length + Math.hypot(point[0] - points[index][0], point[2] - points[index][2]), 0);
}

export function miningRoutePose(points, distance) {
  let remaining = Math.max(0, distance);
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index];
    const length = Math.hypot(end[0] - start[0], end[2] - start[2]);
    if (!length) continue;
    if (remaining <= length || index === points.length - 1) {
      const progress = Math.min(1, remaining / length);
      return {
        x: start[0] + (end[0] - start[0]) * progress,
        z: start[2] + (end[2] - start[2]) * progress,
        heading: Math.atan2(-(end[2] - start[2]), end[0] - start[0]),
      };
    }
    remaining -= length;
  }
  throw new Error('Rota de mineração sem segmentos válidos.');
}
