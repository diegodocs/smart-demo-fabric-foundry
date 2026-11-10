import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function prepare(source, targetLength, vehicle = false) {
  const bounds = new THREE.Box3().setFromObject(source);
  const size = bounds.getSize(new THREE.Vector3());
  if (vehicle && size.z > size.x) source.rotation.y += Math.PI / 2;
  source.updateMatrixWorld(true);
  const result = new THREE.Group();
  const buckets = new Map();
  const wheelRoots = [];
  source.traverse((node) => {
    if (vehicle && (/^Wheel(Front|Rear)[LR]$/.test(node.name) || /^Wheels/.test(node.name))) wheelRoots.push(node);
  });
  const wheelNodes = new Set();
  for (const root of wheelRoots) root.traverse((n) => wheelNodes.add(n));
  source.traverse((node) => {
    if (!node.isMesh || wheelNodes.has(node)) return;
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    if (Array.isArray(node.material)) {
      const mesh = new THREE.Mesh(geometry, node.material);
      result.add(mesh);
      return;
    }
    const signature = Object.entries(geometry.attributes).map(([k, a]) => `${k}:${a.itemSize}`).sort().join();
    const key = `${node.material.uuid}:${!!geometry.index}:${signature}`;
    if (!buckets.has(key)) buckets.set(key, { material: node.material, geometries: [] });
    buckets.get(key).geometries.push(geometry);
  });
  for (const { material, geometries } of buckets.values()) {
    const merged = mergeGeometries(geometries);
    if (!merged) throw new Error('Não foi possível otimizar um modelo Smart Energy.');
    result.add(new THREE.Mesh(merged, material));
    geometries.forEach((g) => g.dispose());
  }
  for (const root of wheelRoots) {
    const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.name = 'energy-wheel';
    pivot.position.copy(center);
    root.traverse((node) => {
      if (!node.isMesh) return;
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld).translate(-center.x, -center.y, -center.z);
      pivot.add(new THREE.Mesh(geometry, node.material));
    });
    pivot.userData.radius = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y / 2;
    result.add(pivot);
  }
  const box = new THREE.Box3().setFromObject(result);
  const center = box.getCenter(new THREE.Vector3());
  const extent = box.getSize(new THREE.Vector3());
  const scale = targetLength / Math.max(extent.x, extent.z);
  const content = new THREE.Group();
  content.add(result);
  result.position.set(-center.x, -box.min.y, -center.z);
  content.scale.setScalar(scale);
  result.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      node.userData.energyLibrary = true;
    }
    if (node.name === 'energy-wheel') node.userData.radius *= scale;
  });
  const sourceGeometries = new Set();
  source.traverse((n) => { if (n.geometry) sourceGeometries.add(n.geometry); });
  sourceGeometries.forEach((g) => g.dispose());
  return content;
}

export async function loadEnergyModels() {
  const BASE = `${import.meta.env.BASE_URL}assets/energy/`;
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const resources = await Promise.allSettled([
    ...['house', 'car', 'truck'].map((name) => loader.loadAsync(`${BASE}${name}.glb`)),
    ...['grass', 'asphalt', 'concrete'].flatMap((name) =>
      [textureLoader.loadAsync(`${BASE}${name}.jpg`), textureLoader.loadAsync(`${BASE}${name}-normal.jpg`)]),
  ]);
  const roots = resources.filter((r) => r.status === 'fulfilled').map((r) => r.value.scene || r.value);
  function dispose() {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const root of roots) {
      if (root.isTexture) { textures.add(root); continue; }
      root.traverse((n) => {
        if (n.geometry) geometries.add(n.geometry);
        for (const mat of n.material ? [].concat(n.material) : []) {
          materials.add(mat);
          Object.values(mat).forEach((value) => { if (value?.isTexture) textures.add(value); });
        }
      });
    }
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }
  const failure = resources.find((r) => r.status === 'rejected');
  if (failure) {
    dispose();
    throw new Error(`Falha ao carregar os modelos/texturas locais da Smart Energy: ${failure.reason.message}`);
  }
  const values = resources.map((r) => r.value);
  const templates = [prepare(values[0].scene, 3.8), prepare(values[1].scene, 2.8, true), prepare(values[2].scene, 4.5, true)];
  roots.splice(0, 3, ...templates);
  const textures = {};
  ['grass', 'asphalt', 'concrete'].forEach((name, n) => {
    const map = values[3 + n * 2], normalMap = values[4 + n * 2];
    map.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [map, normalMap]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(name === 'grass' ? 22 : 8, name === 'grass' ? 20 : 6);
      texture.anisotropy = 4;
    }
    textures[name] = { map, normalMap };
  });
  return {
    createHouse: () => templates[0].clone(true),
    createCar: () => templates[1].clone(true),
    createTruck: () => templates[2].clone(true),
    textures, dispose,
  };
}
