import * as THREE from 'three';

// Shared geometry and material helpers for the office and the characters.
// Geometries and materials are cached because the office reuses the same shapes many times.

/** Smooth rounded box: box vertices pushed onto a rounded shell, with exact normals. */
export function roundBox(w, h, d, r, seg = 10) {
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

/** Chunky, bevelled box for furniture (flat-shaded, KayKit style). Centered on the origin. */
function bevelBox(w, h, d, r) {
  r = Math.max(0.002, Math.min(r, w * 0.45, h * 0.45, d * 0.45));
  const a = w / 2 - r, b = d / 2 - r, cr = Math.max(0.002, Math.min(a, b) * 0.3);
  const s = new THREE.Shape();
  s.moveTo(-a + cr, -b); s.lineTo(a - cr, -b); s.quadraticCurveTo(a, -b, a, -b + cr);
  s.lineTo(a, b - cr); s.quadraticCurveTo(a, b, a - cr, b); s.lineTo(-a + cr, b);
  s.quadraticCurveTo(-a, b, -a, b - cr); s.lineTo(-a, -b + cr); s.quadraticCurveTo(-a, -b, -a + cr, -b);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.002, h - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, r - h / 2, 0);
  return g;
}

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
export const rb = (w, h, d, r, seg = 10) => cached(`rb:${w},${h},${d},${r},${seg}`, () => roundBox(w, h, d, r, seg));
const bb = (w, h, d, r) => cached(`bb:${w},${h},${d},${r}`, () => bevelBox(w, h, d, r));

const matCache = new Map();
/** Flat-shaded matte material (furniture). */
export const flat = (color, extra) => {
  const key = `f:${color}:${extra ? JSON.stringify(extra) : ''}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...extra }));
  return matCache.get(key);
};
/** Smooth matte material (characters, accessories, soft shapes). */
export const smooth = (color) => {
  const key = `s:${color}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  return matCache.get(key);
};

export function mesh(parent, geo, material, x, y, z) {
  const o = new THREE.Mesh(geo, typeof material === 'number' ? flat(material) : material);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}

/** Bevelled box whose bottom sits at y. */
export const box = (p, w, h, d, color, x, y, z, r = 0.035) => mesh(p, bb(w, h, d, r), color, x, y + h / 2, z);
/** Cylinder whose bottom sits at y. */
export const cyl = (p, rt, rb_, h, seg, color, x, y, z) => mesh(p, cached(`c:${rt},${rb_},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb_, h, seg)), color, x, y + h / 2, z);
/** Unlit glowing sphere (bulbs, LEDs). */
export function glow(p, r, color, x, y, z) {
  const m = new THREE.Mesh(cached(`g:${r}`, () => new THREE.SphereGeometry(r, 10, 8)), new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z);
  p.add(m);
  return m;
}
