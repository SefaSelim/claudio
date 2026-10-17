import * as THREE from 'three';
import { box, cyl, glow, mesh, flat } from './three-kit.js';

// The cozy open-plan office: desks on the left, a glass meeting room on the right,
// a bookshelf, coffee corner, beanbag, lamps and fairy lights.
// Floor: x -4.5..4.5, z -3.2..3.2. Back wall at z = -3.2, left wall at x = -4.5,
// the front edge (z = +3.2) is open and is where agents walk in and out.

const PI = Math.PI;
const C = {
  floor: 0xb9824f, plank: 0xa87245, wallA: 0xead7bd, wallB: 0xa9b89c, trim: 0x7a5a40,
  desk: 0xd9a873, deskDark: 0x8b5e3c, leg: 0x6b4a32, laptop: 0xd8d4cf,
  leaf: 0x6fae5a, leaf2: 0x4f8a42, pot: 0xc8694f, rug: 0xd99a63, rug2: 0xe9c79a,
  gold: 0xf2c14e, dark: 0x3a302a, red: 0xe2574c, cream: 0xf6efe3, bean: 0x7f9c8a, shade: 0x4f6b56,
  books: [0xd97757, 0x4a7bd1, 0xf2c14e, 0x5aa36b, 0x8c6bd1, 0xe9c79a, 0x7a5a40],
};

const W = 9;
const D = 6.4;

// ---------- props ----------

function desk(p, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  p.add(g);
  box(g, 1.4, 0.07, 0.75, C.desk, 0, 0.38, 0, 0.03);
  for (const [lx, lz] of [[-0.62, -0.3], [0.62, -0.3], [-0.62, 0.3], [0.62, 0.3]]) box(g, 0.07, 0.38, 0.07, C.leg, lx, 0, lz, 0.015);
  // Laptop on the left, angled toward whoever stands behind the desk.
  const lap = new THREE.Group();
  lap.position.set(-0.4, 0.45, 0.02);
  lap.rotation.y = -0.55;
  g.add(lap);
  box(lap, 0.44, 0.03, 0.3, C.laptop, 0, 0, 0, 0.01);
  const lid = new THREE.Group();
  lid.position.set(0, 0.03, 0.14);
  lid.rotation.x = 0.22;
  lap.add(lid);
  box(lid, 0.44, 0.28, 0.025, C.laptop, 0, 0, 0, 0.01);
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshBasicMaterial({ color: 0xfff2e0 }));
  logo.position.set(0, 0.14, 0.015);
  lid.add(logo);
  cyl(g, 0.05, 0.045, 0.1, 10, C.cream, 0.5, 0.45, 0.2);
  box(g, 0.2, 0.04, 0.14, C.gold, 0.45, 0.45, -0.12, 0.01);
  return g;
}

function plant(p, x, z, s = 1) {
  cyl(p, 0.17 * s, 0.12 * s, 0.26 * s, 8, C.pot, x, 0, z);
  mesh(p, new THREE.IcosahedronGeometry(0.24 * s, 1), C.leaf, x, 0.47 * s, z);
  mesh(p, new THREE.IcosahedronGeometry(0.17 * s, 1), C.leaf2, x + 0.13 * s, 0.66 * s, z - 0.05 * s);
  mesh(p, new THREE.IcosahedronGeometry(0.13 * s, 1), C.leaf, x - 0.12 * s, 0.62 * s, z + 0.06 * s);
}

function skyTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 64);
  if (kind === 'night') { g.addColorStop(0, '#4b3f72'); g.addColorStop(0.55, '#c2668a'); g.addColorStop(1, '#f6a35c'); }
  else { g.addColorStop(0, '#7cc0ef'); g.addColorStop(1, '#e3f3ff'); }
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function windowPane(p, mats, x, y, z, w, h, alongX) {
  const m = new THREE.MeshBasicMaterial();
  mats.push(m);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (!alongX) g.rotation.y = PI / 2;
  p.add(g);
  box(g, w + 0.14, h + 0.14, 0.07, C.cream, 0, -h / 2 - 0.07, 0, 0.02);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  pane.position.z = 0.04;
  g.add(pane);
  box(g, 0.04, h, 0.06, C.cream, 0, -h / 2, 0.04, 0.005);
  box(g, w, 0.04, 0.06, C.cream, 0, -0.02, 0.04, 0.005);
  box(g, w + 0.3, 0.05, 0.16, C.cream, 0, -h / 2 - 0.1, 0.07, 0.015);
}

function bookshelf(p, x, z) {
  box(p, 1.5, 1.55, 0.34, C.deskDark, x, 0, z, 0.03);
  // Deterministic book heights so the shelf looks the same on every launch.
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let s = 0; s < 3; s++) {
    const y = 0.12 + s * 0.48;
    box(p, 1.38, 0.03, 0.3, C.desk, x, y, z + 0.01, 0.01);
    let bx = x - 0.62;
    while (bx < x + 0.6) {
      const w = 0.06 + rand() * 0.06, h = 0.22 + rand() * 0.16;
      box(p, w, h, 0.22, C.books[Math.floor(rand() * C.books.length)], bx + w / 2, y + 0.03, z + 0.02, 0.008);
      bx += w + 0.012;
    }
  }
  plant(p, x + 0.45, z, 0.55);
}

function coffeeCorner(p, x, z) {
  box(p, 1.3, 0.55, 0.5, C.cream, x, 0, z, 0.04);
  box(p, 1.36, 0.05, 0.56, C.deskDark, x, 0.55, z, 0.02);
  box(p, 0.32, 0.42, 0.3, C.dark, x + 0.3, 0.6, z, 0.05);
  glow(p, 0.025, 0xff7a5c, x + 0.3, 0.88, z - 0.16);
  cyl(p, 0.05, 0.045, 0.1, 10, C.cream, x - 0.15, 0.6, z - 0.05);
  cyl(p, 0.05, 0.045, 0.1, 10, C.gold, x - 0.35, 0.6, z + 0.05);
}

function floorLamp(p, x, z, h) {
  cyl(p, 0.18, 0.2, 0.04, 12, C.dark, x, 0, z);
  cyl(p, 0.02, 0.02, h, 6, C.dark, x, 0.04, z);
  mesh(p, new THREE.CylinderGeometry(0.14, 0.24, 0.24, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xf3dcb6, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffb35c, emissiveIntensity: 0.35 }), x, h, z);
  glow(p, 0.06, 0xffe0a8, x, h - 0.06, z);
}

function fairyLights(p, bulbs, from, to, y, n) {
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    const sag = Math.sin(((i % 6) / 5) * PI) * 0.1;
    bulbs.push(glow(p, 0.032, i % 3 ? 0xffd27a : 0xffb4a2, x, y - sag, z));
  }
}

const NOTE_COLOR = { pending: 0xf2c14e, in_progress: 0x9fc7e8, completed: 0xa9d18e };
const NOTE_ROWS = [0.62, 0.45, 0.29, 0.13];

/** Column headings for the task board, drawn once onto the board face. */
function boardFace() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 272;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#d9cfc2';
  g.lineWidth = 3;
  for (const x of [171, 341]) { g.beginPath(); g.moveTo(x, 12); g.lineTo(x, 260); g.stroke(); }
  g.fillStyle = '#7a6a5c';
  g.font = '600 26px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  ['Yapılacak', 'Sürüyor', 'Bitti'].forEach((t, i) => g.fillText(t, 85 + i * 171, 34));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The meeting-room whiteboard. Decorative post-its until the session has a task list,
 * then the real one: To do, In progress and Done columns, a red pin on blocked tasks.
 */
function whiteboard(p, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0.95, z);
  g.userData.pick = 'tasks';
  p.add(g);
  box(g, 1.7, 0.95, 0.05, C.deskDark, 0, 0, 0, 0.02);
  const plain = box(g, 1.6, 0.85, 0.03, 0xfbfaf6, 0, 0.05, 0.02, 0.01);
  const deco = new THREE.Group();
  g.add(deco);
  for (const [c, sx, sy] of [[0xf2c14e, -0.55, 0.55], [0x9fc7e8, -0.25, 0.6], [0xf2a0a0, 0.1, 0.5], [0xa9d18e, 0.45, 0.62], [0xf2c14e, 0.3, 0.28], [0x9fc7e8, -0.45, 0.25]]) {
    box(deco, 0.2, 0.18, 0.02, c, sx, sy, 0.04, 0.005);
  }
  const face = mesh(g, new THREE.PlaneGeometry(1.6, 0.85), new THREE.MeshStandardMaterial({ map: boardFace(), roughness: 0.85 }), 0, 0.475, 0.036);
  face.visible = false;
  const live = new THREE.Group();
  g.add(live);
  let flash = [];
  let flashEnd = 0;

  function setTasks(tasks, changed = new Set()) {
    live.clear();
    flash = [];
    flashEnd = performance.now() / 1000 + 3;
    const has = tasks.length > 0;
    deco.visible = !has;
    face.visible = has;
    plain.visible = !has;
    if (!has) return;
    ['pending', 'in_progress', 'completed'].forEach((status, col) => {
      const list = tasks.filter((t) => t.status === status);
      const shown = list.length > NOTE_ROWS.length ? list.slice(0, NOTE_ROWS.length - 1) : list;
      const cx = -0.53 + col * 0.53;
      shown.forEach((task, row) => {
        const note = box(live, 0.34, 0.13, 0.015, NOTE_COLOR[status], cx + (row % 2 ? 0.03 : -0.03), NOTE_ROWS[row] - 0.065, 0.045, 0.004);
        note.rotation.z = ((row * 37 + col * 11) % 7 - 3) * 0.012;
        if (task.blocked && status !== 'completed') glow(live, 0.022, 0xd9473c, cx + 0.13, NOTE_ROWS[row] - 0.01, 0.06);
        if (changed.has(task.id)) flash.push(note);
      });
      if (list.length > shown.length) box(live, 0.34, 0.13, 0.015, 0xd8d0c6, cx, NOTE_ROWS[NOTE_ROWS.length - 1] - 0.065, 0.045, 0.004);
    });
  }

  function tick(t, k) {
    if (!flash.length) return;
    const over = t > flashEnd;
    for (const n of flash) n.scale.setScalar(over ? 1 : 1 + Math.max(0, Math.sin(t * 6)) * 0.12 * k);
    if (over) flash = [];
  }

  return { setTasks, tick, group: g };
}

// ---------- layout ----------

const DOOR = [0.45, 2.95];
const AISLE = [0.45, -0.45]; // junction between the desk rows
const MEETING_GATE = [[0.45, 1.6], [1.5, 1.6]]; // through the opening in the glass wall

/** Desk spots: the seat behind each desk and how to reach it from the aisle junction. */
function deskSpot(id, x, z, viaAisle) {
  return { id, kind: 'desk', x: x + 0.15, z: z - 0.85, rot: 0, approach: [AISLE, ...viaAisle] };
}

const SPOTS = [
  // The lead desk is reserved for the main agent.
  deskSpot('lead', -1.75, 1.35, [[-1.6, -0.45]]),
  deskSpot('desk-1', -3.6, -1.55, [[-2.67, -0.45], [-2.67, -2.4]]),
  deskSpot('desk-2', -1.75, -1.55, [[-0.82, -0.45], [-0.82, -2.4]]),
  deskSpot('desk-3', 0.1, -1.55, [[-0.82, -0.45], [-0.82, -2.4]]),
  deskSpot('desk-4', -3.6, 1.35, [[-3.45, -0.45]]),
  // Overflow: chairs around the meeting-room table.
  ...[[-2.05], [-1.3], [-0.55]].flatMap(([z], i) => [
    { id: `meet-w${i}`, kind: 'meeting', x: 1.85, z, rot: PI / 2, approach: [...MEETING_GATE, [1.85, 0.4]] },
    { id: `meet-e${i}`, kind: 'meeting', x: 3.65, z, rot: -PI / 2, approach: [...MEETING_GATE, [3.65, 0.4]] },
  ]),
];

/** The head of the meeting table, reserved for the main agent during meetings. */
export const MEETING_HEAD = { id: 'meet-head', kind: 'meeting', x: 2.75, z: -2.82, rot: 0, approach: [...MEETING_GATE, [4.2, 0.4], [4.2, -2.82]] };

/** Standing places along the front of the table when every chair is taken. */
export const MEETING_STANDING = [[2.2, 0.35], [2.75, 0.45], [3.3, 0.35], [1.7, 0.9], [3.8, 0.9]].map(([x, z], i) => ({
  id: `meet-stand${i}`, kind: 'meeting', x, z, rot: PI, approach: [...MEETING_GATE, [x, z + 0.5]],
}));

/** Walk from one spot to another without going out through the door. */
export function routeBetween(from, to) {
  return [...[...from.approach].reverse(), ...to.approach, [to.x, to.z]];
}

/** Waypoints from the door to a spot (the spot itself last). */
export function routeFromDoor(spot) {
  return [...spot.approach, [spot.x, spot.z]];
}

/** Waypoints from a spot back to the door. */
export function routeToDoor(spot) {
  return [...spot.approach].reverse().concat([DOOR]);
}

export function buildOffice(scene) {
  const windowMats = [];
  const bulbs = [];

  // Floor planks, walls and trim.
  const floor = box(scene, W, 0.16, D, C.plank, 0, -0.16, 0, 0.04);
  floor.castShadow = false;
  for (let i = 0; i < 16; i += 2) box(scene, W - 0.08, 0.01, D / 16, C.floor, 0, -0.005, -D / 2 + (i + 0.5) * (D / 16), 0.002).castShadow = false;
  box(scene, W + 0.18, 2.0, 0.18, C.wallA, 0.09, 0, -D / 2 - 0.09, 0.03);
  box(scene, 0.18, 2.0, D, C.wallB, -W / 2 - 0.09, 0, 0, 0.03);
  box(scene, W, 0.14, 0.06, C.trim, 0, 0, -D / 2 + 0.03, 0.02);
  box(scene, 0.06, 0.14, D, C.trim, -W / 2 + 0.03, 0, 0, 0.02);
  windowPane(scene, windowMats, -0.85, 1.55, -D / 2 + 0.02, 1.1, 0.7, true);
  windowPane(scene, windowMats, -W / 2 + 0.02, 1.55, -0.8, 1.6, 0.75, false);
  fairyLights(scene, bulbs, [-4.4, -3.12], [0.9, -3.12], 1.9, 22);
  fairyLights(scene, bulbs, [1.1, -3.12], [4.4, -3.12], 1.9, 13);
  fairyLights(scene, bulbs, [-4.42, -3.0], [-4.42, 3.0], 1.9, 22);

  // Open office.
  bookshelf(scene, -3.45, -2.98);
  for (const [x, z] of [[-3.6, -1.55], [-1.75, -1.55], [0.1, -1.55], [-3.6, 1.35], [-1.75, 1.35]]) desk(scene, x, z);
  // Desk lamp on the lead desk.
  cyl(scene, 0.07, 0.08, 0.03, 10, C.dark, -1.6, 0.45, 1.55);
  cyl(scene, 0.012, 0.012, 0.3, 5, C.dark, -1.6, 0.48, 1.55);
  mesh(scene, new THREE.ConeGeometry(0.1, 0.12, 12, 1, true), new THREE.MeshStandardMaterial({ color: C.shade, side: THREE.DoubleSide }), -1.6, 0.82, 1.55);
  glow(scene, 0.035, 0xffe0a8, -1.6, 0.77, 1.55);
  coffeeCorner(scene, -0.6, 2.88);
  plant(scene, -4.1, -1.75, 0.8);

  // Cozy corner.
  mesh(scene, new THREE.CylinderGeometry(1.0, 1.0, 0.025, 24), flat(C.rug, { flatShading: false }), -3.3, 0.012, 2.45).castShadow = false;
  const bean = mesh(scene, new THREE.SphereGeometry(0.42, 16, 10), flat(C.bean, { flatShading: false }), -3.35, 0.25, 2.45);
  bean.scale.set(1, 0.62, 1);
  floorLamp(scene, -4.05, 2.75, 1.6);

  // Meeting room behind a glass wall at x = 1.0 (open toward the front).
  const glass = mesh(scene, new THREE.BoxGeometry(0.05, 1.55, 3.8), new THREE.MeshStandardMaterial({ color: 0xe8f4f6, transparent: true, opacity: 0.28, roughness: 0.15 }), 1.0, 0.8, -1.3);
  glass.castShadow = false;
  for (const z of [-3.2, -1.3, 0.6]) box(scene, 0.09, 1.62, 0.09, C.deskDark, 1.0, 0, z, 0.02);
  box(scene, 0.09, 0.07, 3.8, C.deskDark, 1.0, 1.58, -1.3, 0.02);
  box(scene, 0.09, 0.1, 3.8, C.deskDark, 1.0, 0, -1.3, 0.02);
  mesh(scene, new THREE.CylinderGeometry(1.75, 1.75, 0.025, 28), flat(C.rug2, { flatShading: false }), 2.75, 0.012, -1.3).castShadow = false;
  box(scene, 1.0, 0.07, 2.3, C.desk, 2.75, 0.4, -1.35, 0.04);
  for (const [a, b] of [[-0.38, -0.95], [0.38, -0.95], [-0.38, 0.95], [0.38, 0.95]]) box(scene, 0.08, 0.4, 0.08, C.leg, 2.75 + a, 0, -1.35 + b, 0.015);
  cyl(scene, 0.05, 0.045, 0.1, 10, C.cream, 2.6, 0.47, -1.9);
  cyl(scene, 0.05, 0.045, 0.1, 10, C.gold, 2.95, 0.47, -0.8);
  cyl(scene, 0.008, 0.008, 0.6, 4, C.dark, 2.75, 1.95, -1.35);
  mesh(scene, new THREE.CylinderGeometry(0.08, 0.32, 0.24, 16, 1, true), new THREE.MeshStandardMaterial({ color: C.shade, roughness: 0.9, side: THREE.DoubleSide }), 2.75, 1.83, -1.35);
  glow(scene, 0.07, 0xffe0a8, 2.75, 1.72, -1.35);
  const board = whiteboard(scene, 2.75, -D / 2 + 0.05);
  plant(scene, 4.15, 2.75, 1.05);
  plant(scene, 4.15, -2.85, 0.8);

  // Lights. Intensities are in three.js physical units (r155+).
  const hemi = new THREE.HemisphereLight(0xffe7cc, 0x5a4034, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffcf9a, 1.7);
  sun.position.set(-4, 9, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  sun.shadow.bias = -0.0008;
  sun.shadow.radius = 4;
  scene.add(sun);
  const lamps = [[-4.05, 1.7, 2.75, 4.5], [2.75, 1.55, -1.35, 4.5], [-1.6, 1.4, -0.4, 5]].map(([x, y, z, dist]) => {
    const l = new THREE.PointLight(0xffb066, 4, dist, 2);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  });

  const skies = { night: skyTexture('night'), day: skyTexture('day') };

  function setMood(night) {
    hemi.intensity = night ? 1.2 : 2.8;
    sun.intensity = night ? 1.7 : 3.2;
    sun.color.set(night ? 0xffcf9a : 0xfff4e6);
    lamps.forEach((l, i) => { l.intensity = night ? (i === 2 ? 2 : 4) : 0.4; });
    for (const m of windowMats) { m.map = night ? skies.night : skies.day; m.needsUpdate = true; }
    for (const b of bulbs) b.visible = night;
  }

  /** Gentle twinkle for the fairy lights. */
  function tick(t, k) {
    bulbs.forEach((b, i) => b.scale.setScalar(1 + Math.sin(t * 2 + i * 1.7) * 0.18 * k));
    board.tick(t, k);
  }

  setMood(true);
  return { setMood, tick, spots: SPOTS, door: DOOR, setTasks: board.setTasks, board: board.group };
}
