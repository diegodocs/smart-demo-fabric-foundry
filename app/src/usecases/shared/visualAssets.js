import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function disposeVisualResources(roots, additionalTextures = []) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set(additionalTextures);
  const instancedMeshes = new Set();
  for (const root of roots) {
    root?.traverse((node) => {
      if (node.isCSS2DObject) node.element.remove();
      if (node.isInstancedMesh) instancedMeshes.add(node);
      if (node.geometry) geometries.add(node.geometry);
      for (const material of node.material ? [].concat(node.material) : []) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    });
  }
  instancedMeshes.forEach((mesh) => mesh.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

export function batchStaticMeshes(root, excluded = new Set()) {
  root.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  root.traverse((node) => {
    if (node === root || !node.isMesh || node.isInstancedMesh || node.isSkinnedMesh
      || node.children.length || excluded.has(node) || Array.isArray(node.material)
      || node.material.transparent) return;
    const signature = Object.entries(node.geometry.attributes)
      .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`)
      .sort().join();
    const key = `${node.material.uuid}:${!!node.geometry.index}:${signature}:${node.castShadow}:${node.receiveShadow}:${node.renderOrder}:${node.layers.mask}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
  });

  const batches = [], temporary = new Set();
  try {
    for (const nodes of buckets.values()) {
      if (nodes.length < 2) continue;
      const geometries = nodes.map((node) => {
        const geometry = node.geometry.clone();
        temporary.add(geometry);
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
        return geometry;
      });
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error('Não foi possível otimizar a geometria estática da cena.');
      temporary.add(merged);
      const mesh = new THREE.Mesh(merged, nodes[0].material);
      mesh.castShadow = nodes[0].castShadow;
      mesh.receiveShadow = nodes[0].receiveShadow;
      mesh.renderOrder = nodes[0].renderOrder;
      mesh.layers.mask = nodes[0].layers.mask;
      batches.push({ nodes, mesh });
    }
  } catch (error) {
    temporary.forEach((geometry) => geometry.dispose());
    throw error;
  }

  const removedGeometries = new Set();
  for (const { nodes, mesh } of batches) {
    for (const node of nodes) {
      removedGeometries.add(node.geometry);
      node.parent.remove(node);
    }
    temporary.delete(mesh.geometry);
    root.add(mesh);
  }
  temporary.forEach((geometry) => geometry.dispose());
  let sceneRoot = root;
  while (sceneRoot.parent) sceneRoot = sceneRoot.parent;
  sceneRoot.traverse((node) => { if (node.geometry) removedGeometries.delete(node.geometry); });
  removedGeometries.forEach((geometry) => geometry.dispose());
}

export function prepareStaticModel(source, targetLength) {
  if (!Number.isFinite(targetLength) || targetLength <= 0) {
    throw new Error('O tamanho do modelo 3D deve ser positivo.');
  }
  const result = new THREE.Group();
  const originalGeometries = new Set();
  const ownedGeometries = new Set();
  const buckets = new Map();
  try {
    source.updateMatrixWorld(true);
    source.traverse((node) => {
      if (!node.isMesh) return;
      if (node.isSkinnedMesh) throw new Error('Modelos 3D animados não podem ser otimizados como modelos estáticos.');
      originalGeometries.add(node.geometry);
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      ownedGeometries.add(geometry);
      if (Array.isArray(node.material)) {
        result.add(new THREE.Mesh(geometry, node.material));
        return;
      }
      const signature = Object.entries(geometry.attributes)
        .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`)
        .sort().join();
      const key = `${node.material.uuid}:${!!geometry.index}:${signature}`;
      if (!buckets.has(key)) buckets.set(key, { material: node.material, geometries: [] });
      buckets.get(key).geometries.push(geometry);
    });
    for (const { material, geometries } of buckets.values()) {
      const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
      if (!merged) throw new Error('Não foi possível otimizar um modelo 3D local.');
      if (geometries.length > 1) {
        ownedGeometries.add(merged);
        geometries.forEach((geometry) => {
          geometry.dispose();
          ownedGeometries.delete(geometry);
        });
      }
      result.add(new THREE.Mesh(merged, material));
    }
    const bounds = new THREE.Box3().setFromObject(result);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.z);
    if (!Number.isFinite(length) || length <= 0) throw new Error('O modelo 3D local não possui geometria válida.');
    const content = new THREE.Group();
    content.add(result);
    result.position.set(-center.x, -bounds.min.y, -center.z);
    content.scale.setScalar(targetLength / length);
    originalGeometries.forEach((geometry) => geometry.dispose());
    return content;
  } catch (error) {
    ownedGeometries.forEach((geometry) => geometry.dispose());
    throw error;
  }
}

export async function loadVisualAssets({ textures = {}, models = {} }, loaders = {}) {
  const textureLoader = loaders.textureLoader || new THREE.TextureLoader();
  const modelLoader = loaders.modelLoader || new GLTFLoader();
  const base = import.meta.env?.BASE_URL ?? '/';
  const requests = [];
  for (const [name, definition] of Object.entries(textures)) {
    requests.push({ name, kind: 'map', path: `${definition.path}.jpg` });
    requests.push({ name, kind: 'normalMap', path: `${definition.path}-normal.jpg` });
  }
  for (const [name, definition] of Object.entries(models)) {
    requests.push({ name, kind: 'model', path: definition.path });
  }
  const results = await Promise.allSettled(requests.map(async (request) => {
    const loaded = await (request.kind === 'model' ? modelLoader : textureLoader).loadAsync(`${base}${request.path}`);
    const resource = request.kind === 'model' ? loaded.scene : loaded;
    if (request.kind === 'model' ? !resource?.isObject3D : !resource?.isTexture) {
      throw new Error('O recurso carregado não é um modelo ou textura válido.');
    }
    return resource;
  }));
  const roots = [];
  const loadedTextures = [];
  const surfaces = {};
  const modelRoots = {};
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const { name, kind } = requests[index];
    if (kind === 'model') {
      roots.push(result.value);
      modelRoots[name] = result.value;
    } else {
      loadedTextures.push(result.value);
      surfaces[name] ||= {};
      surfaces[name][kind] = result.value;
    }
  });
  const failureIndex = results.findIndex((result) => result.status === 'rejected');
  if (failureIndex !== -1) {
    disposeVisualResources(roots, loadedTextures);
    const failure = results[failureIndex].reason;
    throw new Error(`Falha ao carregar o recurso local ${requests[failureIndex].path}: ${failure?.message || String(failure)}`);
  }
  try {
    for (const [name, definition] of Object.entries(textures)) {
      const { map, normalMap } = surfaces[name];
      map.colorSpace = THREE.SRGBColorSpace;
      for (const texture of [map, normalMap]) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(...definition.repeat);
        texture.anisotropy = 4;
      }
    }
    for (const [name, definition] of Object.entries(models)) {
      const source = modelRoots[name];
      const prepared = prepareStaticModel(source, definition.length);
      roots[roots.indexOf(source)] = prepared;
      modelRoots[name] = prepared;
    }
  } catch (error) {
    disposeVisualResources(roots, loadedTextures);
    throw error;
  }
  let disposed = false;
  return {
    textures: surfaces,
    models: modelRoots,
    dispose(scene, additionalTextures = []) {
      if (disposed) return;
      disposed = true;
      disposeVisualResources([scene, ...roots], [...loadedTextures, ...additionalTextures]);
    },
  };
}
