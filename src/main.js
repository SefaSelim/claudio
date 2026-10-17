import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createScene } from './scene.js';
import { createUI } from './ui.js';
import { connect } from './session.js';
import { watchHitRegions } from './hitRegions.js';

const scene = createScene(document.getElementById('scene'));
createUI(scene);

const dock = document.getElementById('dock');

// Taşıma tutamağı: basılı tutup sürükleyince işletim sisteminin pencere taşımasını başlatır.
const grip = document.getElementById('grip');
grip.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.detail > 1) return;
  dock.classList.add('dragging');
  getCurrentWindow().startDragging().catch(console.error)
    .finally(() => dock.classList.remove('dragging'));
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

watchHitRegions();

// Development aid: open the Vite page in a normal browser with ?scene-demo to see agents
// walk in, work, and leave without Tauri or a Claude Code session.
if (!('__TAURI_INTERNALS__' in window) && new URLSearchParams(location.search).has('scene-demo')) {
  document.documentElement.style.background = '#8a8f99';
  import('./dev-demo.js').then((m) => m.runDevDemo());
} else {
  connect().catch(console.error);
}
