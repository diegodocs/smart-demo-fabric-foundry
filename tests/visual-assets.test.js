import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  batchStaticMeshes, disposeVisualResources, loadVisualAssets, prepareStaticModel,
} from '../app/src/usecases/shared/visualAssets.js';
import { prepareEnergyVehicle } from '../app/src/usecases/energy/models.js';
import { trackSceneHover } from '../app/src/usecases/shared/sceneHover.js';

function tracked(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => { count++; });
  return () => count;
}

function model() {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const left = new THREE.BoxGeometry(1, 1, 1);
  const right = new THREE.BoxGeometry(1, 1, 1);
  const a = new THREE.Mesh(left, material);
  const b = new THREE.Mesh(right, material);
  a.position.set(-1, 2, 0);
  b.position.set(1, 2, 0);
  root.add(a, b);
  return { root, material, left, right };
}

test('static models are centered, grounded, scaled and merged without duplicating shared resources', () => {
  const { root, material, left, right } = model();
  const texture = new THREE.Texture();
  material.map = texture;
  const leftDisposed = tracked(left);
  const rightDisposed = tracked(right);
  const materialDisposed = tracked(material);
  const textureDisposed = tracked(texture);
  const prepared = prepareStaticModel(root, 3);
  const box = new THREE.Box3().setFromObject(prepared);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(box.min.y) < 1e-6);
  assert.ok(Math.abs((box.min.x + box.max.x) / 2) < 1e-6);
  assert.ok(Math.abs(Math.max(size.x, size.z) - 3) < 1e-6);
  const meshes = [];
  prepared.traverse((node) => { if (node.isMesh) meshes.push(node); });
  assert.equal(meshes.length, 1);
  assert.equal(leftDisposed(), 1);
  assert.equal(rightDisposed(), 1);
  const mergedDisposed = tracked(meshes[0].geometry);
  disposeVisualResources([prepared, prepared.clone(true)], [texture]);
  assert.equal(mergedDisposed(), 1);
  assert.equal(materialDisposed(), 1);
  assert.equal(textureDisposed(), 1);
});

test('batching preserves world bounds and animated meshes without disposing shared geometry', () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.position.set(12, 0, -4);
  group.rotation.y = Math.PI / 3;
  const nested = new THREE.Group();
  nested.position.set(1, 0, 3);
  group.add(nested);
  scene.add(group);
  const material = new THREE.MeshStandardMaterial();
  const shared = new THREE.BoxGeometry(1, 1, 1);
  const unique = new THREE.BoxGeometry(1, 1, 1);
  const a = new THREE.Mesh(shared, material), b = new THREE.Mesh(unique, material);
  a.position.x = -2;
  b.position.x = 2;
  nested.add(a, b);
  const animated = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  animated.position.y = 3;
  group.add(animated);
  const external = new THREE.Mesh(shared, material);
  scene.add(external);
  const sharedDisposed = tracked(shared), uniqueDisposed = tracked(unique);
  const before = new THREE.Box3().setFromObject(group);
  batchStaticMeshes(group, new Set([animated]));
  const after = new THREE.Box3().setFromObject(group);
  assert.ok(before.min.distanceTo(after.min) < 1e-6);
  assert.ok(before.max.distanceTo(after.max) < 1e-6);
  const meshes = [];
  group.traverse((node) => { if (node.isMesh) meshes.push(node); });
  assert.equal(meshes.length, 2);
  assert.ok(meshes.includes(animated));
  assert.equal(sharedDisposed(), 0);
  assert.equal(uniqueDisposed(), 1);
  disposeVisualResources([scene]);
  assert.equal(sharedDisposed(), 1);
});

test('instanced meshes and their shared resources are released once', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, 2);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const meshDisposed = tracked(mesh);
  const geometryDisposed = tracked(geometry);
  const materialDisposed = tracked(material);
  disposeVisualResources([scene, mesh, scene]);
  assert.equal(meshDisposed(), 1);
  assert.equal(geometryDisposed(), 1);
  assert.equal(materialDisposed(), 1);
});

test('local visual assets configure PBR textures and release models and textures once', async () => {
  const map = new THREE.Texture();
  const normalMap = new THREE.Texture();
  const mapDisposed = tracked(map);
  const normalDisposed = tracked(normalMap);
  const { root, material } = model();
  const materialDisposed = tracked(material);
  const requested = [];
  const assets = await loadVisualAssets({
    textures: { ground: { path: 'assets/test/ground', repeat: [4, 6] } },
    models: { animal: { path: 'assets/test/animal.glb', length: 2 } },
  }, {
    textureLoader: { async loadAsync(path) {
      requested.push(path);
      return path.endsWith('-normal.jpg') ? normalMap : map;
    } },
    modelLoader: { async loadAsync(path) { requested.push(path); return { scene: root }; } },
  });
  assert.deepEqual(requested.sort(), [
    '/assets/test/animal.glb', '/assets/test/ground-normal.jpg', '/assets/test/ground.jpg',
  ]);
  assert.equal(assets.textures.ground.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(assets.textures.ground.normalMap.colorSpace, THREE.NoColorSpace);
  for (const texture of [map, normalMap]) {
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.deepEqual(texture.repeat.toArray(), [4, 6]);
    assert.equal(texture.anisotropy, 4);
  }
  const scene = new THREE.Scene();
  scene.add(assets.models.animal.clone(true));
  assets.dispose(scene);
  assets.dispose(scene);
  assert.equal(mapDisposed(), 1);
  assert.equal(normalDisposed(), 1);
  assert.equal(materialDisposed(), 1);
});

test('vehicle preparation preserves animated wheels and releases shared clone resources', async () => {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const bodyGeometry = new THREE.BoxGeometry(3, 1, 1);
  const wheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8);
  const body = new THREE.Mesh(bodyGeometry, material);
  body.position.y = 0.8;
  const wheel = new THREE.Group();
  wheel.name = 'WheelFrontL';
  wheel.position.set(1, 0.3, 0.5);
  wheel.add(new THREE.Mesh(wheelGeometry, material));
  root.add(body, wheel);
  const bodyDisposed = tracked(bodyGeometry), wheelDisposed = tracked(wheelGeometry), materialDisposed = tracked(material);
  const assets = await loadVisualAssets({
    models: { car: { path: 'assets/energy/car.glb', length: 3.2, prepare: prepareEnergyVehicle } },
  }, { modelLoader: { async loadAsync() { return { scene: root }; } } });
  const car = assets.models.car;
  const copy = car.clone(true);
  const pivot = copy.getObjectByName('energy-wheel');
  assert.ok(pivot && pivot.userData.radius > 0);
  const preparedWheelDisposed = tracked(pivot.children[0].geometry);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(copy).min.y) < 1e-6);
  assert.equal(bodyDisposed(), 1);
  assert.equal(wheelDisposed(), 1);
  const scene = new THREE.Scene();
  scene.add(copy);
  assets.dispose(scene);
  assert.equal(materialDisposed(), 1);
  assert.equal(preparedWheelDisposed(), 1);
});

test('failed local asset loads report the failing path and release successful loads', async () => {
  const map = new THREE.Texture();
  const mapDisposed = tracked(map);
  const { root, material, left, right } = model();
  const materialDisposed = tracked(material);
  const leftDisposed = tracked(left);
  const rightDisposed = tracked(right);
  await assert.rejects(loadVisualAssets({
    textures: { ground: { path: 'assets/test/ground', repeat: [1, 1] } },
    models: { animal: { path: 'assets/test/animal.glb', length: 2 } },
  }, {
    textureLoader: { async loadAsync(path) {
      if (path.endsWith('-normal.jpg')) throw new Error('arquivo ausente');
      return map;
    } },
    modelLoader: { async loadAsync() { return { scene: root }; } },
  }), /assets\/test\/ground-normal\.jpg: arquivo ausente/);
  assert.equal(mapDisposed(), 1);
  assert.equal(materialDisposed(), 1);
  assert.equal(leftDisposed(), 1);
  assert.equal(rightDisposed(), 1);
});

test('scene hover follows the mouse and moving assets, clears on exit, and ignores touch', () => {
  const handlers = new Map();
  const element = {
    style: {},
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeEventListener(type, handler) {
      assert.equal(handlers.get(type), handler);
      handlers.delete(type);
    },
    getBoundingClientRect() { return { left: 10, top: 20, right: 110, bottom: 120 }; },
  };
  let hit = 'asset-1';
  const hover = trackSceneHover(element, (position) => {
    assert.deepEqual(position, { clientX: 50, clientY: 60 });
    return hit;
  });
  assert.equal(hover.current(), null);
  handlers.get('pointermove')({ pointerType: 'mouse', clientX: 50, clientY: 60 });
  assert.equal(hover.current(), 'asset-1');
  assert.equal(element.style.cursor, 'pointer');
  hit = 'asset-2';
  assert.equal(hover.current(), 'asset-2');
  hit = null;
  assert.equal(hover.current(), null);
  assert.equal(element.style.cursor, 'grab');
  handlers.get('pointerleave')();
  hit = 'asset-1';
  assert.equal(hover.current(), null);
  handlers.get('pointermove')({ pointerType: 'touch', clientX: 50, clientY: 60 });
  assert.equal(hover.current(), null);
  handlers.get('pointermove')({ pointerType: 'mouse', clientX: 120, clientY: 60 });
  assert.equal(hover.current(), null);
  handlers.get('pointermove')({ pointerType: 'mouse', clientX: 50, clientY: 60 });
  handlers.get('pointercancel')();
  assert.equal(hover.current(), null);
  hover.dispose();
  assert.equal(handlers.size, 0);
});

test('farm models and surface textures are self-contained local assets', async () => {
  for (const name of ['cow', 'sheep']) {
    const bytes = await readFile(new URL(`../app/public/assets/farm/${name}.glb`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(4), 2);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.match(json.asset.copyright, /CC0/);
    assert.ok((json.buffers || []).every((buffer) => !buffer.uri || buffer.uri.startsWith('data:')));
    assert.ok((json.images || []).every((image) => !image.uri || image.uri.startsWith('data:')));
  }
  for (const path of [
    'farm/soil.jpg', 'farm/soil-normal.jpg',
    'energy/grass.jpg', 'energy/grass-normal.jpg',
    'energy/concrete.jpg', 'energy/concrete-normal.jpg',
  ]) {
    const bytes = await readFile(new URL(`../app/public/assets/${path}`, import.meta.url));
    assert.ok(bytes.length > 10000, path);
    assert.equal(bytes.readUInt16BE(0), 0xffd8, path);
  }
});
