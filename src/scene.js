import * as THREE from 'three';

// Ofis sahnesi: ajanlar oturumdaki olaylara göre belirir, kaybolur ve duruma göre hareket eder.
// Asıl ofis (masalar, toplantı odası) Faz 2'de gelecek; şimdilik keçe bir halı üstünde duruyorlar.

const FELT = 0xef7a3c;
const C = { gold: 0xf2c14e, red: 0xe2574c, fedora: 0x8b6a4e, band: 0x4b3426, dark: 0x3a302a, cream: 0xf6efe3, metal: 0xb5aca2, eye: 0x2a1a12 };

// Ana ajan önde ortada; alt ajanlar sırayla bu yerlere oturur.
const MAIN_SPOT = [0, 0.55];
const SUB_SPOTS = [[-1.25, -0.35], [1.25, -0.35], [-0.45, -0.85], [0.6, -0.9], [-1.75, 0.55], [1.75, 0.6], [-1.0, -1.05], [1.45, -1.1]];

function roundBox(w, h, d, r, seg = 10) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  const clamp = (a, m) => Math.max(-m, Math.min(m, a));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(clamp(v.x, hw), clamp(v.y, hh), clamp(v.z, hd));
    dir.copy(v).sub(inner).normalize();
    v.copy(inner).addScaledVector(dir, r);
    p.setXYZ(i, v.x, v.y, v.z);
    n.setXYZ(i, dir.x, dir.y, dir.z);
  }
  p.needsUpdate = true;
  return g;
}

function feltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 222 + Math.random() * 33;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.5, 2.5);
  return t;
}

const feltTex = feltTexture();
const feltMat = new THREE.MeshStandardMaterial({ color: FELT, map: feltTex, bumpMap: feltTex, bumpScale: 0.012, roughness: 1 });
const matCache = new Map();
const mat = (color) => {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  return matCache.get(color);
};
const geoCache = new Map();
const rb = (w, h, d, r, seg) => {
  const key = [w, h, d, r, seg].join();
  if (!geoCache.has(key)) geoCache.set(key, roundBox(w, h, d, r, seg));
  return geoCache.get(key);
};

function mesh(parent, geo, material, x, y, z) {
  const o = new THREE.Mesh(geo, material);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}

/** Ajan tipine göre aksesuar listesi. */
export function accessoriesFor(type) {
  if (type === 'main') return ['crown', 'mug'];
  if (type === 'Explore') return ['fedora', 'magnifier'];
  if (type === 'Plan') return ['notepad'];
  if (type === 'general-purpose') return ['fedora', 'headset'];
  const pool = [['glasses'], ['badge', 'fedora'], ['headset'], ['glasses', 'notepad']];
  let h = 0;
  for (const ch of String(type)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

function addAccessory(body, armL, armR, kind) {
  const T = 0.78;
  if (kind === 'crown') {
    const g = new THREE.Group(); g.position.set(0.08, T, 0); g.rotation.z = -0.18; body.add(g);
    mesh(g, new THREE.CylinderGeometry(0.15, 0.17, 0.11, 6), mat(C.gold), 0, 0.055, 0);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mesh(g, new THREE.SphereGeometry(0.035, 8, 6), mat(C.gold), Math.cos(a) * 0.14, 0.14, Math.sin(a) * 0.14); }
    mesh(g, new THREE.SphereGeometry(0.03, 8, 6), mat(C.red), 0, 0.06, 0.165);
  }
  if (kind === 'fedora') {
    const g = new THREE.Group(); g.position.set(-0.03, T - 0.01, 0); g.rotation.z = 0.12; body.add(g);
    mesh(g, new THREE.CylinderGeometry(0.34, 0.34, 0.03, 24), mat(C.fedora), 0, 0.015, 0);
    mesh(g, new THREE.CylinderGeometry(0.18, 0.22, 0.19, 20), mat(C.fedora), 0, 0.12, 0);
    mesh(g, new THREE.CylinderGeometry(0.223, 0.223, 0.05, 20), mat(C.band), 0, 0.055, 0);
  }
  if (kind === 'glasses') {
    for (const x of [-0.15, 0.15]) mesh(body, new THREE.TorusGeometry(0.085, 0.015, 8, 20), mat(C.dark), x, 0.47, 0.375);
    mesh(body, new THREE.BoxGeometry(0.07, 0.015, 0.015), mat(C.dark), 0, 0.48, 0.375);
  }
  if (kind === 'headset') {
    mesh(body, new THREE.TorusGeometry(0.44, 0.026, 8, 24, Math.PI), mat(C.dark), 0, 0.5, 0);
    for (const x of [-0.44, 0.44]) { const m = mesh(body, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), mat(C.dark), x, 0.5, 0); m.rotation.z = Math.PI / 2; }
  }
  if (kind === 'magnifier') {
    const g = new THREE.Group(); g.position.set(0, -0.36, 0.1); armR.add(g);
    mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), mat(C.fedora), 0, 0, 0);
    mesh(g, new THREE.TorusGeometry(0.09, 0.018, 8, 20), mat(C.metal), 0, 0.17, 0.02);
  }
  if (kind === 'notepad') {
    const g = new THREE.Group(); g.position.set(0.02, -0.34, 0.12); g.rotation.set(-0.2, 0.2, 0.1); armL.add(g);
    mesh(g, new THREE.BoxGeometry(0.2, 0.27, 0.03), mat(C.cream), 0, 0, 0);
    mesh(g, new THREE.BoxGeometry(0.21, 0.03, 0.04), mat(C.dark), 0, 0.14, 0);
  }
  if (kind === 'mug') {
    const g = new THREE.Group(); g.position.set(0, -0.37, 0.12); armR.add(g);
    mesh(g, new THREE.CylinderGeometry(0.07, 0.065, 0.14, 16), mat(C.cream), 0, 0, 0);
    mesh(g, new THREE.CylinderGeometry(0.062, 0.062, 0.01, 16), mat(0x5a3a28), 0, 0.066, 0);
  }
  if (kind === 'badge') {
    mesh(body, new THREE.BoxGeometry(0.15, 0.1, 0.012), mat(C.cream), 0.2, 0.2, 0.365);
    mesh(body, new THREE.BoxGeometry(0.04, 0.05, 0.004), mat(0xd99a63), 0.165, 0.2, 0.373);
  }
}

function makeClawd(accessories) {
  const g = new THREE.Group();
  const root = new THREE.Group();
  g.add(root);
  const legs = [-0.17, 0.17].map((x) => mesh(root, rb(0.2, 0.26, 0.22, 0.08, 8), feltMat, x, 0.13, 0));
  const body = new THREE.Group();
  body.position.y = 0.22;
  root.add(body);
  mesh(body, rb(0.82, 0.78, 0.72, 0.21, 12), feltMat, 0, 0.39, 0);
  for (const x of [-0.15, 0.15]) { const e = mesh(body, new THREE.SphereGeometry(0.045, 12, 10), mat(C.eye), x, 0.47, 0.355); e.scale.z = 0.5; }
  const smile = mesh(body, new THREE.TorusGeometry(0.06, 0.013, 6, 14, Math.PI), mat(C.eye), 0, 0.39, 0.36);
  smile.rotation.z = Math.PI;
  const blush = new THREE.MeshBasicMaterial({ color: 0xff8f7a, transparent: true, opacity: 0.55 });
  for (const x of [-0.26, 0.26]) { const b = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), blush); b.position.set(x, 0.39, 0.362); body.add(b); }
  const [armL, armR] = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.41, 0.56, 0);
    pivot.rotation.z = s * 0.22;
    mesh(pivot, rb(0.17, 0.36, 0.19, 0.08, 8), feltMat, 0, -0.17, 0);
    body.add(pivot);
    return pivot;
  });
  for (const kind of accessories) addAccessory(body, armL, armR, kind);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.62, 32), new THREE.MeshBasicMaterial({ color: 0xf08a52, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.015;
  ring.visible = false;
  g.add(ring);
  g.userData.rig = { root, body, armL, armR, legs, ring, phase: Math.random() * 6 };
  return g;
}

function animate(rig, st, t, k) {
  const { root, body, armL, armR, legs, phase: p } = rig;
  root.position.y = 0;
  body.rotation.set(0, 0, 0);
  body.position.y = 0.22 + Math.sin(t * 2.6 + p) * 0.012 * k;
  armL.rotation.set(0, 0, -0.22);
  armR.rotation.set(0, 0, 0.22);
  for (const l of legs) l.rotation.x = 0;
  if (st === 'read') { body.rotation.z = Math.sin(t * 1.2 + p) * 0.06 * k; armR.rotation.x = -0.5; }
  else if (st === 'write' || st === 'bash') {
    const f = st === 'bash' ? 6 : 14;
    armL.rotation.x = -0.9 + Math.max(0, Math.sin(t * f + p)) * 0.25 * k;
    armR.rotation.x = -0.9 + Math.max(0, Math.sin(t * f + p + Math.PI)) * 0.25 * k;
    if (st === 'bash') body.rotation.x = -0.07;
  } else if (st === 'talk') { body.rotation.y = Math.sin(t * 1.8 + p) * 0.15 * k; armR.rotation.z = 0.6 + Math.abs(Math.sin(t * 3.5 + p)) * 0.7 * k; }
  else if (st === 'wait') { armL.rotation.z = -2.5 + Math.sin(t * 9) * 0.35 * k; armR.rotation.z = 2.5 + Math.sin(t * 9 + Math.PI) * 0.35 * k; root.position.y = Math.abs(Math.sin(t * 4)) * 0.07 * k; }
  else if (st === 'done') { armR.rotation.z = 0.22 + Math.max(0, Math.sin(t * 1.2 + p)) * 0.2 * k; }
  else if (st === 'wave') { armR.rotation.z = 2.4 + Math.sin(t * 8) * 0.3 * k; }
}

export function createScene(canvas) {
  const W = 414, H = 268;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 1.25, 2.5));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const halfH = 2.05;
  const camera = new THREE.OrthographicCamera(-halfH * (W / H), halfH * (W / H), halfH, -halfH, 0.1, 100);
  camera.position.set(6, 5.4, 6.6);
  camera.lookAt(0, 0.35, -0.1);

  scene.add(new THREE.HemisphereLight(0xffe7cc, 0x5a4034, 0.9));
  const sun = new THREE.DirectionalLight(0xffcf9a, 1.6);
  sun.position.set(-3, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  scene.add(sun);
  const lamp = new THREE.PointLight(0xffb066, 2.5, 7, 2);
  lamp.position.set(1.4, 1.8, 1.4);
  scene.add(lamp);

  const floor = mesh(scene, rb(4.6, 0.16, 3.4, 0.08, 4), mat(0xb9824f), 0, -0.08, -0.2);
  floor.castShadow = false;
  const rug = mesh(scene, new THREE.CylinderGeometry(1.4, 1.4, 0.02, 40), mat(0xd99a63), 0, 0.01, -0.25);
  rug.castShadow = false;

  const agents = new Map(); // id -> { group, state, appear, leaving }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let selected = null;
  let onPick = () => {};

  function freeSpot() {
    const used = new Set([...agents.values()].map((a) => a.spot));
    const i = SUB_SPOTS.findIndex((_, idx) => !used.has(idx));
    return i >= 0 ? i : agents.size % SUB_SPOTS.length;
  }

  function addAgent(id, type) {
    if (agents.has(id)) return;
    const group = makeClawd(accessoriesFor(type));
    group.userData.agentId = id;
    const spot = id === 'main' ? -1 : freeSpot();
    const [x, z] = spot < 0 ? MAIN_SPOT : SUB_SPOTS[spot];
    group.position.set(x, 0, z);
    group.rotation.y = Math.atan2(-x * 0.3, 1.2);
    group.scale.setScalar(0.001);
    scene.add(group);
    agents.set(id, { group, state: 'think', spot, appear: 0, leaving: false });
  }

  function removeAgent(id) {
    const a = agents.get(id);
    if (a) a.leaving = true;
  }

  function setState(id, st) {
    const a = agents.get(id);
    if (a) a.state = st;
  }

  function select(id) {
    selected = id;
    for (const [aid, a] of agents) a.group.userData.rig.ring.visible = aid === id;
  }

  const tmp = new THREE.Vector3();
  function project(id) {
    const a = agents.get(id);
    if (!a) return null;
    tmp.set(a.group.position.x, 1.3 * a.group.scale.x, a.group.position.z).project(camera);
    return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H };
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects([...agents.values()].map((a) => a.group), true);
    let o = hits[0]?.object;
    while (o && !o.userData.agentId) o = o.parent;
    if (o) onPick(o.userData.agentId);
  });

  const frameListeners = new Set();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    const k = reduce ? 0 : 1;
    for (const [id, a] of agents) {
      if (a.leaving) {
        a.appear -= dt * 3;
        if (a.appear <= 0) { scene.remove(a.group); agents.delete(id); continue; }
      } else if (a.appear < 1) a.appear = Math.min(1, a.appear + dt * 2.5);
      // Hafif taşan bir yay: 0 -> 1.08 -> 1
      const s = reduce ? (a.appear > 0 ? 1 : 0) : 1 - Math.pow(1 - a.appear, 3) + Math.sin(a.appear * Math.PI) * 0.08;
      a.group.scale.setScalar(Math.max(0.001, s));
      animate(a.group.userData.rig, a.state, t, k);
    }
    renderer.render(scene, camera);
    for (const fn of frameListeners) fn();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    addAgent,
    removeAgent,
    setState,
    select,
    project,
    has: (id) => agents.has(id),
    onPick: (fn) => { onPick = fn; },
    onFrame: (fn) => frameListeners.add(fn),
    get selected() { return selected; },
  };
}
