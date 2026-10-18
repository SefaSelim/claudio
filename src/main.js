import { invoke } from '@tauri-apps/api/core';
import { createScene } from './scene.js';
import { createUI } from './ui.js';
import { connect } from './session.js';
import { watchHitRegions, setHitShape, reportHitRegions } from './hitRegions.js';

const scene = createScene(document.getElementById('scene'));
createUI(scene);

const dock = document.getElementById('dock');

const officeEl = document.getElementById('office');
// Only the room's silhouette catches clicks, not the empty corners of its box.
setHitShape(officeEl, () => scene.outline());

/** The visible part of the window (office and dock), in window CSS px. */
function contentRect() {
  const boxes = [dock, ...(officeEl.classList.contains('collapsed') ? [] : [officeEl])].map((el) => el.getBoundingClientRect());
  const x = Math.min(...boxes.map((b) => b.left));
  const y = Math.min(...boxes.map((b) => b.top));
  return { x, y, w: Math.max(...boxes.map((b) => b.right)) - x, h: Math.max(...boxes.map((b) => b.bottom)) - y };
}
const settle = () => invoke('settle_position', { content: contentRect() }).catch(() => {});

// Taşıma tutamağı: the shell follows the cursor while the button is held (Windows' own
// move loop would keep the tall window's top on screen and stop the office going up),
// then slides the office back inside the screen if it went past an edge.
const grip = document.getElementById('grip');
grip.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.detail > 1) return;
  e.preventDefault();
  dock.classList.add('dragging');
  invoke('begin_drag', { content: contentRect() }).catch(console.error);
  window.addEventListener('mouseup', () => dock.classList.remove('dragging'), { once: true });
  setTimeout(() => dock.classList.remove('dragging'), 30_000);
});
grip.addEventListener('dblclick', () => {
  invoke('reset_position').catch(console.error);
});

// Evening/day lighting. "auto" follows the clock (evening from 18:00 to 07:00);
// clicking picks the other mood explicitly and remembers it.
const MOOD_KEY = 'claudio.mood';
const moodBtn = document.getElementById('moodBtn');
const moodTip = document.getElementById('moodTip');
const readMood = () => {
  try { return localStorage.getItem(MOOD_KEY) || 'auto'; } catch { return 'auto'; }
};
const isEvening = () => { const h = new Date().getHours(); return h >= 18 || h < 7; };
function applyMood() {
  const pref = readMood();
  const night = pref === 'auto' ? isEvening() : pref === 'night';
  scene.setMood(night);
  moodBtn.classList.toggle('night', night);
  moodTip.textContent = `${night ? 'Akşam' : 'Gündüz'}${pref === 'auto' ? ' (otomatik)' : ''} · tıkla: ${night ? 'gündüz' : 'akşam'}`;
}
moodBtn.addEventListener('click', () => {
  const night = moodBtn.classList.contains('night');
  try { localStorage.setItem(MOOD_KEY, night ? 'day' : 'night'); } catch { /* storage unavailable */ }
  applyMood();
});
moodBtn.addEventListener('contextmenu', (e) => {
  // Right-click goes back to following the clock.
  e.preventDefault();
  try { localStorage.removeItem(MOOD_KEY); } catch { /* storage unavailable */ }
  applyMood();
});
applyMood();
setInterval(applyMood, 5 * 60 * 1000);

document.getElementById('quit').addEventListener('click', () => {
  invoke('quit_app').catch(() => window.close());
});

// Collapse: the office folds away to the right and only the dock stays; the arrow beside
// the dock brings it back. Remembered across restarts.
const COLLAPSED_KEY = 'claudio.collapsed';
const collapseBtn = document.getElementById('collapseBtn');
const reopenBtn = document.getElementById('reopenBtn');
function setCollapsed(on, { animate = true } = {}) {
  if (!animate) officeEl.style.transition = 'none';
  officeEl.classList.toggle('collapsed', on);
  dock.classList.toggle('solo', on);
  // A folded office catches no clicks; the hidden shape must not linger in the hit regions.
  if (on) officeEl.removeAttribute('data-hit');
  else officeEl.setAttribute('data-hit', '');
  reopenBtn.hidden = !on;
  if (on) reopenBtn.setAttribute('data-hit', '');
  else reopenBtn.removeAttribute('data-hit');
  if (on) scene.setPaused(true);
  else scene.setPaused(false);
  try { localStorage.setItem(COLLAPSED_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  if (!animate) requestAnimationFrame(() => { officeEl.style.transition = ''; });
  reportHitRegions();
  // Opening again may push the office past the screen's left edge.
  if (!on) setTimeout(settle, 480);
}
collapseBtn.addEventListener('click', () => setCollapsed(true));
reopenBtn.addEventListener('click', () => setCollapsed(false));
try {
  if (localStorage.getItem(COLLAPSED_KEY) === '1') setCollapsed(true, { animate: false });
} catch { /* storage unavailable */ }

watchHitRegions();
// A saved position from an older version (or another monitor layout) may leave the
// office partly off screen.
setTimeout(settle, 300);

// Development aid: open the Vite page in a normal browser with ?scene-demo to see agents
// walk in, work, and leave without Tauri or a Claude Code session.
if (!('__TAURI_INTERNALS__' in window) && new URLSearchParams(location.search).has('scene-demo')) {
  document.documentElement.style.background = '#8a8f99';
  import('./dev-demo.js').then((m) => m.runDevDemo());
  // ?scene-demo&hits outlines what catches clicks; everything else falls through.
  if (new URLSearchParams(location.search).has('hits')) {
    import('./hitRegions.js').then(({ debugRegions }) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('style', 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:99');
      document.body.appendChild(svg);
      setInterval(() => {
        svg.innerHTML = debugRegions().map((r) => (r.poly
          ? `<polygon points="${r.poly.map((p) => p.join(',')).join(' ')}" fill="rgba(0,160,255,.18)" stroke="#08f"/>`
          : `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgba(255,80,0,.15)" stroke="#f50"/>`)).join('');
      }, 300);
    });
  }
} else {
  connect().catch(console.error);
}
