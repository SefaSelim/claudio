import * as THREE from 'three';

// Faz 0 sahnesi: keçe bir Clawd ve yanında dönen bir küp, küçük bir zemin üstünde.
// Asıl ofis Faz 2'de gelecek.

const FELT = 0xef7a3c;

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

function makeClawd() {
  const tex = feltTexture();
  const felt = new THREE.MeshStandardMaterial({ color: FELT, map: tex, bumpMap: tex, bumpScale: 0.012, roughness: 1 });
  const eye = new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.85 });
  const g = new THREE.Group();
  const mesh = (geo, m, x, y, z) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = o.receiveShadow = true;
    return o;
  };
  [-0.17, 0.17].forEach((x) => g.add(mesh(roundBox(0.2, 0.26, 0.22, 0.08, 8), felt, x, 0.13, 0)));
  const body = new THREE.Group();
  body.position.y = 0.22;
  g.add(body);
  body.add(mesh(roundBox(0.82, 0.78, 0.72, 0.21), felt, 0, 0.39, 0));
  [-0.15, 0.15].forEach((x) => {
    const e = mesh(new THREE.SphereGeometry(0.045, 12, 10), eye, x, 0.47, 0.355);
    e.scale.z = 0.5;
    body.add(e);
  });
  const smile = mesh(new THREE.TorusGeometry(0.06, 0.013, 6, 14, Math.PI), eye, 0, 0.39, 0.36);
  smile.rotation.z = Math.PI;
  body.add(smile);
  const blush = new THREE.MeshBasicMaterial({ color: 0xff8f7a, transparent: true, opacity: 0.55 });
  [-0.26, 0.26].forEach((x) => {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), blush);
    b.position.set(x, 0.39, 0.362);
    body.add(b);
  });
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.41, 0.56, 0);
    pivot.rotation.z = s * 0.22;
    pivot.add(mesh(roundBox(0.17, 0.36, 0.19, 0.08, 8), felt, 0, -0.17, 0));
    body.add(pivot);
    return pivot;
  });
  g.userData = { body, armR: arms[1] };
  return g;
}

export function createScene(canvas) {
  const W = 414, H = 268;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const halfH = 1.6;
  const asp = W / H;
  const camera = new THREE.OrthographicCamera(-halfH * asp, halfH * asp, halfH, -halfH, 0.1, 100);
  camera.position.set(6, 5.4, 6.6);
  camera.lookAt(0, 0.45, 0);

  scene.add(new THREE.HemisphereLight(0xffe7cc, 0x5a4034, 0.9));
  const sun = new THREE.DirectionalLight(0xffcf9a, 1.6);
  sun.position.set(-3, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
  scene.add(sun);
  const lamp = new THREE.PointLight(0xffb066, 2.5, 6, 2);
  lamp.position.set(1.2, 1.6, 1.2);
  scene.add(lamp);

  const floor = new THREE.Mesh(roundBox(3.4, 0.16, 2.6, 0.06, 4), new THREE.MeshStandardMaterial({ color: 0xb9824f, roughness: 0.9 }));
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);

  const clawd = makeClawd();
  clawd.position.set(-0.55, 0, 0.1);
  clawd.rotation.y = 0.25;
  scene.add(clawd);

  const cube = new THREE.Mesh(roundBox(0.5, 0.5, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.8 }));
  cube.position.set(0.75, 0.6, -0.1);
  cube.castShadow = true;
  scene.add(cube);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let waveUntil = 0;

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObject(clawd, true).length) waveUntil = performance.now() + 1600;
  });

  function frame(now) {
    const t = now / 1000;
    const k = reduce ? 0 : 1;
    cube.rotation.y = t * 0.9 * k;
    cube.rotation.x = Math.sin(t * 0.7) * 0.3 * k;
    cube.position.y = 0.6 + Math.sin(t * 1.6) * 0.06 * k;
    const { body, armR } = clawd.userData;
    body.position.y = 0.22 + Math.sin(t * 2.6) * 0.012 * k;
    armR.rotation.z = now < waveUntil ? 2.4 + Math.sin(t * 8) * 0.3 * k : 0.22;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
