import * as THREE from 'three';
import { makeClawd, animate, accessoriesFor } from './characters.js';
import { buildOffice, routeFromDoor, routeToDoor } from './office.js';

// The office scene. The main agent sits at the lead desk; subagents walk in through the
// open front edge, take a free desk (or a meeting-room chair when the desks are full),
// and walk back out when they finish.

const W = 414, H = 268;
const WALK_SPEED = 2.2; // floor units per second
const TURN_SPEED = 10; // how fast characters turn toward where they walk

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 1.25, 2.5));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const halfH = 3.55;
  const camera = new THREE.OrthographicCamera(-halfH * (W / H), halfH * (W / H), halfH, -halfH, 0.1, 100);
  const target = new THREE.Vector3(0, 0.55, 0);
  camera.position.set(10, 9, 11).add(target);
  camera.lookAt(target);

  const office = buildOffice(scene);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // id -> { group, state, spot, route, after, appear, fading, heading }
  const agents = new Map();
  let selected = null;
  let onPick = () => {};

  const taken = () => new Set([...agents.values()].filter((a) => !a.fading).map((a) => a.spot?.id));

  /** First free desk, then meeting chairs; null when everything is full. */
  function freeSpot() {
    const used = taken();
    return office.spots.find((s) => s.id !== 'lead' && !used.has(s.id)) ?? null;
  }

  /** Somewhere to stand near the coffee corner when the office is full. */
  function standingSpot(id) {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const x = -1.9 + (h % 7) * 0.32;
    const z = 2.05 + ((h >> 3) % 3) * 0.25;
    return { id: `stand-${id}`, kind: 'stand', x, z, rot: Math.PI, approach: [[x, z]] };
  }

  function addAgent(id, type) {
    if (agents.has(id)) return;
    const group = makeClawd(accessoriesFor(type));
    group.userData.agentId = id;
    group.scale.setScalar(0.001);
    scene.add(group);
    const agent = { group, state: 'think', spot: null, route: [], after: null, appear: 0, fading: false, heading: 0 };
    agents.set(id, agent);

    if (id === 'main') {
      // The main agent is already at work when the office attaches.
      agent.spot = office.spots.find((s) => s.id === 'lead');
      group.position.set(agent.spot.x, 0, agent.spot.z);
      group.rotation.y = agent.heading = agent.spot.rot;
      return;
    }
    agent.spot = freeSpot() ?? standingSpot(id);
    group.position.set(office.door[0], 0, office.door[1]);
    group.rotation.y = agent.heading = Math.PI;
    walk(agent, routeFromDoor(agent.spot), () => turnTo(agent, agent.spot.rot));
  }

  function walk(agent, points, after) {
    agent.route = points.map(([x, z]) => new THREE.Vector2(x, z));
    agent.after = after ?? null;
  }

  function turnTo(agent, rot) {
    agent.heading = rot;
  }

  /** Walk back out through the front, then shrink away. */
  function removeAgent(id) {
    const agent = agents.get(id);
    if (!agent || agent.fading || agent.leaving) return;
    agent.leaving = true;
    if (!agent.spot || id === 'main') { agent.fading = true; return; }
    walk(agent, routeToDoor(agent.spot), () => { agent.fading = true; });
  }

  function setState(id, st) {
    const agent = agents.get(id);
    if (agent) agent.state = st;
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

  const pos2 = new THREE.Vector2();
  function step(agent, dt) {
    const next = agent.route[0];
    const g = agent.group;
    pos2.set(g.position.x, g.position.z);
    const dist = pos2.distanceTo(next);
    const move = WALK_SPEED * dt * (reduce ? 3 : 1);
    if (dist <= move) {
      g.position.x = next.x;
      g.position.z = next.y;
      agent.route.shift();
      if (!agent.route.length) {
        const after = agent.after;
        agent.after = null;
        after?.();
      }
      return;
    }
    const dx = next.x - pos2.x, dz = next.y - pos2.y;
    g.position.x += (dx / dist) * move;
    g.position.z += (dz / dist) * move;
    agent.heading = Math.atan2(dx, dz);
  }

  /** Turn smoothly along the shortest way round. */
  function face(agent, dt) {
    const g = agent.group;
    let diff = agent.heading - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += reduce ? diff : diff * Math.min(1, dt * TURN_SPEED);
  }

  const frameListeners = new Set();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    const k = reduce ? 0 : 1;
    for (const [id, a] of agents) {
      if (a.fading) {
        a.appear -= dt * 3;
        if (a.appear <= 0) { scene.remove(a.group); agents.delete(id); continue; }
      } else if (a.appear < 1) a.appear = Math.min(1, a.appear + dt * 2.5);
      // Spring-like pop: 0 -> 1.08 -> 1.
      const s = reduce ? (a.appear > 0 ? 1 : 0) : 1 - Math.pow(1 - a.appear, 3) + Math.sin(a.appear * Math.PI) * 0.08;
      a.group.scale.setScalar(Math.max(0.001, s));
      const walking = a.route.length > 0;
      if (walking) step(a, dt);
      face(a, dt);
      animate(a.group.userData.rig, walking ? 'walk' : a.state, t, k);
    }
    office.tick(t, k);
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
    setMood: office.setMood,
    has: (id) => agents.has(id),
    onPick: (fn) => { onPick = fn; },
    onFrame: (fn) => frameListeners.add(fn),
    get selected() { return selected; },
  };
}
