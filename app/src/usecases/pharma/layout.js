export const PHARMA_TRUCK_DISTANCE_PER_CYCLE = 80;

export const PHARMA_LAYOUT = {
  factory: {
    REC: [-108, 0, -32],
    PRD: [-90, 0, -32],
    QUA: [-72, 0, -32],
    EMB: [-54, 0, -32],
    ARM: [-36, 0, -32],
  },
  centers: [[-12, 0, -5]],
  pharmacies: [[18, 0, -5], [48, 0, -5]],
  houses: [
    { x: 10, z: -34 }, { x: 23, z: -34 }, { x: 36, z: -34 },
    { x: 49, z: -34 }, { x: 62, z: -34 },
  ],
  truckStarts: [[-106, 0, 29], [-100, 0, 29], [-94, 0, 29]],
  roadZ: 20,
  cityRoadZ: 14,
};

export function pharmaDock(asset) {
  return { x: asset.pos[0], z: asset.pos[2] + 10 };
}

export function pharmaRoute(from, to, roadZ = PHARMA_LAYOUT.roadZ) {
  const points = [
    { x: from.x, z: from.z },
    { x: from.x, z: roadZ },
    { x: to.x, z: roadZ },
    { x: to.x, z: to.z },
  ];
  return points.filter((point, index) => !index
    || Math.hypot(point.x - points[index - 1].x, point.z - points[index - 1].z) > 1e-9);
}
