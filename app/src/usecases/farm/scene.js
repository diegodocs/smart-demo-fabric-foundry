// Cena Smart Farm: campo, máquinas, rebanho e galpões com telemetria reativa.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { effectiveSpeed } from '../../domain/simulation.js';
import { loadVisualAssets } from '../shared/visualAssets.js';
import { trackSceneHover } from '../shared/sceneHover.js';
import { VEHICLE_ROUTES, routePose, hasVehicleClearance } from './layout.js';
import { createFarmWheels, rollFarmWheels } from './wheels.js';

const pace = (d) => (d.status === 'offline' ? 0 : effectiveSpeed(d) / 100);
const STATUS_COLOR = { online: 0x3fb950, alert: 0xd29922, offline: 0xf85149 };

export async function initFarmScene(container, ASSETS, { onPick } = {}) {
  const visuals = await loadVisualAssets({
    textures: {
      grass: { path: 'assets/energy/grass', repeat: [14, 14] },
      concrete: { path: 'assets/energy/concrete', repeat: [4, 4] },
      soil: { path: 'assets/farm/soil', repeat: [8, 8] },
    },
    models: {
      cow: { path: 'assets/farm/cow.glb', length: 0.52 },
      sheep: { path: 'assets/farm/sheep.glb', length: 0.42 },
    },
  });
  let scene;
  const extraTextures = [];
  const releases = [() => visuals.dispose(scene, extraTextures)];
  const releaseAll = () => { while (releases.length) releases.pop()(); };
  try {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc8e2ed);
  scene.fog = new THREE.Fog(0xc8e2ed, 75, 135);

  const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 160);
  const CAM_HOME = new THREE.Vector3(23, 21, 29);
  const CAM_INTRO = new THREE.Vector3(-26, 24, 36);
  camera.position.copy(CAM_INTRO);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  releases.unshift(() => { renderer.dispose(); renderer.domElement.remove(); });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  releases.push(() => pmrem.dispose());
  const room = new RoomEnvironment();
  releases.push(() => room.dispose());
  const environment = pmrem.fromScene(room, 0.04);
  releases.push(() => environment.dispose());
  scene.environment = environment.texture;

  const labelRenderer = new CSS2DRenderer();
  releases.push(() => labelRenderer.domElement.remove());
  labelRenderer.setSize(container.clientWidth, container.clientHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  releases.push(() => controls.dispose());
  controls.target.set(1, 0.6, 3);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.08;
  controls.minDistance = 6;
  controls.maxDistance = 52;
  controls.autoRotateSpeed = 0.28;
  controls.update();

  const composer = new EffectComposer(renderer);
  releases.push(() => { composer.passes.forEach((pass) => pass.dispose?.()); composer.dispose(); });
  composer.addPass(new RenderPass(scene, camera));
  const outlinePass = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene, camera);
  outlinePass.edgeStrength = 3;
  outlinePass.visibleEdgeColor.set(0x086a82);
  outlinePass.hiddenEdgeColor.set(0x3c8787);
  composer.addPass(outlinePass);
  composer.addPass(new OutputPass());

  const std = (color, roughness = 0.5, metalness = 0.5, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.7, ...extra });
  const glow = (color, intensity = 3) =>
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    extraTextures.push(t);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  function box(w, h, d, mat, r = 0) {
    const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
    return new THREE.Mesh(g, mat);
  }
  function cyl(rt, rb, h, mat, seg = 24) {
    return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  }
  function at(obj, x, y, z, parent) {
    obj.position.set(x, y, z);
    parent.add(obj);
    return obj;
  }
  function additive(color, map, opacity) {
    return new THREE.MeshBasicMaterial({
      color, map, transparent: true, opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
  }

  const MAT = {
    dark: std(0x1c2129, 0.5, 0.65),
    darker: std(0x0f1318, 0.6, 0.5),
    steel: std(0xc3ccd6, 0.2, 1),
    white: std(0xd9e1df, 0.45, 0.15),
    brand: std(0x178b78, 0.5, 0.3),
    rubber: std(0x0b0d10, 0.9, 0),
    yellow: std(0xf2b705, 0.38, 0.3),
    soil: std(0xc6b399, 0.96, 0, { ...visuals.textures.soil, normalScale: new THREE.Vector2(0.55, 0.55) }),
    wood: std(0x6d4c2e, 0.82, 0.04),
    woodDark: std(0x3e2a1c, 0.8, 0.05),
    crop: std(0x1e4d32, 0.85, 0.02),
    red: std(0x8d3a32, 0.55, 0.15),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9dcbd2, transparent: true, opacity: 0.62, roughness: 0.12, metalness: 0.05, depthWrite: false,
    }),
  };

  scene.add(new THREE.HemisphereLight(0xe4f3ff, 0x657145, 1.7));
  const key = new THREE.DirectionalLight(0xfff2d5, 2.8);
  key.position.set(-25, 35, 18);
  key.castShadow = true;
  releases.push(() => key.shadow.map?.dispose());
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 100;
  key.shadow.camera.left = key.shadow.camera.bottom = -27;
  key.shadow.camera.right = key.shadow.camera.top = 27;
  key.shadow.normalBias = 0.035;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd9edff, 0.4);
  rim.position.set(-14, 8, -10);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 64),
    std(0x87b878, 1, 0, { ...visuals.textures.grass, normalScale: new THREE.Vector2(0.5, 0.5) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(1, -0.02, 3);
  ground.receiveShadow = true;
  scene.add(ground);

  function road(x1, z1, x2, z2, w = 1.35) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const geometry = new THREE.PlaneGeometry(len, w);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 16, uv.getY(i) * w / 16);
    const mesh = new THREE.Mesh(geometry, MAT.soil);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x1 + x2) / 2, 0.01, (z1 + z2) / 2);
    mesh.rotation.z = -Math.atan2(z2 - z1, x2 - x1);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  function area(x, z, w, d, color, surface = 'grass') {
    const geometry = new THREE.PlaneGeometry(w, d);
    const uv = geometry.attributes.uv;
    const scale = surface === 'grass' ? 64 : surface === 'soil' ? 16 : 8;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / scale, uv.getY(i) * d / scale);
    const pad = new THREE.Mesh(geometry,
      std(color, 0.95, 0, { ...visuals.textures[surface], normalScale: new THREE.Vector2(0.5, 0.5) }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.005, z);
    pad.receiveShadow = true;
    scene.add(pad);
    const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x - w / 2, 0.035, z - d / 2),
      new THREE.Vector3(x + w / 2, 0.035, z - d / 2),
      new THREE.Vector3(x + w / 2, 0.035, z + d / 2),
      new THREE.Vector3(x - w / 2, 0.035, z + d / 2),
    ]), new THREE.LineBasicMaterial({ color: 0x7d9778 }));
    scene.add(border);
  }
  function areaSign(text, x, z, width = 4) {
    const tex = canvasTex(768, 96, (ctx, w, h) => {
      ctx.fillStyle = '#10251e'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#4d987e'; ctx.lineWidth = 5; ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = '#d5efdc'; ctx.font = '600 30px Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2, w - 32);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 8),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
    at(sign, x, 0.85, z, scene);
    at(box(0.06, 0.85, 0.06, MAT.wood), x - width * 0.4, 0.425, z, scene);
    at(box(0.06, 0.85, 0.06, MAT.wood), x + width * 0.4, 0.425, z, scene);
  }
  function routeRoad(route, width) {
    const vertices = [];
    const uvs = [];
    const sides = [[], []];
    for (let i = 0; i <= 192; i++) {
      const pose = routePose(route, route.length * i / 192);
      [-1, 1].forEach((side, j) => {
        sides[j].push(new THREE.Vector3(
          pose.x + Math.sin(pose.heading) * width * side / 2, 0.025,
          pose.z + Math.cos(pose.heading) * width * side / 2));
      });
      if (!i) continue;
      const [a, b, c, d] = [sides[0][i - 1], sides[1][i - 1], sides[0][i], sides[1][i]];
      for (const point of [a, c, b, b, c, d]) {
        vertices.push(point.x, point.y, point.z);
        uvs.push(point.x / 16, point.z / 16);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    const lane = new THREE.Mesh(geometry, std(0xc6b399, 0.95, 0, {
      ...visuals.textures.soil, normalScale: new THREE.Vector2(0.55, 0.55), side: THREE.DoubleSide,
    }));
    lane.receiveShadow = true;
    scene.add(lane);
    sides.forEach((points) => scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xb4a36a }))));
  }

  area(-8, -6, 10, 8, 0xc3aa82, 'soil');
  area(-8, 0.75, 10, 5.4, 0x8db879);
  area(-1, -6, 3, 5, 0xd0cec3, 'concrete');
  area(4, -6, 4, 7, 0xd3b989, 'soil');
  area(9.75, 2.1, 15.5, 5.2, 0xc3c3b9, 'concrete');
  area(-6.5, 9, 12, 9, 0x99c085);
  area(8.7, 8, 10, 5, 0xcac8ba, 'concrete');
  area(8.5, 12, 11, 3.4, 0xcac8ba, 'concrete');
  const irrigation = new THREE.Mesh(new THREE.CircleGeometry(4.8, 64),
    std(0x8bbd7b, 0.95, 0, { ...visuals.textures.grass }));
  irrigation.rotation.x = -Math.PI / 2;
  at(irrigation, 11, 0.012, -6, scene);
  for (let row = 0; row < 7; row++) {
    road(-9.8, -7.5 + row * 0.5, -6.2, -7.5 + row * 0.5, 0.12);
    road(2.6, -8.7 + row * 0.8, 5.4, -8.7 + row * 0.8, 0.13);
  }
  routeRoad(VEHICLE_ROUTES['TRT-001'], 1.7);
  routeRoad(VEHICLE_ROUTES['PUL-001'], 2.8);
  routeRoad(VEHICLE_ROUTES['CAM-001'], 1.8);
  for (let distance = 1; distance < VEHICLE_ROUTES['CAM-001'].length; distance += 5) {
    const pose = routePose(VEHICLE_ROUTES['CAM-001'], distance);
    const arrow = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.2, 0, -0.18),
      new THREE.Vector3(0.2, 0, 0),
      new THREE.Vector3(-0.2, 0, 0.18),
    ]), new THREE.LineBasicMaterial({ color: 0xe7d59a }));
    arrow.rotation.y = pose.heading;
    at(arrow, pose.x, 0.04, pose.z, scene);
  }
  road(17.2, 2, 17.2, 14.5, 1.2);
  road(3.2, 10, 17.2, 10, 1.2);
  for (const x of [-2, 0]) road(x, -8, x, -4, 0.05);
  areaSign('01 · TALHAO / TRATORES', -8, -10.2, 5);
  areaSign('02 · PULVERIZACAO', -8, -2.05, 4.5);
  areaSign('GARAGEM / MANUTENCAO', -1, -9, 3.4);
  areaSign('03 · COLHEITA', 4, -10.2, 3.5);
  areaSign('04 · IRRIGACAO', 11, -11.2, 4);
  areaSign('LOGISTICA · MAO UNICA', 10, -0.5, 4.5);
  areaSign('PASTAGENS / REBANHOS', -6.5, 4.5, 5);
  areaSign('ARMAZENAGEM / CARGA', 9, 9.7, 4.5);
  areaSign('SUINOCULTURA', 8.5, 14, 4);
  function fence(x1, z1, x2, z2) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const section = new THREE.Group();
    const posts = Math.ceil(length / 1.5);
    for (let i = 0; i <= posts; i++) {
      at(box(0.07, 0.65, 0.07, MAT.wood), length * i / posts, 0.325, 0, section);
    }
    for (const height of [0.25, 0.5]) {
      at(box(length, 0.045, 0.045, MAT.wood), length / 2, height, 0, section);
    }
    section.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    at(section, x1, 0, z1, scene);
  }
  fence(-12.5, 4.5, -12.5, 13.5);
  fence(-12.5, 13.5, -0.5, 13.5);
  fence(-0.5, 13.5, -0.5, 4.5);
  fence(-12.5, 4.5, -8, 4.5);
  fence(-5, 4.5, -0.5, 4.5);

  function pole(x, z) {
    at(box(0.08, 4.2, 0.08, MAT.darker), x, 2.1, z, scene);
    at(box(0.7, 0.06, 0.16, glow(0xe4efff, 2.4)), x, 4.15, z, scene);
    const spot = new THREE.SpotLight(0xdfeaff, 2, 14, 0.7, 0.6, 1.2);
    spot.position.set(x, 4.1, z);
    spot.target.position.set(x, 0, z);
    scene.add(spot, spot.target);
  }
  [[-13, -9], [17, -10], [-13, 13], [17.2, 14]].forEach(([x, z]) => pole(x, z));

  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.2, 1.5, 8);
  const crownGeometry = new THREE.IcosahedronGeometry(0.85, 1);
  const foliage = [std(0x4f823e, 0.95, 0), std(0x659849, 0.95, 0), std(0x3f7538, 0.95, 0)];
  function tree(x, z, s = 1, index = 0) {
    const g = new THREE.Group();
    at(new THREE.Mesh(trunkGeometry, MAT.woodDark), 0, 0.75, 0, g);
    at(new THREE.Mesh(crownGeometry, foliage[index % foliage.length]), 0, 1.85, 0, g);
    at(new THREE.Mesh(crownGeometry, foliage[(index + 1) % foliage.length]), -0.5, 1.6, 0.1, g).scale.setScalar(0.72);
    at(new THREE.Mesh(crownGeometry, foliage[(index + 2) % foliage.length]), 0.48, 1.65, -0.1, g).scale.setScalar(0.75);
    g.scale.setScalar(s);
    g.traverse((node) => { if (node.isMesh) node.castShadow = true; });
    g.position.set(x, 0, z);
    scene.add(g);
  }
  [[-15, -12], [-15, -7], [-15, -1], [-15, 5], [-15, 11], [-14, 16],
    [-9, -13], [-4, -13], [1, -13], [6, -13], [12, -14], [18, -13],
    [20, -7], [20, -1], [20, 5], [20, 11], [19, 16]]
    .forEach(([x, z], i) => tree(x, z, 0.8 + (i % 3) * 0.18, i));

  const signTex = canvasTex(2048, 200, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = '600 84px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const grad = ctx.createLinearGradient(w * 0.15, 0, w * 0.85, 0);
    grad.addColorStop(0, '#2dd4bf');
    grad.addColorStop(1, '#a78bfa');
    ctx.fillStyle = grad;
    ctx.fillText('SMART FARM  ·  MONITORAMENTO IoT  ·  TALHÃO NORTE', w / 2, h / 2);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.05), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false }));
  sign.position.set(1, 5.3, -12);
  scene.add(sign);

  const DUST_N = 420;
  const dustPos = new Float32Array(DUST_N * 3);
  const dustSpeed = new Float32Array(DUST_N);
  for (let i = 0; i < DUST_N; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 28;
    dustPos[i * 3 + 1] = Math.random() * 4;
    dustPos[i * 3 + 2] = -8 + Math.random() * 24;
    dustSpeed[i] = 0.015 + Math.random() * 0.05;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const radial = canvasTex(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#000000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xc6f6d5, size: 0.04, map: radial, transparent: true, opacity: 0.35,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })));

  const stackLights = [];
  function addStackLight(parent, data, x, y, z) {
    const g = new THREE.Group();
    at(cyl(0.02, 0.02, 0.16, MAT.steel, 8), 0, 0.08, 0, g);
    const mats = [0x3fb950, 0xd29922, 0xf85149].map((c, i) => {
      const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, roughness: 0.25, metalness: 0.1 });
      at(cyl(0.045, 0.045, 0.07, m, 16), 0, 0.2 + i * 0.08, 0, g);
      return { m, c };
    });
    stackLights.push({ mats, data, phase: Math.random() * 6 });
    g.position.set(x, y, z);
    parent.add(g);
  }

  const screens = [];
  function createScreen(data, w = 0.28, h = 0.16) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 160;
    const tex = new THREE.CanvasTexture(canvas);
    extraTextures.push(tex);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const s = { ctx: canvas.getContext('2d'), tex, data, hist: Array.from({ length: 28 }, () => 50) };
    drawScreen(s);
    screens.push(s);
    return mesh;
  }
  function drawScreen(s) {
    const { ctx, data } = s;
    const W = 256, H = 160;
    const col = data.status === 'online' ? '#3fb950' : data.status === 'alert' ? '#d29922' : '#f85149';
    ctx.fillStyle = '#04101d'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = col; ctx.fillRect(0, 0, W, 26);
    ctx.fillStyle = '#04101d'; ctx.font = 'bold 16px Segoe UI, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(data.id, 8, 18);
    if (data.status === 'offline') {
      ctx.fillStyle = '#f85149'; ctx.font = 'bold 26px Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('SEM SINAL', W / 2, 96);
      s.tex.needsUpdate = true;
      return;
    }
    const metrics = data.metrics || [];
    metrics.slice(0, 3).forEach((metric, i) => {
      const x = 10 + i * 82;
      ctx.fillStyle = '#7d8a99'; ctx.font = '12px Segoe UI, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(metric.label.slice(0, 8).toUpperCase(), x, 48);
      ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 18px Segoe UI, sans-serif';
      const v = data[metric.key];
      ctx.fillText(Number.isFinite(v) ? `${v.toFixed(metric.digits || 0)}` : '—', x, 72);
    });
    s.tex.needsUpdate = true;
  }

  function buildTractor(data) {
    const g = new THREE.Group();
    const wheels = createFarmWheels([
      { x: -0.45, radius: 0.48, width: 0.22 },
      { x: 0.48, radius: 0.3, width: 0.18 },
    ], 0.98, { rubber: MAT.rubber, hub: MAT.steel });
    g.add(...wheels);
    at(box(1.15, 0.42, 0.72, MAT.yellow, 0.04), 0.05, 0.62, 0, g);
    at(box(0.46, 0.18, 0.62, MAT.brand, 0.04), -0.28, 0.84, 0, g);
    at(box(0.4, 0.32, 0.54, MAT.glass, 0.03), -0.28, 1.08, 0, g);
    at(box(0.49, 0.06, 0.64, MAT.dark, 0.02), -0.28, 1.27, 0, g);
    for (const x of [-0.46, -0.1]) for (const z of [-0.28, 0.28]) {
      at(box(0.035, 0.34, 0.035, MAT.dark), x, 1.08, z, g);
    }
    at(cyl(0.035, 0.045, 0.45, MAT.dark, 12), 0.34, 1.05, -0.22, g);
    for (const z of [-0.24, 0.24]) at(box(0.035, 0.08, 0.14, MAT.white), 0.64, 0.69, z, g);
    for (let i = 0; i < 4; i++) at(box(0.025, 0.025, 0.32, MAT.dark), 0.64, 0.43 + i * 0.045, 0, g);
    at(box(0.16, 0.08, 0.5, MAT.darker), 0.55, 0.55, 0, g);
    at(createScreen(data, 0.22, 0.12), -0.28, 1.02, 0.29, g);
    addStackLight(g, data, -0.28, 1.29, -0.25);
    return { model: g, update(_t, _dt, distance = 0) { rollFarmWheels(wheels, distance); } };
  }

  function buildHarvester(data) {
    const g = new THREE.Group();
    const wheels = createFarmWheels([
      { x: -0.48, radius: 0.38, width: 0.22 },
      { x: 0.55, radius: 0.3, width: 0.18 },
    ], 1.15, { rubber: MAT.rubber, hub: MAT.steel });
    g.add(...wheels);
    const reel = new THREE.Group();
    reel.position.set(-0.95, 0.72, 0);
    g.add(reel);
    at(cyl(0.08, 0.08, 1.35, MAT.steel, 16), 0, 0, 0, reel).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      at(box(0.055, 0.055, 1.38, MAT.dark), Math.cos(angle) * 0.28, Math.sin(angle) * 0.28, 0, reel);
    }
    at(box(1.5, 0.7, 1.15, MAT.yellow, 0.05), 0.15, 0.85, 0, g);
    at(box(0.55, 0.4, 0.7, MAT.brand, 0.04), 0.55, 1.25, 0, g);
    at(box(0.45, 0.24, 0.71, MAT.glass, 0.02), 0.55, 1.29, 0, g);
    at(box(0.62, 0.06, 0.78, MAT.dark, 0.02), 0.55, 1.48, 0, g);
    at(box(0.7, 0.16, 1.4, MAT.dark), -0.85, 0.42, 0, g);
    at(createScreen(data, 0.22, 0.12), 0.55, 1.28, 0.38, g);
    addStackLight(g, data, 0.7, 1.45, -0.3);
    return {
      model: g,
      update(_t, dt, distance = 0) {
        reel.rotation.z += dt * 4 * pace(data);
        rollFarmWheels(wheels, distance);
      },
    };
  }

  function buildSprayer(data) {
    const g = new THREE.Group();
    const wheels = createFarmWheels([
      { x: -0.45, radius: 0.29, width: 0.16 },
      { x: 0.45, radius: 0.29, width: 0.16 },
    ], 0.94, { rubber: MAT.rubber, hub: MAT.steel });
    g.add(...wheels);
    at(box(1.3, 0.28, 0.7, MAT.dark, 0.03), 0, 0.45, 0, g);
    at(cyl(0.32, 0.32, 0.85, MAT.white, 24), -0.15, 0.85, 0, g).rotation.z = Math.PI / 2;
    const boom = at(box(0.08, 0.06, 2.4, MAT.brand), 0.35, 0.78, 0, g);
    at(box(0.4, 0.32, 0.55, MAT.yellow, 0.03), 0.55, 0.72, 0, g);
    at(box(0.31, 0.2, 0.48, MAT.glass, 0.02), 0.55, 0.98, 0, g);
    at(box(0.39, 0.045, 0.55, MAT.dark), 0.55, 1.1, 0, g);
    for (let z = -0.9; z <= 0.9; z += 0.3) at(box(0.04, 0.12, 0.025, MAT.dark), 0.35, 0.69, z, g);
    addStackLight(g, data, 0.7, 1.05, 0);
    return {
      model: g,
      update(t, _dt, distance = 0) {
        boom.rotation.x = Math.sin(t * 0.6) * 0.03 * pace(data);
        rollFarmWheels(wheels, distance);
      },
    };
  }

  function buildPivot(data) {
    const g = new THREE.Group();
    at(cyl(0.18, 0.22, 0.4, MAT.dark, 16), 0, 0.2, 0, g);
    const arm = new THREE.Group();
    g.add(arm);
    at(box(4.6, 0.08, 0.12, MAT.steel), 2.1, 1.35, 0, arm);
    at(box(0.08, 1.3, 0.08, MAT.darker), 0.3, 0.7, 0, arm);
    at(box(0.08, 1.15, 0.08, MAT.darker), 3.8, 0.6, 0, arm);
    for (let i = 0; i < 6; i++) at(cyl(0.02, 0.04, 0.16, glow(0x7dd3fc, 1.2), 8), 0.6 + i * 0.6, 1.22, 0, arm);
    addStackLight(g, data, 0, 1.7, 0);
    return { model: g, update(_t, dt) { arm.rotation.y += dt * 0.35 * pace(data); } };
  }

  function buildTruck(data) {
    const g = new THREE.Group();
    const wheels = createFarmWheels([
      { x: -0.55, radius: 0.28, width: 0.16 },
      { x: 0.35, radius: 0.28, width: 0.16 },
      { x: 1.05, radius: 0.28, width: 0.16 },
    ], 1.04, { rubber: MAT.rubber, hub: MAT.steel });
    g.add(...wheels);
    at(box(1.7, 0.55, 0.9, MAT.white, 0.04), 0.15, 0.85, 0, g);
    at(box(0.55, 0.48, 0.84, MAT.brand, 0.04), 1.05, 0.95, 0, g);
    at(box(0.44, 0.22, 0.8, MAT.glass, 0.02), 1.05, 1.12, 0, g);
    at(box(0.59, 0.06, 0.88, MAT.dark, 0.02), 1.05, 1.22, 0, g);
    for (const z of [-0.46, 0.46]) {
      for (let x = -0.55; x <= 0.75; x += 0.32) at(box(0.025, 0.48, 0.025, MAT.dark), x, 0.86, z, g);
    }
    at(createScreen(data, 0.2, 0.1), 1.05, 1.05, 0.44, g);
    addStackLight(g, data, 1.2, 1.35, -0.35);
    return { model: g, update(_t, _dt, distance = 0) { rollFarmWheels(wheels, distance); } };
  }

  function buildHerd(data) {
    const g = new THREE.Group();
    const bodies = [];
    const n = data.type === 'sheep' ? 7 : 5;
    const coatColor = { 'BOV-001': 0xd9d3c4, 'BOV-002': 0x573b2b, 'BOV-003': 0xb98962 }[data.id];
    const coat = coatColor ? std(coatColor, 0.86, 0) : null;
    for (let i = 0; i < n; i++) {
      const b = new THREE.Group();
      const ang = (i / n) * Math.PI * 2;
      b.position.set(Math.cos(ang) * 0.55, 0, Math.sin(ang) * 0.4);
      const animal = visuals.models[data.type === 'sheep' ? 'sheep' : 'cow'].clone(true);
      if (coat) {
        animal.traverse((node) => {
          if (!node.isMesh) return;
          const replace = (material) => ['Animal coat', 'Dairy coat markings'].includes(material.name) ? coat : material;
          node.material = Array.isArray(node.material) ? node.material.map(replace) : replace(node.material);
        });
      }
      if (data.id === 'BOV-003') animal.scale.multiplyScalar(0.8);
      animal.rotation.y = ang + Math.PI / 2;
      b.add(animal);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12), glow(0x2dd4bf, 2.2));
      collar.rotation.y = Math.PI / 2;
      at(collar, 0.2, 0.34, 0, b);
      g.add(b);
      bodies.push(b);
    }
    const fence = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.22, 48), new THREE.MeshBasicMaterial({
      color: 0x2dd4bf, transparent: true, opacity: 0.55, side: THREE.DoubleSide, toneMapped: false,
    }));
    fence.rotation.x = -Math.PI / 2;
    fence.position.y = 0.02;
    g.add(fence);
    addStackLight(g, data, 0, 0.02, -1.05);
    return {
      model: g,
      update(t) {
        bodies.forEach((b, i) => { b.position.y = Math.sin(t * 2 + i) * 0.02 * pace(data); });
      },
    };
  }

  function buildBarn(data) {
    const g = new THREE.Group();
    at(box(2.2, 1.35, 1.5, MAT.red, 0.02), 0, 0.7, 0, g);
    at(box(2.4, 0.12, 1.7, MAT.woodDark), 0, 1.42, 0, g);
    const roof = box(2.15, 0.08, 1.55, MAT.woodDark);
    roof.rotation.z = 0.45;
    at(roof, -0.35, 1.85, 0, g);
    const roof2 = box(2.15, 0.08, 1.55, MAT.woodDark);
    roof2.rotation.z = -0.45;
    at(roof2, 0.35, 1.85, 0, g);
    at(box(0.46, 0.7, 0.06, MAT.wood), 0, 0.4, 0.76, g);
    at(createScreen(data), 0.7, 1.05, 0.78, g);
    addStackLight(g, data, 0.9, 1.5, -0.6);
    return { model: g, update() {} };
  }

  function buildSilo(data) {
    const g = new THREE.Group();
    at(cyl(0.55, 0.55, 2.1, MAT.white, 24), 0, 1.05, 0, g);
    at(cyl(0.58, 0.5, 0.45, MAT.brand, 24), 0, 2.15, 0, g);
    at(new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.45, 20), MAT.steel), 0, 2.5, 0, g);
    at(box(0.08, 0.9, 0.08, MAT.dark), 0.7, 0.45, 0, g);
    at(createScreen(data, 0.24, 0.14), 0.7, 0.7, 0.02, g);
    addStackLight(g, data, 0.7, 0.95, 0);
    return { model: g, update() {} };
  }

  function buildPiggery(data) {
    const g = new THREE.Group();
    at(box(2.4, 0.9, 1.15, MAT.white, 0.03), 0, 0.48, 0, g);
    at(box(2.5, 0.08, 1.3, MAT.brand), 0, 0.98, 0, g);
    const fans = [];
    [-0.7, 0.7].forEach((x) => {
      const fan = cyl(0.16, 0.16, 0.05, MAT.dark, 16);
      fan.rotation.x = Math.PI / 2;
      at(fan, x, 0.62, 0.58, g);
      fans.push(fan);
    });
    at(createScreen(data), 0, 0.62, 0.6, g);
    addStackLight(g, data, 1.05, 1.05, -0.4);
    return { model: g, update(_t, dt) { fans.forEach((f) => { f.rotation.z += dt * 6 * pace(data); }); } };
  }

  const builders = {
    tractor: buildTractor, harvester: buildHarvester, sprayer: buildSprayer, pivot: buildPivot, truck: buildTruck,
    cattle: buildHerd, sheep: buildHerd, barn: buildBarn, silo: buildSilo, piggery: buildPiggery,
  };

  const paths = {
    'BOV-001': { t: 0, speed: 0.00055, points: [[-8, 0, 6], [-7.2, 0, 6.5], [-8.5, 0, 6.8], [-8.7, 0, 6.1], [-8, 0, 6]] },
    'BOV-002': { t: 0.2, speed: 0.0005, points: [[-4, 0, 8], [-3.4, 0, 8.4], [-4.4, 0, 8.7], [-4.6, 0, 8.1], [-4, 0, 8]] },
    'BOV-003': { t: 0.5, speed: 0.0006, points: [[-9, 0, 10], [-8.4, 0, 10.4], [-9.3, 0, 10.6], [-9.5, 0, 10.1], [-9, 0, 10]] },
    'OVI-001': { t: 0.7, speed: 0.00065, points: [[-3, 0, 11], [-2.3, 0, 11.4], [-3.4, 0, 11.7], [-3.6, 0, 11.1], [-3, 0, 11]] },
  };

  function writeLocation(data, x, z) {
    const lat = -21.1772 + z * 0.00009;
    const lon = -47.8094 + x * 0.00009;
    data.location = `${Math.abs(lat).toFixed(5)}°S, ${Math.abs(lon).toFixed(5)}°W`;
    data.lat = lat;
    data.lon = lon;
  }

  const machines = [];
  ASSETS.forEach((data) => {
    const root = new THREE.Group();
    root.position.set(data.pos[0], 0, data.pos[2]);
    scene.add(root);
    const built = (builders[data.type] || buildTractor)(data);
    built.model.traverse((o) => {
      if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = !o.material.transparent; }
    });
    root.add(built.model);
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(built.model);
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3()).sub(root.position);
    const r = Math.min(1.5, Math.max(size.x, size.z) * 0.45 + 0.15);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.045, 64), new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.75, side: THREE.DoubleSide, toneMapped: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    at(ring, 0, 0.03, 0, root);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(r * 3, r * 3), additive(0xffffff, radial, 0.22));
    halo.rotation.x = -Math.PI / 2;
    at(halo, 0, 0.02, 0, root);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, 3.6, 32, 1, true), additive(0xffffff, null, 0.2));
    at(beam, 0, 1.8, 0, root);
    const div = document.createElement('div');
    const dot = document.createElement('span');
    div.className = 'scenario-asset-label';
    dot.className = 'scenario-asset-dot';
    div.append(dot, document.createTextNode(data.name));
    const label = new CSS2DObject(div);
    label.visible = false;
    label.userData.dot = dot;
    at(label, 0, bbox.max.y + 0.35, 0, root);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.8, size.x + 0.3), size.y + 0.2, Math.max(0.8, size.z + 0.3)),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.userData.machineId = data.id;
    at(hit, center.x, center.y, center.z, root);
    const radius = data.type === 'pivot' ? 4.5 : Math.hypot(
      Math.max(Math.abs(bbox.min.x - root.position.x), Math.abs(bbox.max.x - root.position.x)),
      Math.max(Math.abs(bbox.min.z - root.position.z), Math.abs(bbox.max.z - root.position.z)));
    const route = VEHICLE_ROUTES[data.id];
    if (route) root.rotation.y = routePose(route, 0).heading;
    machines.push({ data, root, radius, distance: 0, model: built.model, update: built.update, ring, halo, beam, hit, label, shownStatus: null });
    writeLocation(data, data.pos[0], data.pos[2]);
  });

  function syncStatus(m) {
    if (m.shownStatus === m.data.status) return;
    m.shownStatus = m.data.status;
    const color = new THREE.Color(STATUS_COLOR[m.data.status]);
    m.ring.material.color.copy(color);
    m.halo.material.color.copy(color);
    m.beam.material.color.copy(color);
    m.beam.visible = m.data.status !== 'online';
    const hex = `#${STATUS_COLOR[m.data.status].toString(16).padStart(6, '0')}`;
    m.label.userData.dot.style.background = hex;
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hits = machines.map((m) => m.hit);
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const found = raycaster.intersectObjects(hits);
    return found.length ? found[0].object.userData.machineId : null;
  }
  const onClick = (event) => { const id = pick(event); if (id && onPick) onPick(id); };
  const hover = trackSceneHover(renderer.domElement, pick);
  renderer.domElement.addEventListener('click', onClick);
  releases.push(() => {
    renderer.domElement.removeEventListener('click', onClick);
    hover.dispose();
  });

  let selectedId = null;
  function select(id) {
    selectedId = id;
    const m = machines.find((x) => x.data.id === id);
    outlinePass.selectedObjects = m ? [m.model] : [];
    if (m) { lastInteraction = performance.now(); controls.autoRotate = false; }
  }

  const screenTimer = setInterval(() => screens.forEach(drawScreen), 1000);
  releases.push(() => clearInterval(screenTimer));
  const clock = new THREE.Clock();
  let introDone = false;
  let lastInteraction = performance.now();
  let rafId = 0;
  let disposed = false;
  controls.enabled = false;
  const onControlStart = () => { lastInteraction = performance.now(); controls.autoRotate = false; };
  controls.addEventListener('start', onControlStart);
  const onDown = () => {
    lastInteraction = performance.now();
    controls.autoRotate = false;
    if (!introDone) { introDone = true; controls.enabled = true; }
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  releases.push(() => {
    controls.removeEventListener('start', onControlStart);
    renderer.domElement.removeEventListener('pointerdown', onDown);
  });

  function animate() {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!introDone) {
      const k = Math.min(1, t / 3.6);
      camera.position.lerpVectors(CAM_INTRO, CAM_HOME, 1 - Math.pow(1 - k, 3));
      if (k >= 1) { introDone = true; controls.enabled = true; }
    } else if (!selectedId && performance.now() - lastInteraction > 20000) {
      controls.autoRotate = true;
    }
    const hoveredId = hover.current();
    machines.forEach((m) => {
      syncStatus(m);
      const path = paths[m.data.id];
      const k = pace(m.data);
      let travelled = 0;
      const route = VEHICLE_ROUTES[m.data.id];
      if (route && m.data.moving && k > 0) {
        const distance = route.speed * k * dt;
        const next = routePose(route, m.distance + distance);
        const obstacles = machines.filter((other) => other !== m).map((other) => ({
          x: other.root.position.x, z: other.root.position.z, radius: other.radius,
        }));
        if (hasVehicleClearance(next, m.radius, obstacles)) {
          m.distance += distance;
          m.root.position.set(next.x, 0, next.z);
          m.root.rotation.y = next.heading;
          writeLocation(m.data, next.x, next.z);
          travelled = distance;
        }
      } else if (m.data.moving && path && k > 0) {
        path.t = (path.t + path.speed * k * dt * 60) % 1;
        const n = path.points.length - 1;
        const i0 = Math.min(Math.floor(path.t * n), n - 1);
        const frac = path.t * n - i0;
        const p0 = path.points[i0], p1 = path.points[i0 + 1];
        const x = p0[0] + (p1[0] - p0[0]) * frac;
        const z = p0[2] + (p1[2] - p0[2]) * frac;
        const dx = x - m.root.position.x, dz = z - m.root.position.z;
        if (Math.hypot(dx, dz) > 1e-5) {
          let diff = Math.atan2(-dz, dx) - m.root.rotation.y;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          m.root.rotation.y += diff * Math.min(1, dt * 6);
        }
        m.root.position.x = x;
        m.root.position.z = z;
        writeLocation(m.data, x, z);
      }
      m.update(t, dt, travelled);
      m.label.visible = hoveredId === m.data.id;
      const pulse = 0.5 + 0.5 * Math.sin(t * (m.data.status === 'alert' ? 3.2 : 1.6) + m.root.position.x);
      m.ring.scale.setScalar(1 + pulse * 0.05);
      m.halo.material.opacity = 0.04 + pulse * 0.06;
      if (m.beam.visible) m.beam.material.opacity = 0.04 + pulse * 0.05;
    });
    stackLights.forEach((s) => {
      const st = s.data.status;
      const idx = st === 'online' ? 0 : st === 'alert' ? 1 : 2;
      s.mats.forEach(({ m, c }, i) => {
        const active = i === idx;
        m.color.setHex(c).multiplyScalar(active ? 0.6 : 0.18);
        m.emissiveIntensity = active ? (st === 'alert' ? (Math.sin(t * 6 + s.phase) > 0 ? 5 : 0.25) : 3.2) : 0.05;
      });
    });
    for (let i = 0; i < DUST_N; i++) {
      dustPos[i * 3 + 1] += dustSpeed[i] * dt;
      if (dustPos[i * 3 + 1] > 4.5) dustPos[i * 3 + 1] = 0;
    }
    dustGeo.attributes.position.needsUpdate = true;
    controls.update();
    composer.render();
    labelRenderer.render(scene, camera);
  }
  releases.push(() => { disposed = true; cancelAnimationFrame(rafId); });
  animate();

  function onResize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
  }
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(container);
  window.addEventListener('resize', onResize);
  releases.push(() => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', onResize);
  });
  window.__farm = { camera, controls, scene, renderer };
  releases.push(() => { if (window.__farm?.scene === scene) delete window.__farm; });
  return { select, dispose: releaseAll };
  } catch (error) {
    releaseAll();
    throw error;
  }
}
