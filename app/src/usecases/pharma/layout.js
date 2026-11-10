export const PHARMA_LAYOUT = {
  factory: {
    REC: [-100, 0, -36],
    PRD: [-82, 0, -36],
    QUA: [-64, 0, -36],
    EMB: [-100, 0, -16],
    ARM: [-82, 0, -16],
  },
  centers: [[-48, 0, -5], [62, 0, -5]],
  pharmacies: [[-22, 0, -5], [0, 0, -5], [22, 0, -5]],
  houses: [
    { x: -29, z: -31 }, { x: -10, z: -31 }, { x: 12, z: -31 }, { x: 34, z: -31 },
    { x: -29, z: -44 }, { x: -8, z: -44 }, { x: 30, z: -44 }, { x: 42, z: -24, scale: 0.85 },
  ],
  truckStarts: [[-106, 0, 29], [-100, 0, 29], [-94, 0, 29], [-88, 0, 29], [-82, 0, 29]],
  roadZ: 20,
};

export function pharmaDock(asset) {
  return { x: asset.pos[0], z: asset.pos[2] + 10 };
}

export function pharmaRoute(from, to) {
  const points = [
    { x: from.x, z: from.z },
    { x: from.x, z: PHARMA_LAYOUT.roadZ },
    { x: to.x, z: PHARMA_LAYOUT.roadZ },
    { x: to.x, z: to.z },
  ];
  return points.filter((point, index) => !index
    || Math.hypot(point.x - points[index - 1].x, point.z - points[index - 1].z) > 1e-9);
}
