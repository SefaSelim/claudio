import * as THREE from 'three';
import { rb, smooth, mesh } from './three-kit.js';

// Felt Clawd characters: a rounded body, two stubby legs, hanging arms, dot eyes,
// a small smile and blush. The accessory tells the agent's role.

const FELT = 0xef7a3c;
const C = { gold: 0xf2c14e, red: 0xe2574c, fedora: 0x8b6a4e, band: 0x4b3426, dark: 0x3a302a, cream: 0xf6efe3, metal: 0xb5aca2, eye: 0x2a1a12 };

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
  // A few short fibres make the surface read as felt rather than noise.
  x.globalAlpha = 0.18;
  for (let i = 0; i < 500; i++) {
    x.strokeStyle = Math.random() < 0.5 ? '#fff' : '#8a8a8a';
    const a = Math.random() * 128, b = Math.random() * 128;
    x.beginPath();
    x.moveTo(a, b);
    x.lineTo(a + Math.random() * 7 - 3.5, b + Math.random() * 7 - 3.5);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2.5, 2.5);
  return t;
}

const feltTex = feltTexture();
const feltMat = new THREE.MeshStandardMaterial({ color: FELT, map: feltTex, bumpMap: feltTex, bumpScale: 0.012, roughness: 1 });
const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8f7a, transparent: true, opacity: 0.55 });

/** Accessories by agent type. Unknown custom agents get a stable pick from a small pool. */
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
    mesh(g, new THREE.CylinderGeometry(0.15, 0.17, 0.11, 6), smooth(C.gold), 0, 0.055, 0);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mesh(g, new THREE.SphereGeometry(0.035, 8, 6), smooth(C.gold), Math.cos(a) * 0.14, 0.14, Math.sin(a) * 0.14); }
    mesh(g, new THREE.SphereGeometry(0.03, 8, 6), smooth(C.red), 0, 0.06, 0.165);
  }
  if (kind === 'fedora') {
    const g = new THREE.Group(); g.position.set(-0.03, T - 0.01, 0); g.rotation.z = 0.12; body.add(g);
    mesh(g, new THREE.CylinderGeometry(0.34, 0.34, 0.03, 24), smooth(C.fedora), 0, 0.015, 0);
    mesh(g, new THREE.CylinderGeometry(0.18, 0.22, 0.19, 20), smooth(C.fedora), 0, 0.12, 0);
    mesh(g, new THREE.CylinderGeometry(0.223, 0.223, 0.05, 20), smooth(C.band), 0, 0.055, 0);
  }
  if (kind === 'glasses') {
    for (const x of [-0.15, 0.15]) mesh(body, new THREE.TorusGeometry(0.085, 0.015, 8, 20), smooth(C.dark), x, 0.47, 0.375);
    mesh(body, new THREE.BoxGeometry(0.07, 0.015, 0.015), smooth(C.dark), 0, 0.48, 0.375);
  }
  if (kind === 'headset') {
    mesh(body, new THREE.TorusGeometry(0.44, 0.026, 8, 24, Math.PI), smooth(C.dark), 0, 0.5, 0);
    for (const x of [-0.44, 0.44]) { const m = mesh(body, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16), smooth(C.dark), x, 0.5, 0); m.rotation.z = Math.PI / 2; }
  }
  if (kind === 'magnifier') {
    const g = new THREE.Group(); g.position.set(0, -0.36, 0.1); armR.add(g);
    mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), smooth(C.fedora), 0, 0, 0);
    mesh(g, new THREE.TorusGeometry(0.09, 0.018, 8, 20), smooth(C.metal), 0, 0.17, 0.02);
  }
  if (kind === 'notepad') {
    const g = new THREE.Group(); g.position.set(0.02, -0.34, 0.12); g.rotation.set(-0.2, 0.2, 0.1); armL.add(g);
    mesh(g, new THREE.BoxGeometry(0.2, 0.27, 0.03), smooth(C.cream), 0, 0, 0);
    mesh(g, new THREE.BoxGeometry(0.21, 0.03, 0.04), smooth(C.dark), 0, 0.14, 0);
  }
  if (kind === 'mug') {
    const g = new THREE.Group(); g.position.set(0, -0.37, 0.12); armR.add(g);
    mesh(g, new THREE.CylinderGeometry(0.07, 0.065, 0.14, 16), smooth(C.cream), 0, 0, 0);
    mesh(g, new THREE.CylinderGeometry(0.062, 0.062, 0.01, 16), smooth(0x5a3a28), 0, 0.066, 0);
  }
  if (kind === 'badge') {
    mesh(body, new THREE.BoxGeometry(0.15, 0.1, 0.012), smooth(C.cream), 0.2, 0.2, 0.365);
    mesh(body, new THREE.BoxGeometry(0.04, 0.05, 0.004), smooth(0xd99a63), 0.165, 0.2, 0.373);
  }
}

export function makeClawd(accessories) {
  const g = new THREE.Group();
  const root = new THREE.Group();
  g.add(root);
  const legs = [-0.17, 0.17].map((x) => mesh(root, rb(0.2, 0.26, 0.22, 0.08, 8), feltMat, x, 0.13, 0));
  const body = new THREE.Group();
  body.position.y = 0.22;
  root.add(body);
  mesh(body, rb(0.82, 0.78, 0.72, 0.21, 12), feltMat, 0, 0.39, 0);
  for (const x of [-0.15, 0.15]) { const e = mesh(body, new THREE.SphereGeometry(0.045, 12, 10), smooth(C.eye), x, 0.47, 0.355); e.scale.z = 0.5; }
  const smile = mesh(body, new THREE.TorusGeometry(0.06, 0.013, 6, 14, Math.PI), smooth(C.eye), 0, 0.39, 0.36);
  smile.rotation.z = Math.PI;
  for (const x of [-0.26, 0.26]) { const b = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), blushMat); b.position.set(x, 0.39, 0.362); body.add(b); }
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

/** Pose a character for its current state. `k` is 0 when reduced motion is on. */
export function animate(rig, st, t, k) {
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
  else if (st === 'listen') { body.rotation.x = Math.max(0, Math.sin(t * 1.6 + p)) * 0.08 * k; }
  else if (st === 'walk') {
    legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 11 + i * Math.PI) * 0.55 * k; });
    armL.rotation.x = Math.sin(t * 11) * 0.5 * k;
    armR.rotation.x = Math.sin(t * 11 + Math.PI) * 0.5 * k;
    body.position.y = 0.22 + Math.abs(Math.sin(t * 11)) * 0.03 * k;
  } else if (st === 'wave') { armR.rotation.z = 2.4 + Math.sin(t * 8) * 0.3 * k; }
}
