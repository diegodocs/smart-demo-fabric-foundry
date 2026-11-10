import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { effectiveSpeed } from '../../domain/simulation.js';
import { VEHICLE_STATE_LABELS } from '../../domain/telemetry.js';
import { createFarmWheels, rollFarmWheels } from '../farm/wheels.js';
import { loadVisualAssets } from '../shared/visualAssets.js';
import { trackSceneHover } from '../shared/sceneHover.js';
import { MINING_POSITIONS as POS } from './layout.js';

const STATUS_COLOR = { online: 0x298f55, alert: 0xd59620, offline: 0xd74e46 };
const working = (asset) => !asset.commLost && effectiveSpeed(asset) > 0 && asset.isRunning;

export async function initMiningScene(container, assets, { onPick } = {}) {
  const visuals = await loadVisualAssets({
    textures: {
      soil: { path: 'assets/farm/soil', repeat: [16, 8] },
      concrete: { path: 'assets/energy/concrete', repeat: [6, 4] },
      grass: { path: 'assets/energy/grass', repeat: [12, 4] },
    },
  });
  let scene;
  const releases = [() => visuals.dispose(scene)];
  const releaseAll = () => { while (releases.length) releases.pop()(); };

  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xc8e2ed);
    scene.fog = new THREE.Fog(0xc8e2ed, 340, 540);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    releases.unshift(() => { renderer.dispose(); renderer.domElement.remove(); });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 600);
    const target = new THREE.Vector3(3, 0, 2);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const fitDistance = 94 / Math.sin(Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect)));
    const direction = new THREE.Vector3(0.55, 0.65, 0.85).normalize();
    const home = target.clone().addScaledVector(direction, fitDistance);
    const intro = target.clone().addScaledVector(direction, fitDistance * 1.15);
    camera.position.copy(intro);

    const controls = new OrbitControls(camera, renderer.domElement);
    releases.push(() => controls.dispose());
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.12;
    controls.minDistance = 8;
    controls.maxDistance = Math.max(360, fitDistance * 1.4);
    controls.autoRotateSpeed = 0.18;

    const labelRenderer = new CSS2DRenderer();
    releases.push(() => labelRenderer.domElement.remove());
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', pointerEvents: 'none' });
    container.appendChild(labelRenderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    releases.push(() => pmrem.dispose());
    const room = new RoomEnvironment();
    releases.push(() => room.dispose());
    const environment = pmrem.fromScene(room, 0.04);
    releases.push(() => environment.dispose());
    scene.environment = environment.texture;
    scene.add(new THREE.HemisphereLight(0xe4f3ff, 0x81704b, 1.8));
    const sun = new THREE.DirectionalLight(0xfff0d7, 3);
    sun.position.set(-40, 100, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 80, bottom: -80, near: 0.5, far: 240 });
    sun.shadow.normalBias = 0.04;
    releases.push(() => sun.shadow.map?.dispose());
    scene.add(sun);

    const composer = new EffectComposer(renderer);
    releases.push(() => { composer.passes.forEach((pass) => pass.dispose?.()); composer.dispose(); });
    composer.addPass(new RenderPass(scene, camera));
    const outline = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene, camera);
    outline.edgeStrength = 3;
    outline.visibleEdgeColor.set(0x086a82);
    outline.hiddenEdgeColor.set(0x3c8787);
    composer.addPass(outline);
    composer.addPass(new OutputPass());

    const material = (color, roughness = 0.6, metalness = 0.1, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.7, ...extra });
    const mat = {
      soil: material(0xc6a981, 1, 0, { ...visuals.textures.soil, normalScale: new THREE.Vector2(0.55, 0.55) }),
      grass: material(0x8cad78, 1, 0, { ...visuals.textures.grass, normalScale: new THREE.Vector2(0.45, 0.45) }),
      concrete: material(0xc3c5bf, 0.95, 0, { ...visuals.textures.concrete, normalScale: new THREE.Vector2(0.4, 0.4) }),
      road: material(0x9b8165, 0.98),
      rock: material(0x6a5a49, 0.95),
      rockLight: material(0x9c7d5b, 0.95),
      steel: material(0x91a3a4, 0.35, 0.8),
      dark: material(0x26373e, 0.7, 0.3),
      rubber: material(0x171b1b, 0.9),
      yellow: material(0xf0b529, 0.45, 0.25),
      orange: material(0xc77631, 0.55, 0.2),
      blue: material(0x44757b, 0.5, 0.35),
      white: material(0xdbe0d9, 0.55, 0.15),
      teal: material(0x218879, 0.45, 0.35),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x94c9d0, transparent: true, opacity: 0.65, roughness: 0.12, metalness: 0.1, depthWrite: false,
      }),
    };

    function box(parent, width, height, depth, surface, x = 0, y = 0, z = 0, radius = 0) {
      const geometry = radius ? new RoundedBoxGeometry(width, height, depth, 3, radius) : new THREE.BoxGeometry(width, height, depth);
      const mesh = new THREE.Mesh(geometry, surface);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    }

    function cylinder(parent, top, bottom, height, surface, x = 0, y = 0, z = 0, segments = 20) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), surface);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    }

    function pipe(parent, from, to, radius, surface) {
      const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
      const mesh = cylinder(parent, radius, radius, start.distanceTo(end), surface);
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
      return mesh;
    }

    const zoneLabels = [];
    function zone(text, position, types) {
      const div = document.createElement('div');
      div.className = 'energy-zone-label';
      div.textContent = text;
      const label = new CSS2DObject(div);
      label.visible = false;
      label.position.set(...position);
      scene.add(label);
      zoneLabels.push({ label, types });
    }

    box(scene, 148, 0.3, 82, mat.soil, 2, -0.2, 1);
    box(scene, 148, 0.1, 7, mat.grass, 2, -0.01, -36);
    box(scene, 148, 0.1, 7, mat.grass, 2, -0.01, 38);
    box(scene, 48, 0.12, 48, mat.concrete, 8, 0.03, 0);
    box(scene, 31, 0.12, 48, mat.concrete, 29, 0.03, 0);
    for (const start of POS.haulStarts) {
      box(scene, 23, 0.08, 5.2, mat.road, -31, 0.12, start[2]);
      for (let x = -39; x <= -23; x += 4) box(scene, 1.8, 0.025, 0.07, mat.white, x, 0.18, start[2]);
    }
    box(scene, 5, 0.08, 39, mat.road, 43, 0.12, 6);
    for (const z of [-10, 6, 22]) box(scene, 23, 0.08, 4.5, mat.road, 34, 0.12, z);
    for (const center of POS.distribution) {
      box(scene, 20, 0.08, 4.5, mat.road, 51, 0.12, center[2] + 6);
      box(scene, 13, 0.12, 11, mat.concrete, center[0], 0.03, center[2]);
    }

    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(7 + i * 1.7, 8.6 + i * 1.7, 40), i % 2 ? mat.rockLight : mat.road);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.y = 0.6;
      ring.position.set(POS.excavator[0], 0.08 + i * 0.35, POS.excavator[2]);
      scene.add(ring);
      const bank = new THREE.Mesh(
        new THREE.CylinderGeometry(8.6 + i * 1.7, 7 + i * 1.7, 0.35, 40, 1, true), mat.rockLight);
      bank.position.set(POS.excavator[0], 0.25 + i * 0.35, POS.excavator[2]);
      bank.scale.z = 0.6;
      scene.add(bank);
    }
    for (let i = 0; i < 18; i++) {
      const angle = i * 2.4;
      const radius = 10 + (i % 3) * 1.3;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + (i % 4) * 0.22, 0), i % 2 ? mat.rock : mat.rockLight);
      rock.position.set(POS.excavator[0] + Math.cos(angle) * radius, 0.4, POS.excavator[2] + Math.sin(angle) * radius * 0.58);
      rock.scale.set(1.3, 0.7, 1);
      scene.add(rock);
    }
    for (let i = 0; i < 5; i++) {
      const pile = new THREE.Mesh(new THREE.ConeGeometry(2.2 + i % 2 * 0.5, 2.8 + i % 3 * 0.4, 7), i % 2 ? mat.rock : mat.rockLight);
      pile.position.set(-59 + i * 3.3, 1.4, -23 - i % 2);
      pile.rotation.y = i * 0.7;
      pile.scale.z = 0.75;
      scene.add(pile);
    }
    for (const crusher of POS.crushers) {
      pipe(scene, [crusher[0] + 2.5, 2.3, crusher[2]], [-9, 2.3, 0], 0.45, mat.dark);
      pipe(scene, [crusher[0] + 2.5, 2.8, crusher[2]], [-9, 2.8, 0], 0.08, mat.steel);
    }
    pipe(scene, [1, 2.3, 0], [4, 2.3, 0], 0.5, mat.dark);
    for (const silo of POS.silos) {
      pipe(scene, [12, 5.4, 0], [silo[0], 5.4, silo[2]], 0.15, mat.steel);
    }
    for (let i = 0; i < 12; i++) {
      box(scene, 0.15, 1, 0.15, mat.yellow, -62 + i * 11, 0.5, 34);
      box(scene, 10.8, 0.08, 0.08, mat.white, -56.5 + i * 11, 0.88, 34);
    }

    zone('EXTRAÇÃO', [-49, 9, -17], ['excavator', 'haul-truck']);
    zone('3 BRITAGENS', [-17, 10, -26], ['crusher']);
    zone('USINA', [8, 11, -12], ['ore-processor', 'mine-conveyor']);
    zone('6 SILOS', [29, 12, -28], ['product-silo']);
    zone('DISTRIBUIÇÃO', [59, 10, -29], ['distribution-center']);
    zone('TERMINAL', [49, 7, 37], ['delivery-terminal', 'delivery-truck']);

    function truck(asset) {
      const group = new THREE.Group();
      const haul = asset.type === 'haul-truck';
      const wheels = createFarmWheels(
        [{ x: -1.65, radius: haul ? 0.76 : 0.58, width: 0.4 },
          { x: 1.45, radius: haul ? 0.76 : 0.58, width: 0.4 }],
        haul ? 3 : 2.4, { rubber: mat.rubber, hub: mat.steel });
      group.add(...wheels);
      box(group, 5.2, 0.5, haul ? 2.9 : 2.3, mat.dark, 0, 1.05, 0, 0.12);
      box(group, 1.6, 1.65, haul ? 2.6 : 2.15, haul ? mat.yellow : mat.blue, 1.65, 1.9, 0, 0.12);
      box(group, 0.06, 0.74, haul ? 2.1 : 1.8, mat.glass, 2.48, 2.15, 0);
      box(group, 1.15, 0.68, 0.04, mat.glass, 1.55, 2.15, haul ? 1.32 : 1.1);
      if (haul) {
        box(group, 3.2, 0.35, 2.75, mat.orange, -0.65, 1.55, 0);
        box(group, 3.1, 0.85, 0.16, mat.yellow, -0.65, 2, -1.3);
        box(group, 3.1, 0.85, 0.16, mat.yellow, -0.65, 2, 1.3);
        box(group, 0.16, 0.85, 2.6, mat.yellow, -2.2, 2, 0);
        const load = box(group, 2.9, 0.45, 2.45, mat.rock, -0.65, 1.95, 0);
        return { group, wheels, update() { load.visible = asset.payloadT > 0.1; load.scale.y = Math.max(0.05, asset.payloadT / asset.capacityT); } };
      }
      box(group, 3.2, 1.7, 2.18, mat.white, -0.65, 2, 0, 0.08);
      box(group, 2.9, 0.14, 0.04, mat.teal, -0.65, 2, 1.11);
      return { group, wheels, update() {} };
    }

    function build(asset) {
      const group = new THREE.Group();
      let update = () => {};
      let wheels = [];
      if (asset.type === 'haul-truck' || asset.type === 'delivery-truck') return truck(asset);

      if (asset.type === 'excavator') {
        box(group, 4.4, 0.8, 1.05, mat.dark, 0, 0.6, -1.2, 0.25);
        box(group, 4.4, 0.8, 1.05, mat.dark, 0, 0.6, 1.2, 0.25);
        box(group, 3.5, 1.2, 2.5, mat.yellow, 0, 1.55, 0, 0.15);
        box(group, 1.25, 1.55, 1.35, mat.dark, -0.65, 2.75, 0.5, 0.08);
        box(group, 1.1, 1.05, 0.04, mat.glass, -0.65, 2.85, 1.2);
        const arm = new THREE.Group();
        arm.position.set(1.2, 2.2, -0.4);
        const boom = box(arm, 4.2, 0.46, 0.5, mat.yellow, 1.9, 0.8, 0, 0.12);
        boom.rotation.z = 0.4;
        const stick = box(arm, 0.45, 2.6, 0.5, mat.yellow, 3.7, 0.35, 0, 0.08);
        stick.rotation.z = 0.5;
        box(arm, 1.1, 0.55, 1.1, mat.steel, 4.15, -0.8, 0, 0.08);
        group.add(arm);
        update = (time) => { if (working(asset)) arm.rotation.z = Math.sin(time * 0.6) * 0.12; };
      } else if (asset.type === 'crusher') {
        box(group, 5.5, 0.4, 5.5, mat.concrete, 0, 0.2, 0);
        box(group, 4, 3.2, 3.8, mat.blue, 0, 2, 0, 0.12);
        box(group, 4.6, 0.25, 4.2, mat.steel, 0, 3.65, 0);
        const hopper = cylinder(group, 2.4, 1.3, 1.8, mat.orange, 0, 4.65, 0, 4);
        hopper.rotation.y = Math.PI / 4;
        const rotor = cylinder(group, 0.65, 0.65, 3.1, mat.dark, 0, 2.1, 2);
        rotor.rotation.x = Math.PI / 2;
        update = (_time, dt) => { if (working(asset)) rotor.rotation.y += dt * 2; };
      } else if (asset.type === 'mine-conveyor') {
        box(group, 10, 0.45, 2.4, mat.steel, 0, 2, 0);
        box(group, 9.7, 0.2, 1.9, mat.dark, 0, 2.3, 0);
        [-4, 0, 4].forEach((x) => {
          box(group, 0.25, 1.9, 0.25, mat.steel, x, 1, -0.9);
          box(group, 0.25, 1.9, 0.25, mat.steel, x, 1, 0.9);
        });
        const rocks = Array.from({ length: 5 }, (_, i) => {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + (i % 2) * 0.1, 0), mat.rockLight);
          rock.position.y = 2.65;
          group.add(rock);
          return rock;
        });
        update = (time) => rocks.forEach((rock, index) => {
          rock.visible = working(asset);
          rock.position.x = -4.5 + ((time * 1.2 + index * 1.8) % 9);
          rock.position.z = index % 2 ? 0.35 : -0.35;
        });
      } else if (asset.type === 'ore-processor') {
        box(group, 8.5, 0.4, 7, mat.concrete, 0, 0.2, 0);
        box(group, 7.5, 5.5, 6, mat.white, 0, 3, 0, 0.15);
        box(group, 7.8, 0.4, 6.4, mat.blue, 0, 6, 0);
        for (let x = -2.6; x <= 2.6; x += 1.3) box(group, 0.65, 1.3, 0.05, mat.glass, x, 4.2, 3.02);
        box(group, 2.3, 2.5, 0.08, mat.dark, 1.8, 1.55, 3.04);
        cylinder(group, 0.55, 0.7, 5.8, mat.steel, -3.2, 3.3, -2.4);
        cylinder(group, 0.8, 0.8, 0.25, mat.dark, -3.2, 6.3, -2.4);
        const lamp = box(group, 0.45, 0.45, 0.08, material(0x218879, 0.45, 0.35), -2.7, 2, 3.05);
        update = () => { lamp.material.emissive.set(working(asset) ? 0x006e55 : 0x000000); };
      } else if (asset.type === 'product-silo') {
        box(group, 7, 0.4, 7, mat.concrete, 0, 0.2, 0);
        cylinder(group, 2.6, 2.6, 6.2, mat.steel, 0, 3.5, 0, 28);
        cylinder(group, 0, 2.9, 1.6, mat.blue, 0, 7.4, 0, 28);
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3;
          box(group, 0.14, 6, 0.14, mat.dark, Math.cos(angle) * 2.62, 3.4, Math.sin(angle) * 2.62);
        }
        box(group, 0.7, 5, 0.15, mat.dark, 0, 3.5, 2.66);
        const gauge = box(group, 0.5, 4.6, 0.1, mat.teal, 0, 3.5, 2.77);
        pipe(group, [1.5, 5.5, 1], [1.5, 4, 6], 0.3, mat.steel);
        pipe(group, [1.5, 4, 6], [1.5, 2.8, 6], 0.3, mat.steel);
        update = () => {
          const level = Math.max(0.01, Math.min(1, asset.inventoryT / asset.capacityT));
          gauge.scale.y = level;
          gauge.position.y = 1.2 + 2.3 * level;
        };
      } else if (asset.type === 'distribution-center') {
        box(group, 11, 0.4, 8, mat.concrete, 0, 0.2, 0);
        box(group, 10, 5, 6.8, mat.white, 0, 2.7, 0, 0.1);
        box(group, 10.4, 0.4, 7.2, mat.teal, 0, 5.4, 0);
        for (const x of [-3.2, 0, 3.2]) {
          box(group, 2.3, 2.8, 0.08, mat.dark, x, 1.8, 3.44);
          box(group, 2.5, 0.18, 1.3, mat.steel, x, 0.5, 4);
          box(group, 0.12, 3, 0.12, mat.yellow, x - 1.2, 1.8, 3.6);
          box(group, 0.12, 3, 0.12, mat.yellow, x + 1.2, 1.8, 3.6);
        }
        for (let i = 0; i < 3; i++) box(group, 1.1, 1, 1.1, mat.orange, -4 + i * 1.3, 0.9, -4.1);
      } else if (asset.type === 'delivery-terminal') {
        box(group, 8.5, 0.4, 7, mat.concrete, 0, 0.2, 0);
        box(group, 7.5, 4, 5.8, mat.white, 0, 2.2, 0, 0.1);
        box(group, 7.8, 0.4, 6.2, mat.teal, 0, 4.35, 0);
        box(group, 3.5, 2.7, 0.08, mat.dark, 0.8, 1.7, 2.94);
        box(group, 1.2, 1, 0.08, mat.glass, -2.4, 2.8, 2.94);
        box(group, 0.25, 4.5, 0.25, mat.yellow, 3.4, 2.4, 4.3);
        box(group, 5.5, 0.2, 0.25, mat.yellow, 0.7, 4.65, 4.3);
        box(group, 5.5, 0.2, 2.8, mat.teal, 0.7, 4.8, 4.3);
        box(group, 0.25, 4.5, 0.25, mat.yellow, -2, 2.4, 5.6);
      }
      return { group, wheels, update };
    }

    const hits = [];
    const rendered = [];
    const markerGeometry = new THREE.RingGeometry(2.4, 2.52, 32);
    const hitSizes = {
      excavator: [7, 5, 5], 'haul-truck': [6, 3.5, 3.5], crusher: [6, 6, 6],
      'mine-conveyor': [10, 3.5, 3], 'ore-processor': [8, 7, 7],
      'product-silo': [6, 9, 6], 'delivery-truck': [6, 3.5, 3], 'delivery-terminal': [8, 5, 7],
      'distribution-center': [11, 6, 8],
    };
    for (const asset of assets) {
      const root = new THREE.Group();
      root.position.set(...asset.pos);
      const { group, update, wheels } = build(asset);
      root.add(group);
      const [width, height, depth] = hitSizes[asset.type];
      const hit = box(root, width, height, depth, new THREE.MeshBasicMaterial({ visible: false }), 0, height / 2, 0);
      hit.userData.assetId = asset.id;
      hits.push(hit);
      const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
        color: STATUS_COLOR.online, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
      }));
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = 0.16;
      root.add(marker);
      const div = document.createElement('div');
      div.className = 'scenario-asset-label';
      const label = new CSS2DObject(div);
      label.visible = false;
      label.position.y = height + 0.5;
      root.add(label);
      scene.add(root);
      rendered.push({ asset, root, group, marker, label, update, wheels });
    }
    scene.traverse((node) => {
      if (node.isMesh && node.material?.visible !== false) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
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
      const dt = Math.min(clock.getDelta(), 0.1), time = clock.elapsedTime;
      if (time < 2.5 && lastInteraction <= clock.startTime) camera.position.lerpVectors(intro, home, 1 - (1 - time / 2.5) ** 3);
      controls.autoRotate = !selected && performance.now() - lastInteraction > 20000;
      const hoveredId = hover.current();
      const hoveredAsset = assets.find((asset) => asset.id === hoveredId);
      for (const zone of zoneLabels) zone.label.visible = !!hoveredAsset && zone.types.includes(hoveredAsset.type);
      for (const item of rendered) {
        const { asset, root, marker, label } = item;
        if (asset.moving && !asset.commLost && effectiveSpeed(asset) > 0
          && Number.isFinite(asset.positionX) && Number.isFinite(asset.positionZ)) {
          const previous = root.position.clone();
          root.position.lerp(new THREE.Vector3(asset.positionX, 0, asset.positionZ), 1 - Math.exp(-dt * 5));
          if (Number.isFinite(asset.heading)) {
            const delta = Math.atan2(Math.sin(asset.heading - root.rotation.y), Math.cos(asset.heading - root.rotation.y));
            root.rotation.y += delta * (1 - Math.exp(-dt * 8));
          }
          rollFarmWheels(item.wheels, previous.distanceTo(root.position));
        }
        item.update(time, dt);
        const chosen = selected === asset.id;
        marker.material.color.set(STATUS_COLOR[asset.status] ?? STATUS_COLOR.offline);
        marker.visible = chosen || asset.status !== 'online';
        const state = asset.moving ? ` · ${VEHICLE_STATE_LABELS[asset.vehicleState] || 'Aguardando'}` : '';
        label.element.textContent = `${asset.id}${asset.commLost ? ' · Sem telemetria' : state}`;
        label.element.dataset.status = asset.status;
        label.visible = hoveredId === asset.id;
      }
      controls.update();
      composer.render();
      labelRenderer.render(scene, camera);
    }

    function resize() {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
      labelRenderer.setSize(width, height);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    releases.push(() => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); });
    animate();
    window.__mining = { scene, camera, controls, renderer };
    return {
      select(id) {
        selected = id;
        const item = rendered.find((entry) => entry.asset.id === id);
        outline.selectedObjects = item ? [item.group] : [];
        if (item) interact();
      },
      dispose() {
        releaseAll();
        if (window.__mining?.scene === scene) delete window.__mining;
      },
    };
  } catch (error) {
    releaseAll();
    throw error;
  }
}
