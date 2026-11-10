import * as THREE from 'three';

export function createFarmWheels(axles, track, { rubber, hub }) {
  return axles.flatMap(({ x, radius, width }) => [-1, 1].map((side) => {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 24), rubber);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width + 0.025, 16), hub);
    tire.rotation.x = rim.rotation.x = Math.PI / 2;
    const tread = new THREE.InstancedMesh(
      new THREE.BoxGeometry(radius * 0.12, radius * 0.16, width * 0.96), rubber, 16);
    for (let i = 0; i < tread.count; i++) {
      const angle = i * Math.PI * 2 / tread.count;
      const matrix = new THREE.Matrix4().makeRotationZ(angle);
      matrix.setPosition(Math.cos(angle) * radius * 0.94, Math.sin(angle) * radius * 0.94, 0);
      tread.setMatrixAt(i, matrix);
    }
    wheel.add(tire, rim, tread);
    wheel.position.set(x, radius, side * track / 2);
    wheel.userData.radius = radius;
    return wheel;
  }));
}

export function rollFarmWheels(wheels, distance) {
  for (const wheel of wheels) wheel.rotation.z -= distance / wheel.userData.radius;
}
