import * as THREE from 'three';
import { routePose } from '../../domain/routes.js';
import { CITY_ROUTE, ROAD_WIDTH, HOUSE_POSITIONS, CHARGER_POSITIONS, TURBINE_POSITIONS, RESERVOIR, DAM } from './layout.js';

export function block(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function pipe(points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 32, radius, 8, false), material);
}

export function buildEnvironment(scene, textures) {
  const grass = new THREE.MeshStandardMaterial({ color: 0x6db45c, roughness: 1, ...textures.grass });
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x70747a, roughness: 0.94, ...textures.asphalt });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xc3bcae, roughness: 0.88, ...textures.concrete });
  const earth = new THREE.MeshStandardMaterial({ color: 0x6d7452, roughness: 1 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf3edcf, roughness: 0.8 });
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x268eaa, roughness: 0.24, metalness: 0.12, transparent: true, opacity: 0.86,
    clearcoat: 0.9, clearcoatRoughness: 0.17,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(94, 84, 1, 1), grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.07, -4);
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(block(34, 0.3, 15, earth, 6, 0.2, -30.5));
  [[-10, -30], [22, -30]].forEach(([x, z]) => {
    scene.add(block(2, 2.8, 15, earth, x, 1.35, z), block(2.2, 0.2, 15, grass, x, 2.8, z));
  });
  scene.add(block(34, 2.8, 2, earth, 6, 1.35, -37), block(34, 0.2, 2, grass, 6, 2.8, -37));
  const reservoir = new THREE.Mesh(new THREE.PlaneGeometry(RESERVOIR.width, RESERVOIR.depth, 28, 16), waterMat);
  reservoir.rotation.x = -Math.PI / 2;
  reservoir.position.set(6, 3.2, -30);
  scene.add(reservoir);
  const dam = block(DAM.width, DAM.height, DAM.depth, concrete, ...DAM.center);
  scene.add(dam);
  scene.add(block(33, 0.17, 2.3, concrete, 6, 4.05, -23));
  const rail = new THREE.MeshStandardMaterial({ color: 0x89969a, metalness: 0.8, roughness: 0.3 });
  for (let x = -10; x <= 22; x += 2) {
    scene.add(block(0.06, 0.65, 0.06, rail, x, 4.43, -22.1));
    if (x < 22) scene.add(block(2, 0.06, 0.06, rail, x + 1, 4.72, -22.1));
  }
  scene.add(block(17, 0.28, 6.3, concrete, 5, 0.12, -17));
  scene.add(block(0.3, 3.3, 6.3, concrete, -3.4, 1.6, -17));
  scene.add(block(0.3, 3.3, 6.3, concrete, 13.4, 1.6, -17));
  scene.add(block(17, 0.3, 1.1, concrete, 5, 3.2, -19.7));
  const river = [
    new THREE.Mesh(new THREE.PlaneGeometry(25, 3), waterMat),
    new THREE.Mesh(new THREE.PlaneGeometry(20, 3), waterMat),
    new THREE.Mesh(new THREE.PlaneGeometry(3, 47), waterMat),
  ];
  [[10, 0.02, -12], [30, 0.02, -12], [41, 0.02, 10]].forEach((p, n) => {
    river[n].rotation.x = -Math.PI / 2;
    river[n].position.set(...p);
    scene.add(river[n]);
  });
  const road = new THREE.BufferGeometry();
  const vertices = [], uvs = [];
  for (let n = 0; n < 240; n++) {
    const a = routePose(CITY_ROUTE, CITY_ROUTE.length * n / 240);
    const b = routePose(CITY_ROUTE, CITY_ROUTE.length * (n + 1) / 240);
    const side = (p, sign) => [p.x + Math.sin(p.heading) * ROAD_WIDTH / 2 * sign,
      0.025, p.z + Math.cos(p.heading) * ROAD_WIDTH / 2 * sign];
    vertices.push(...side(a, -1), ...side(a, 1), ...side(b, -1), ...side(b, -1), ...side(a, 1), ...side(b, 1));
    uvs.push(0, n / 240, 1, n / 240, 0, (n + 1) / 240, 0, (n + 1) / 240, 1, n / 240, 1, (n + 1) / 240);
  }
  road.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  road.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  road.computeVertexNormals();
  const street = new THREE.Mesh(road, asphalt);
  street.material.side = THREE.DoubleSide;
  street.receiveShadow = true;
  scene.add(street);
  for (let d = 0; d < CITY_ROUTE.length; d += 4) {
    const p = routePose(CITY_ROUTE, d);
    const stripe = block(1.6, 0.012, 0.08, white, p.x, 0.045, p.z);
    stripe.rotation.y = p.heading;
    stripe.castShadow = false;
    scene.add(stripe);
  }
  scene.add(block(37, 0.04, 3.5, asphalt, 16, 0.02, 11));
  scene.add(block(23, 0.035, 24, asphalt, -14, 0.02, 15));
  scene.add(block(25, 0.12, 12, grass, -24, 0.02, -7.5));
  HOUSE_POSITIONS.forEach(([x, , z]) => {
    scene.add(block(4.7, 0.12, 4.5, concrete, x, 0.02, z));
    scene.add(block(0.6, 0.04, 2.2, concrete, x, 0.03, z < 10 ? z + 3 : z - 3));
  });
  CHARGER_POSITIONS.forEach(([x, , z], n) => {
    scene.add(block(n < 3 ? 4.6 : 6, 0.05, 0.06, white, x + 2.1, 0.07, z - (n < 3 ? 1.4 : 2)));
    scene.add(block(n < 3 ? 4.6 : 6, 0.05, 0.06, white, x + 2.1, 0.07, z + (n < 3 ? 1.4 : 2)));
  });
  const bark = new THREE.MeshStandardMaterial({ color: 0x745d43, roughness: 1 });
  const foliage = new THREE.MeshStandardMaterial({ color: 0x447c39, roughness: 0.95 });
  const trunkGeometry = new THREE.CylinderGeometry(0.14, 0.22, 1.7, 7);
  const crownGeometry = new THREE.IcosahedronGeometry(1.3, 1);
  const treePositions = [
    ...Array.from({ length: 10 }, (_, n) => [-39, 0, -20 + n * 5]),
    ...Array.from({ length: 8 }, (_, n) => [-34 + n * 6, 0, -39]),
    ...Array.from({ length: 6 }, (_, n) => [4 + n * 5, 0, 31]),
  ];
  treePositions.forEach(([x, , z], n) => {
    const trunk = new THREE.Mesh(trunkGeometry, bark);
    trunk.position.set(x, 0.85, z);
    const crown = new THREE.Mesh(crownGeometry, foliage);
    crown.position.set(x, 2.4, z);
    crown.scale.set(1, 1.3 + (n % 3) * 0.2, 1);
    trunk.castShadow = crown.castShadow = true;
    scene.add(trunk, crown);
  });
  const waterPositions = reservoir.geometry.attributes.position;
  const original = waterPositions.array.slice();
  return {
    concrete, rail, waterMat,
    update(t, gate) {
      if (Number.isFinite(gate.levelM) && !gate.commLost) reservoir.position.y = 0.65 + gate.levelM * 0.8;
      for (let n = 0; n < waterPositions.count; n++) {
        waterPositions.setZ(n, Math.sin(original[n * 3] * 1.5 + t * 1.2) * 0.025
          + Math.cos(original[n * 3 + 1] + t * 0.8) * 0.018);
      }
      waterPositions.needsUpdate = true;
    },
  };
}

export function buildPowerCircuit(circuit) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb0a494, roughness: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x7d8c91, roughness: 0.4, metalness: 0.7 });
  const wire = new THREE.MeshStandardMaterial({ color: 0x252c2c, roughness: 0.7 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xd7e2d6, roughness: 0.25 });
  const flow = [];
  const pulseGeometry = new THREE.SphereGeometry(0.11, 6, 4);
  const pulseMaterial = new THREE.MeshBasicMaterial({ color: 0xffd15b });
  const local = ([x, y, z]) => [x - circuit.pos[0], y, z - circuit.pos[2]];
  circuit.poles.forEach((point, index) => {
    const [x, , z] = local(point);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 5.3, 8), concrete);
    pole.position.set(x, 2.65, z);
    pole.castShadow = true;
    group.add(pole, block(1.65, 0.1, 0.16, metal, x, 5.1, z));
    for (const offset of [-0.6, 0, 0.6]) {
      group.add(block(0.13, 0.26, 0.13, ceramic, x + offset, 5.28, z));
      if (index) {
        const [px, , pz] = local(circuit.poles[index - 1]);
        group.add(pipe([[px + offset, 5.42, pz], [(px + x) / 2 + offset, 4.78, (pz + z) / 2], [x + offset, 5.42, z]], 0.025, wire));
        if (offset === 0) {
          const mesh = new THREE.Mesh(pulseGeometry, pulseMaterial);
          const path = new THREE.CatmullRomCurve3([
            new THREE.Vector3(px, 5.45, pz), new THREE.Vector3((px + x) / 2, 4.81, (pz + z) / 2),
            new THREE.Vector3(x, 5.45, z),
          ]);
          group.add(mesh);
          flow.push({ mesh, path });
        }
      }
    }
  });
  if (circuit.id !== 'RED-CID-001') {
    const sources = circuit.id === 'RED-SOL-001'
      ? [[-29, 1.35, -1.5], [-16, 1.35, -1.5]]
      : TURBINE_POSITIONS.map(([x, , z]) => [x, 2.4, z]);
    const [px, , pz] = circuit.poles[0];
    sources.forEach(([x, y, z]) => {
      group.add(pipe([local([x, y, z]), local([(x + px) / 2, 3.8, (z + pz) / 2]), local([px, 5.42, pz])], 0.028, wire));
    });
  }
  if (circuit.id === 'RED-CID-001') {
    HOUSE_POSITIONS.forEach(([x, , z]) => {
      const source = circuit.poles.filter((p) => z < 10 ? p[2] === -6 : p[2] === 27)
        .reduce((a, b) => Math.abs(a[0] - x) < Math.abs(b[0] - x) ? a : b);
      group.add(pipe([local([source[0], 5.42, source[2]]), local([x, 4.1, (source[2] + z) / 2]),
        local([x, 2.1, z])], 0.022, wire));
    });
    const source = circuit.poles.at(-1);
    for (const [x, , z] of CHARGER_POSITIONS) {
      group.add(pipe([local([source[0], 5.42, source[2]]), local([x - 1, 4.5, z + 1]),
        local([x, 1.7, z])], 0.025, wire));
    }
  }
  group.userData.flow = flow;
  return group;
}
