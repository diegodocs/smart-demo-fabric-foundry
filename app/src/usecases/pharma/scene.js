import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VEHICLE_STATE_LABELS } from '../../domain/telemetry.js';
import { setText } from '../../ui/dom.js';
import { batchStaticMeshes, loadVisualAssets } from '../shared/visualAssets.js';
import { trackSceneHover } from '../shared/sceneHover.js';
import { CITY_ROADS, cityTruckObstacles, createCityTraffic, stepCityTraffic } from './cityTraffic.js';
import { PHARMA_LAYOUT, pharmaDock } from './layout.js';
import { createTruckMotion, updateTruckMotion } from './truckMotion.js';

const COLORS = { online: 0x299e80, alert: 0xe9a528, offline: 0xdf5959 };
const ZONE_SURFACES = {
  'pharma-receiving': 0xe9dcc4,
  'pharma-production': 0xd5e7e6,
  'pharma-quality': 0xdce4f1,
  'pharma-packaging': 0xecdccc,
  'pharma-storage': 0xcde3e9,
  'pharma-distribution': 0xd8e5d9,
  'pharma-pharmacy': 0xe8def0,
};
const ZONE_ACCENTS = {
  'pharma-receiving': 0xc49352,
  'pharma-production': 0x279caa,
  'pharma-quality': 0x5979b2,
  'pharma-packaging': 0xc57949,
  'pharma-storage': 0x4a7db0,
  'pharma-distribution': 0x578c73,
  'pharma-pharmacy': 0x8065a2,
};

export async function initPharmaScene(container, assets, { onPick } = {}) {
  const visuals = await loadVisualAssets({
    textures: {
      concrete: { path: 'assets/energy/concrete', repeat: [8, 6] },
      grass: { path: 'assets/energy/grass', repeat: [10, 8] },
    },
  });
  const scene = new THREE.Scene();
  const releases = [() => visuals.dispose(scene)];
  const releaseAll = () => { while (releases.length) releases.pop()(); };
  try {
    scene.background = new THREE.Color(0xdcecf2);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    releases.unshift(() => { renderer.dispose(); renderer.domElement.remove(); });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 500);
    const fitDistance = () => (camera.aspect < 1 ? 115 : 84)
      / Math.sin(Math.min(THREE.MathUtils.degToRad(21), Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) * camera.aspect)));
    let fit = fitDistance();
    camera.far = Math.max(500, fit * 3);
    camera.updateProjectionMatrix();
    const sceneCenter = new THREE.Vector3(-22, 0, -4);
    camera.position.copy(new THREE.Vector3(0.35, 0.8, 1).normalize().multiplyScalar(fit)).add(sceneCenter);
    const controls = new OrbitControls(camera, renderer.domElement);
    releases.push(() => controls.dispose());
    controls.enableDamping = true;
    controls.target.copy(sceneCenter);
    controls.minDistance = 10;
    controls.maxDistance = Math.max(400, fit * 1.3);
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.autoRotateSpeed = 0.2;

    const labels = new CSS2DRenderer();
    labels.setSize(container.clientWidth, container.clientHeight);
    Object.assign(labels.domElement.style, { position: 'absolute', top: '0', pointerEvents: 'none' });
    container.appendChild(labels.domElement);
    releases.push(() => labels.domElement.remove());
    const pmrem = new THREE.PMREMGenerator(renderer);
    releases.push(() => pmrem.dispose());
    const room = new RoomEnvironment();
    releases.push(() => room.dispose());
    const environment = pmrem.fromScene(room, 0.04);
    releases.push(() => environment.dispose());
    scene.environment = environment.texture;
    scene.add(new THREE.HemisphereLight(0xe4f6ff, 0x819d83, 2));
    const sun = new THREE.DirectionalLight(0xfff1de, 3);
    sun.position.set(-25, 120, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 100, bottom: -100, far: 300 });
    sun.shadow.normalBias = 0.03;
    releases.push(() => sun.shadow.map?.dispose());
    scene.add(sun);

    const material = (color, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness });
    const white = material(0xeaf0f1), teal = material(0x279caa), blue = material(0x4a7db0);
    const steel = material(0xa6bcc5, 0.75), dark = material(0x253945), carton = material(0xc7ab83);
    const zoneMaterials = Object.fromEntries(Object.entries(ZONE_SURFACES)
      .map(([type, color]) => [type, material(color, 0.02)]));
    const accentMaterials = Object.fromEntries(Object.entries(ZONE_ACCENTS)
      .map(([type, color]) => [type, material(color)]));
    const ground = new THREE.MeshStandardMaterial({ color: 0xcedbd9, ...visuals.textures.concrete });
    const grass = new THREE.MeshStandardMaterial({ color: 0x9ab998, ...visuals.textures.grass });
    const sidewalk = material(0xd7d7cf), roof = material(0x8b5d4f), wall = material(0xe8d7bd);
    const scenery = new THREE.Group();
    scene.add(scenery);
    function box(parent, size, pos, mat) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
      mesh.position.set(...pos);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    function cylinder(parent, radius, height, pos, mat) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), mat);
      mesh.position.set(...pos);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    function label(parent, text, pos, className) {
      const div = document.createElement('div');
      div.className = className;
      div.textContent = text;
      const object = new CSS2DObject(div);
      object.visible = false;
      object.position.set(...pos);
      parent.add(object);
      return object;
    }
    box(scenery, [220, 0.4, 100], [-22, -0.5, 0], grass);
    box(scenery, [66, 0.2, 50], [-82, -0.15, -28], ground);
    box(scenery, [96, 0.25, 60], [10, -0.12, -12], ground);
    const cityWidth = CITY_ROADS.right - CITY_ROADS.left + CITY_ROADS.width;
    for (const z of [CITY_ROADS.north, CITY_ROADS.south]) {
      box(scenery, [cityWidth, 0.12, CITY_ROADS.width], [(CITY_ROADS.left + CITY_ROADS.right) / 2, 0.02, z], dark);
      for (let x = CITY_ROADS.left + 6; x < CITY_ROADS.right; x += 6) {
        box(scenery, [2.5, 0.02, 0.12], [x, 0.1, z], white);
      }
    }
    for (const x of [CITY_ROADS.left, CITY_ROADS.shortcut, CITY_ROADS.right]) {
      box(scenery, [CITY_ROADS.width, 0.12, CITY_ROADS.south - CITY_ROADS.north + CITY_ROADS.width],
        [x, 0.03, (CITY_ROADS.north + CITY_ROADS.south) / 2], dark);
      for (let z = CITY_ROADS.north + 6; z < CITY_ROADS.south - 3; z += 6) {
        box(scenery, [0.12, 0.02, 2.5], [x, 0.11, z], white);
      }
    }
    box(scenery, [188, 0.12, 7], [-22, -0.02, PHARMA_LAYOUT.roadZ], dark);
    for (let x = -112; x < 70; x += 7) box(scenery, [3, 0.02, 0.14], [x, 0.06, PHARMA_LAYOUT.roadZ], white);
    const dockAssets = assets.filter((asset) =>
      ['pharma-storage', 'pharma-distribution', 'pharma-pharmacy'].includes(asset.type));
    for (const asset of dockAssets) {
      const { x, z } = pharmaDock(asset);
      box(scenery, [7, 0.1, PHARMA_LAYOUT.roadZ - z], [x, -0.02, (PHARMA_LAYOUT.roadZ + z) / 2], dark);
    }
    function makeHouse(x, z, color, scale = 1) {
      const home = new THREE.Group();
      home.position.set(x, 0, z);
      scenery.add(home);
      box(home, [7 * scale, 4.5 * scale, 6 * scale], [0, 2.3 * scale, 0], color);
      const top = new THREE.Mesh(new THREE.ConeGeometry(5.6 * scale, 2.7 * scale, 4), roof);
      top.position.y = 5.6 * scale;
      top.rotation.y = Math.PI / 4;
      top.castShadow = top.receiveShadow = true;
      home.add(top);
      box(home, [1.1 * scale, 2.2 * scale, 0.15], [0, 1.1 * scale, 3.08 * scale], dark);
      for (const side of [-1, 1]) {
        box(home, [1.5 * scale, 1.3 * scale, 0.15], [side * 2.1 * scale, 2.5 * scale, 3.08 * scale], blue);
      }
    }
    for (const [index, { x, z, scale = 1 }] of PHARMA_LAYOUT.houses.entries()) {
      makeHouse(x, z, index % 2 ? wall : white, scale);
    }
    const factoryLabel = label(scene, 'SMART PHARMA · FÁBRICA', [-82, 1, -49], 'energy-zone-label');
    const cityLabel = label(scene, 'SMART CITY · CASAS E 3 FARMÁCIAS', [10, 1, -43], 'energy-zone-label');
    box(scenery, [94, 0.08, 0.6], [10, 0.03, -39], sidewalk);
    box(scenery, [94, 0.08, 0.6], [10, 0.03, CITY_ROADS.south - CITY_ROADS.width / 2 - 0.4], sidewalk);

    function makeDock(asset) {
      const { x, z } = pharmaDock(asset);
      box(scenery, [8, 0.12, 3], [x, 0.08, z], steel);
      box(scenery, [8, 0.25, 0.3], [x, 3, z - 1.5], white);
      for (const side of [-1, 1]) box(scenery, [0.25, 3, 0.25], [x + side * 3.8, 1.5, z - 1.5], steel);
      const accent = material(0x718891);
      accent.emissive.setHex(0x1a292e);
      cylinder(scenery, 0.3, 0.5, [x, 3.3, z - 1.5], accent);
      const caption = label(scene, `${asset.id} · AGUARDANDO`, [x, 4, z - 1.5], 'energy-zone-label');
      return { asset, x, z, position: new THREE.Vector3(x, 0, z), accent, caption };
    }
    const docks = dockAssets.map(makeDock);

    for (let index = 0; index < 4; index++) {
      const start = new THREE.Vector3(...assets[index].pos), end = new THREE.Vector3(...assets[index + 1].pos);
      start.y = end.y = 0.25;
      const direction = end.clone().sub(start).normalize();
      scenery.add(new THREE.ArrowHelper(direction, start.clone().addScaledVector(direction, 6), Math.max(1, start.distanceTo(end) - 12), 0x239caa, 1.5, 1));
    }
    const rendered = [], hits = [], areaLabels = [];
    for (const [index, asset] of assets.entries()) {
      const root = new THREE.Group();
      root.position.set(...asset.pos);
      if (asset.type === 'pharma-truck') {
        root.position.set(Number.isFinite(asset.positionX) ? asset.positionX : asset.pos[0], 0,
          Number.isFinite(asset.positionZ) ? asset.positionZ : asset.pos[2]);
        root.rotation.y = Number.isFinite(asset.heading) ? asset.heading : 0;
      } else {
        const surface = box(scenery, [16, 0.1, 15], [asset.pos[0], -0.05, asset.pos[2]], zoneMaterials[asset.type]);
        surface.castShadow = false;
        areaLabels.push({ asset, label: label(scene, asset.id, [asset.pos[0], 0.25, asset.pos[2] + 7.5], 'energy-zone-label') });
      }
      scene.add(root);
      let rotor = null, wheels = [];
      if (asset.type === 'pharma-production') {
        box(root, [11, 0.5, 10], [0, 0.3, 0], white);
        for (const x of [-2.7, 2.7]) {
          cylinder(root, 2, 5.5, [x, 3.3, 0], steel);
          cylinder(root, 2.1, 0.4, [x, 6.2, 0], teal);
          box(root, [0.35, 2.8, 0.35], [x, 2.1, 2.5], steel);
        }
        box(root, [0.35, 4.5, 0.35], [0, 2.5, -2], teal);
        rotor = box(root, [7, 0.3, 0.6], [0, 6.7, 0], steel);
      } else if (asset.type === 'pharma-quality') {
        box(root, [11, 1, 9], [0, 0.6, 0], white);
        box(root, [8, 0.4, 3], [0, 2.5, 0], steel);
        for (const x of [-3, 0, 3]) {
          cylinder(root, 0.45, 2, [x, 3.7, 0], teal);
          box(root, [1.5, 1.2, 0.3], [x, 4.5, -0.6], blue);
        }
        box(root, [2.4, 1.6, 1.4], [-3.6, 4.1, 1.6], dark);
        cylinder(root, 0.3, 1.4, [-3.6, 5.2, 1.6], steel);
        box(root, [3.4, 2.1, 0.25], [3.1, 4.1, -2.7], accentMaterials[asset.type]);
      } else if (asset.type === 'pharma-packaging') {
        box(root, [12, 1, 4], [0, 1.7, 0], dark);
        box(root, [3, 5, 5], [0, 2.7, 0], teal);
        for (const x of [-4, 4]) box(root, [1.8, 1.3, 2], [x, 2.9, 0], carton);
        for (const x of [-4, 4]) box(root, [0.3, 3.4, 0.3], [x, 3.3, -2.7], steel);
        box(root, [8.6, 0.35, 0.35], [0, 5, -2.7], accentMaterials[asset.type]);
        for (const x of [-3.5, 0, 3.5]) box(root, [1.1, 1.1, 1.1], [x, 2.6, 0], carton);
      } else if (asset.type === 'pharma-truck') {
        box(root, [4.5, 4.2, 7], [0, 3.2, -1.5], white);
        box(root, [4.5, 3.2, 3], [0, 2.7, 3.5], accentMaterials['pharma-storage']);
        box(root, [3.4, 1.3, 0.16], [0, 3.5, 5.05], blue);
        box(root, [2.4, 0.9, 0.5], [0, 4.9, -5.1], steel);
        box(root, [2.5, 2.2, 0.35], [0, 2.3, -5.15], blue);
        for (const x of [-2.3, 2.3]) for (const z of [-3.5, 3.5]) {
          const wheel = cylinder(root, 0.9, 0.6, [x, 1, z], dark);
          wheel.rotation.z = Math.PI / 2;
          wheels.push(wheel);
        }
      } else {
        box(root, [11, 0.4, 9], [0, 0.3, 0], white);
        box(root, [11, 6, 0.4], [0, 3.5, -4.5], white);
        for (const x of [-5.3, 5.3]) box(root, [0.4, 6, 9], [x, 3.5, 0], white);
        box(root, [11.5, 0.5, 9.5], [0, 6.7, 0], asset.cold ? blue : accentMaterials[asset.type]);
        box(root, [6, 1.2, 0.25], [0, 5.2, 4.75], accentMaterials[asset.type]);
        if (asset.type === 'pharma-receiving') {
          box(root, [7, 0.55, 2.4], [0, 0.65, 5.4], steel);
          for (const x of [-3.2, 0, 3.2]) {
            cylinder(root, 0.8, 1.9, [x, 1.7, -1], carton);
            cylinder(root, 0.85, 0.2, [x, 2.75, -1], blue);
          }
          if (['pharma-production', 'pharma-quality', 'pharma-packaging'].includes(asset.type)) {
            for (const x of [-6.5, 6.5]) for (const z of [-5.8, 5.8]) {
              box(root, [0.35, 7.5, 0.35], [x, 3.75, z], steel);
            }
            for (const z of [-5.8, 5.8]) box(root, [13.3, 0.35, 0.35], [0, 7.5, z], accentMaterials[asset.type]);
          }
          for (const x of [-3.5, 3.5]) box(root, [2, 1.7, 2], [x, 1.5, 3.2], carton);
        } else if (asset.type === 'pharma-storage') {
          for (const x of [-3.5, 0, 3.5]) {
            for (const y of [2.1, 4.1]) box(root, [0.25, 0.2, 6.4], [x, y, -0.2], steel);
            for (const y of [2.8, 4.8]) box(root, [2.1, 1.1, 1.7], [x, y, -0.2], carton);
          }
          for (const x of [-2.3, 2.3]) {
            const fan = cylinder(root, 0.75, 0.25, [x, 4.9, -4.2], blue);
            fan.rotation.x = Math.PI / 2;
          }
        } else if (asset.type === 'pharma-distribution') {
          for (const x of [-3.5, 0, 3.5]) {
            box(root, [0.25, 4.4, 0.25], [x, 2.5, -1.5], steel);
            box(root, [2.7, 0.2, 0.3], [x, 1.8, -1.5], accentMaterials[asset.type]);
            box(root, [2.7, 0.2, 0.3], [x, 3.7, -1.5], accentMaterials[asset.type]);
            box(root, [1.8, 1.2, 1.5], [x, 2.7, -1.5], carton);
          }
          box(root, [7, 0.45, 2], [0, 0.55, 5.2], steel);
          for (const x of [-4.3, 4.3]) box(root, [0.35, 3.8, 0.35], [x, 2.1, 4.1], accentMaterials[asset.type]);
        } else if (asset.type === 'pharma-pharmacy') {
          box(root, [7, 0.85, 1.2], [0, 1, 4.7], accentMaterials[asset.type]);
          box(root, [5, 0.25, 1], [0, 2.3, 4.2], white);
          box(root, [3, 0.7, 0.4], [0, 5.1, 4.6], teal);
          box(root, [0.7, 3, 0.4], [0, 5.1, 4.6], teal);
          box(root, [8, 0.35, 2], [0, 6, 5.3], accentMaterials[asset.type]);
        }
      }
      const status = material(COLORS.online);
      const marker = cylinder(root, 0.55, 0.9, [5, 7.3, 0], status);
      const inventory = box(root, [8, 0.25, 0.7], [0, 0.6, 5], teal);
      const name = label(root, `${index + 1}. ${asset.name}`, [0, 8.5, 0], 'energy-zone-label');
      const reading = label(root, asset.id, [0, 7.2, 0], 'scenario-asset-label');
      const vehicleLabel = asset.type === 'pharma-truck'
        ? label(root, 'Carregando', [0, 6.1, 0], 'energy-zone-label') : null;
      batchStaticMeshes(root, new Set([marker, inventory, rotor, ...wheels]));
      root.traverse((node) => {
        if (node.isMesh) { node.userData.assetId = asset.id; hits.push(node); }
      });
      const motion = asset.type === 'pharma-truck'
        ? createTruckMotion(root.position.x, root.position.z, root.rotation.y) : null;
      rendered.push({ asset, root, marker, inventory, name, reading, rotor, wheels, vehicleLabel, motion });
    }
    batchStaticMeshes(scenery);

    const vehicles = rendered.filter(({ asset }) => asset.type === 'pharma-truck');
    const truckObstacles = () => cityTruckObstacles(vehicles.map(({ root }) => ({
      x: root.position.x, z: root.position.z, heading: root.rotation.y,
    })));
    const traffic = createCityTraffic(truckObstacles());
    const carColors = [0xe15f4d, 0x359ec4, 0xe9b84f, 0x7d70bc, 0x72ad71];
    const carWheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 10);
    const cityCars = traffic.map((car, index) => {
      const root = new THREE.Group();
      root.position.set(car.x, 0, car.z);
      root.rotation.y = car.heading;
      scene.add(root);
      const paint = material(carColors[index]);
      box(root, [3.2, 0.7, 1.5], [0, 0.8, 0], paint);
      box(root, [1.6, 0.7, 1.3], [-0.25, 1.45, 0], paint);
      box(root, [0.08, 0.45, 1.1], [0.58, 1.45, 0], blue);
      const wheels = [];
      for (const x of [-1, 1]) for (const z of [-0.82, 0.82]) {
        const wheel = new THREE.Mesh(carWheelGeometry, dark);
        wheel.position.set(x, 0.34, z);
        wheel.rotation.x = Math.PI / 2;
        wheel.castShadow = wheel.receiveShadow = true;
        root.add(wheel);
        wheels.push(wheel);
      }
      batchStaticMeshes(root, new Set(wheels));
      return { car, root, wheels };
    });

    let selected = null, raf = 0, disposed = false, lastInteraction = performance.now();
    const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
    const pick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(hits, false)[0]?.object.userData.assetId ?? null;
    };
    const hover = trackSceneHover(renderer.domElement, pick);
    const onClick = (event) => { const id = pick(event); if (id) onPick?.(id); };
    const interact = () => { lastInteraction = performance.now(); controls.autoRotate = false; };
    renderer.domElement.addEventListener('click', onClick);
    controls.addEventListener('start', interact);
    releases.push(() => {
      renderer.domElement.removeEventListener('click', onClick);
      hover.dispose();
      controls.removeEventListener('start', interact);
    });
    function resize() {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      const nextFit = fitDistance();
      camera.position.sub(controls.target).multiplyScalar(nextFit / fit).add(controls.target);
      fit = nextFit;
      camera.far = Math.max(500, fit * 3);
      controls.maxDistance = Math.max(400, fit * 1.3);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      labels.setSize(width, height);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    releases.push(() => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); });
    const clock = new THREE.Clock();
    function animate() {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      const now = performance.now();
      const hovered = hover.current();
      factoryLabel.visible = assets.some((asset) => asset.id === hovered && Object.hasOwn(PHARMA_LAYOUT.factory, asset.id.split('-')[1]));
      cityLabel.visible = assets.some((asset) => asset.id === hovered && asset.type === 'pharma-pharmacy');
      controls.autoRotate = !selected && now - lastInteraction > 20000;
      for (const item of rendered) {
        const { asset, root } = item;
        item.marker.material.color.set(COLORS[asset.status] ?? COLORS.offline);
        item.marker.scale.setScalar(selected === asset.id ? 1.5 : 1);
        item.inventory.visible = !asset.commLost;
        item.inventory.scale.x = Math.max(0.01, (asset.inventoryUnits || 0) / asset.capacityUnits);
        setText(item.reading.element, asset.commLost ? `${asset.id} · Sem telemetria` :
          `${asset.id} · ${asset.batchId || 'Sem lote'} · ${asset.inventoryUnits ?? '—'} un`);
        item.reading.element.dataset.status = asset.status;
        item.name.visible = hovered === asset.id;
        item.reading.visible = hovered === asset.id;
        if (item.rotor && asset.isRunning && !asset.commLost) item.rotor.rotation.y += dt * 2;
        if (asset.type === 'pharma-truck') {
          const pose = updateTruckMotion(item.motion, asset, now);
          root.position.set(pose.x, 0, pose.z);
          if (!asset.commLost) {
            const delta = Math.atan2(Math.sin(pose.heading - root.rotation.y), Math.cos(pose.heading - root.rotation.y));
            root.rotation.y += delta * (1 - Math.exp(-dt * 8));
            item.wheels.forEach((wheel) => wheel.rotateY(-pose.travelled / 0.9));
          }
          const state = asset.vehicleState;
          setText(item.vehicleLabel.element, asset.commLost ? 'Sem telemetria' : VEHICLE_STATE_LABELS[state] || 'Aguardando');
          item.vehicleLabel.visible = hovered === asset.id;
        }
      }
      stepCityTraffic(traffic, dt, truckObstacles());
      for (const { car, root, wheels } of cityCars) {
        root.position.set(car.x, 0, car.z);
        root.rotation.y = car.heading;
        wheels.forEach((wheel) => wheel.rotateY(-car.travelled / 0.34));
      }
      for (const { asset, label } of areaLabels) label.visible = hovered === asset.id;
      for (const dock of docks) {
        const vehicle = vehicles.find(({ asset }) => !asset.commLost
          && ['loading', 'unloading'].includes(asset.vehicleState)
          && Number.isFinite(asset.positionX) && Number.isFinite(asset.positionZ)
          && Math.hypot(asset.positionX - dock.x, asset.positionZ - dock.z) < 1);
        const active = !!vehicle && !dock.asset.commLost;
        dock.caption.visible = hovered === dock.asset.id;
        dock.accent.color.setHex(active ? 0x39b77a : 0x718891);
        dock.accent.emissive.setHex(active ? 0x1b8c55 : 0x1a292e);
        setText(dock.caption.element, dock.asset.commLost || vehicles.every(({ asset }) => asset.commLost)
          ? `${dock.asset.id} · SEM TELEMETRIA`
          : active ? `${dock.asset.id} · ${vehicle.asset.vehicleState === 'loading' ? 'CARREGANDO' : 'DESCARREGANDO'}`
            : `${dock.asset.id} · AGUARDANDO`);
      }
      controls.update();
      renderer.render(scene, camera);
      labels.render(scene, camera);
    }
    animate();
    return {
      select(id) { selected = id; if (id) interact(); },
      dispose: releaseAll,
    };
  } catch (error) {
    releaseAll();
    throw error;
  }
}
