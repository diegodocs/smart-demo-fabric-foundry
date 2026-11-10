import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadEnergyModels } from './models.js';
import { buildEnvironment, buildPowerCircuit, block, pipe } from './environment.js';
import { CIRCUITS } from './layout.js';
import { VEHICLE_STATE_LABELS } from '../../domain/telemetry.js';
import { trackSceneHover } from '../shared/sceneHover.js';

const COLORS = { online: 0x298f55, alert: 0xd59620, offline: 0xd74e46 };

function disposeScene(scene) {
  const geometries = new Set(), materials = new Set();
  scene.traverse((node) => {
    if (node.isCSS2DObject) node.element.remove();
    if (node.userData.energyLibrary) return;
    if (node.geometry) geometries.add(node.geometry);
    for (const mat of node.material ? [].concat(node.material) : []) materials.add(mat);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

export async function initEnergyScene(container, ASSETS, { onPick } = {}) {
  const models = await loadEnergyModels();
  const releases = [() => models.dispose()];
  const releaseAll = () => { while (releases.length) releases.pop()(); };
  try {
  const scene = new THREE.Scene();
  releases.push(() => disposeScene(scene));
  scene.background = new THREE.Color(0xc8e2ed);
  scene.fog = new THREE.Fog(0xc8e2ed, 180, 300);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  releases.unshift(() => { renderer.dispose(); renderer.domElement.remove(); });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  releases.push(() => labelRenderer.domElement.remove());
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);
  const camera = new THREE.PerspectiveCamera(43, container.clientWidth / container.clientHeight, 0.1, 240);
  const home = new THREE.Vector3(63, 55, 72), intro = new THREE.Vector3(84, 74, 94);
  camera.position.copy(intro);
  const controls = new OrbitControls(camera, renderer.domElement);
  releases.push(() => controls.dispose());
  controls.target.set(0, 0, -3);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.12;
  controls.minDistance = 6;
  controls.maxDistance = 155;
  controls.autoRotateSpeed = 0.2;
  const pmrem = new THREE.PMREMGenerator(renderer);
  releases.push(() => pmrem.dispose());
  const room = new RoomEnvironment();
  releases.push(() => room.dispose());
  const environment = pmrem.fromScene(room, 0.04);
  releases.push(() => environment.dispose());
  scene.environment = environment.texture;
  scene.add(new THREE.HemisphereLight(0xe4f3ff, 0x657145, 2));
  const sun = new THREE.DirectionalLight(0xfff2d5, 3.1);
  releases.push(() => sun.shadow.map?.dispose());
  sun.position.set(-38, 65, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -58, right: 58, top: 58, bottom: -58, far: 170 });
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const composer = new EffectComposer(renderer);
  releases.push(() => { composer.passes.forEach((pass) => pass.dispose?.()); composer.dispose(); });
  composer.addPass(new RenderPass(scene, camera));
  const outline = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene, camera);
  outline.visibleEdgeColor.set(0x086a82);
  outline.hiddenEdgeColor.set(0x3c8787);
  outline.edgeStrength = 3;
  composer.addPass(outline);
  composer.addPass(new OutputPass());
  const env = buildEnvironment(scene, models.textures);
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aaeb4, metalness: 0.8, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x26373e, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe7ebe7, roughness: 0.4 });
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x153b60, metalness: 0.55, roughness: 0.25, clearcoat: 1 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x11816e, roughness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x88c4cd, transparent: true, opacity: 0.2, roughness: 0.1, depthWrite: false });
  const waterGlow = new THREE.MeshBasicMaterial({ color: 0x88e9f2 });

  const zoneLabels = [];
  function sign(text, position, types) {
    const div = document.createElement('div');
    div.className = 'energy-zone-label';
    div.textContent = text;
    const label = new CSS2DObject(div);
    label.visible = false;
    label.position.set(...position);
    scene.add(label);
    zoneLabels.push({ label, types });
  }
  sign('FAZENDA SOLAR · 10 PAINÉIS', [-24, 2.3, -13], ['solar-array', 'solar-inverter']);
  sign('REPRESA · GERAÇÃO HIDRELÉTRICA', [6, 6, -28], ['hydro-turbine', 'hydro-gate']);
  sign('CIDADE · 10 CASAS', [16, 3, 11], ['house']);
  sign('RECARGA · CARROS E CAMINHÕES', [-18, 3, 27], ['ev-charger-car', 'ev-charger-truck', 'electric-car', 'electric-truck']);

  function build(data) {
    const group = new THREE.Group();
    let update = () => {};
    if (data.type === 'solar-array') {
      [-0.8, 0.8].forEach((x) => group.add(block(0.08, 0.85, 0.08, steel, x, 0.42, 0.35)));
      const rack = new THREE.Group();
      rack.position.y = 1;
      rack.rotation.x = -0.34;
      rack.add(block(2.4, 0.08, 1.5, steel), block(2.3, 0.025, 1.4, blue, 0, 0.052, 0));
      for (let x = -1; x <= 1; x += 0.25) rack.add(block(0.012, 0.008, 1.36, steel, x, 0.07, 0));
      for (let z = -0.45; z <= 0.5; z += 0.3) rack.add(block(2.28, 0.008, 0.012, steel, 0, 0.07, z));
      group.add(rack);
    } else if (data.type === 'solar-inverter') {
      group.add(block(0.8, 1.35, 0.6, white, 0, 0.675, 0));
      group.add(block(0.82, 0.13, 0.62, teal, 0, 1, 0));
      for (let n = 0; n < 5; n++) group.add(block(0.58, 0.025, 0.02, dark, 0, 0.2 + n * 0.11, 0.31));
    } else if (data.type === 'hydro-turbine') {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 1.5, 24), glass);
      shell.position.y = 1;
      const rotor = new THREE.Group();
      rotor.position.y = 0.95;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.1, 16), steel);
      rotor.add(hub);
      for (let n = 0; n < 8; n++) {
        const blade = block(0.9, 0.07, 0.22, teal, Math.cos(n * Math.PI / 4) * 0.4, 0, Math.sin(n * Math.PI / 4) * 0.4);
        blade.rotation.y = -n * Math.PI / 4;
        blade.rotation.z = 0.25;
        rotor.add(blade);
      }
      group.add(block(2.5, 0.35, 2.5, env.concrete, 0, 0.2, 0), shell, rotor,
        block(1.15, 0.6, 1.15, steel, 0, 2, 0));
      const path = [[0, 3.3, -7], [0, 2.2, -4.7], [0, 0.95, -2.2], [0, 0.95, 0]];
      group.add(pipe(path, 0.36, steel));
      const outlet = pipe([[0, 0.65, 0], [0, 0.3, 2], [0, 0.15, 5]], 0.3, env.waterMat);
      group.add(outlet);
      const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
      const beads = Array.from({ length: 4 }, () => new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), waterGlow));
      beads.forEach((b) => group.add(b));
      update = (t, dt) => {
        const flowing = !data.commLost && Number.isFinite(data.flowM3s) && data.flowM3s > 0;
        if (flowing) rotor.rotation.y += dt * data.flowM3s * 5;
        beads.forEach((b, n) => {
          b.visible = flowing;
          if (flowing) {
            b.position.copy(curve.getPoint((t * data.flowM3s * 0.2 + n / 4) % 1));
            b.position.x += 0.37;
          }
        });
      };
    } else if (data.type === 'hydro-gate') {
      group.add(block(0.3, 4.8, 1.5, env.concrete, -1, 2.4), block(0.3, 4.8, 1.5, env.concrete, 1, 2.4),
        block(2.4, 0.3, 1.7, steel, 0, 4.7));
      const gate = block(1.7, 3.5, 0.15, steel, 0, 1.8, 1.05);
      group.add(gate);
      const chute = pipe([[0, 2, 1.2], [0, 0.6, 5], [0, 0.12, 11]], 0.6, env.waterMat);
      group.add(chute);
      update = () => {
        if (!data.commLost && Number.isFinite(data.usage)) gate.position.y = 1.8 + data.usage / 100 * 1.4;
        chute.visible = !data.commLost && data.spillM3s > 0;
      };
    } else if (data.family === 'charging') {
      group.add(block(0.6, 1.6, 0.5, white, 0, 0.8), block(0.62, 0.3, 0.52, teal, 0, 1.35),
        block(0.36, 0.3, 0.025, dark, 0.31, 0.98));
      group.add(pipe([[0.2, 1.1, 0.2], [0.7, 0.3, 0.5], [1.4, 0.45, 0.25]], 0.035, dark));
    } else if (data.type === 'house') {
      const house = models.createHouse();
      if (data.pos[2] > 10) house.rotation.y = Math.PI;
      group.add(house);
      const window = block(0.8, 0.35, 0.04, new THREE.MeshStandardMaterial({ color: 0xf8d688, emissive: 0xffc867, emissiveIntensity: 0 }), 0, 0.95, 1.88);
      group.add(window);
      update = () => { window.material.emissiveIntensity = !data.commLost && data.servedKw > 0 ? 0.7 : 0; };
    } else if (data.family === 'mobility') {
      group.add(data.type === 'electric-truck' ? models.createTruck() : models.createCar());
    } else if (data.type === 'power-circuit') {
      const circuit = buildPowerCircuit(CIRCUITS.find((c) => c.id === data.id));
      group.add(circuit);
      update = (t) => circuit.userData.flow.forEach(({ mesh, path }, n) => {
        mesh.visible = !data.commLost && data.powerKw > 0;
        if (mesh.visible) mesh.position.copy(path.getPoint((t * 0.35 + n * 0.17) % 1));
      });
      const cabinet = block(0.8, 1.3, 0.6, teal, 0.5, 0.65, 0.3);
      group.add(cabinet);
    }
    return { group, update };
  }

  const hits = [], rendered = [];
  const markerGeometry = new THREE.RingGeometry(0.9, 0.96, 28);
  ASSETS.forEach((data) => {
    const root = new THREE.Group();
    root.position.set(...data.pos);
    const { group, update } = build(data);
    root.add(group);
    const mobile = data.family === 'mobility';
    const hit = new THREE.Mesh(new THREE.BoxGeometry(
      data.type === 'house' ? 3.8 : data.type === 'electric-truck' ? 4.5 : 2.7,
      data.type === 'hydro-turbine' ? 3 : 2.3, data.type === 'house' ? 3.8 : 2.2),
    new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 1;
    hit.userData.assetId = data.id;
    root.add(hit);
    hits.push(hit);
    if (data.type === 'power-circuit') {
      group.traverse((node) => {
        if (node.isMesh) { node.userData.assetId = data.id; hits.push(node); }
      });
    }
    const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
      color: COLORS.online, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
    }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.12;
    root.add(marker);
    const div = document.createElement('div');
    div.className = 'energy-asset-label';
    const label = new CSS2DObject(div);
    label.visible = false;
    label.position.y = data.type === 'power-circuit' ? 6 : data.type === 'house' ? 2.7 : 2.5;
    root.add(label);
    const wheels = [];
    group.traverse((node) => { if (node.name === 'energy-wheel') wheels.push(node); });
    scene.add(root);
    rendered.push({ data, root, group, update, marker, label, wheels, mobile });
  });
  let selected = null, lastInteraction = performance.now(), raf = 0, disposed = false;
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(hits, false)[0]?.object.userData.assetId;
  }
  const onClick = (event) => { const id = pick(event); if (id) onPick?.(id); };
  const hover = trackSceneHover(renderer.domElement, pick);
  const interact = () => { lastInteraction = performance.now(); controls.autoRotate = false; };
  renderer.domElement.addEventListener('click', onClick);
  controls.addEventListener('start', interact);
  releases.push(() => {
    renderer.domElement.removeEventListener('click', onClick);
    hover.dispose();
    controls.removeEventListener('start', interact);
  });
  const clock = new THREE.Clock();
  function animate() {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    if (t < 2.5 && lastInteraction <= clock.startTime) camera.position.lerpVectors(intro, home, 1 - (1 - t / 2.5) ** 3);
    controls.autoRotate = !selected && performance.now() - lastInteraction > 20000;
    const gate = ASSETS.find((d) => d.type === 'hydro-gate');
    env.update(t, gate);
    const hoveredId = hover.current();
    const hoveredAsset = ASSETS.find((asset) => asset.id === hoveredId);
    for (const zone of zoneLabels) zone.label.visible = !!hoveredAsset && zone.types.includes(hoveredAsset.type);
    for (const a of rendered) {
      const d = a.data;
      if (a.mobile && !d.commLost && Number.isFinite(d.positionX) && Number.isFinite(d.positionZ)) {
        const previous = a.root.position.clone();
        a.root.position.lerp(new THREE.Vector3(d.positionX, 0, d.positionZ), 1 - Math.exp(-dt * 5));
        if (Number.isFinite(d.heading)) {
          const delta = Math.atan2(Math.sin(d.heading - a.root.rotation.y), Math.cos(d.heading - a.root.rotation.y));
          a.root.rotation.y += delta * (1 - Math.exp(-dt * 8));
        }
        const distance = previous.distanceTo(a.root.position);
        a.wheels.forEach((wheel) => { if (wheel.userData.radius > 0) wheel.rotation.z -= distance / wheel.userData.radius; });
      }
      a.update(t, dt);
      const chosen = selected === d.id;
      const incomplete = d.metrics?.some((metric) => !Number.isFinite(d[metric.key]));
      a.marker.material.color.set(COLORS[d.status] ?? COLORS.offline);
      a.marker.visible = chosen || d.status !== 'online';
      a.label.element.textContent = `${d.id}${d.commLost ? ' · Sem telemetria' : incomplete ? ' · Leitura incompleta' : a.mobile ? ` · ${VEHICLE_STATE_LABELS[d.vehicleState] || 'Aguardando'}` : ''}`;
      a.label.element.dataset.status = d.status;
      a.label.visible = hoveredId === d.id;
    }
    controls.update();
    composer.render();
    labelRenderer.render(scene, camera);
  }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  releases.push(() => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); });
  animate();
  window.__energy = { scene, camera, controls, renderer };
  return {
    select(id) {
      selected = id;
      const item = rendered.find((a) => a.data.id === id);
      outline.selectedObjects = item ? [item.group] : [];
      if (item) interact();
    },
    dispose() {
      releaseAll();
      if (window.__energy?.scene === scene) delete window.__energy;
    },
  };
  } catch (error) {
    releaseAll();
    throw error;
  }
}
