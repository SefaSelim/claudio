import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createScene } from './scene.js';
import { watchHitRegions } from './hitRegions.js';

createScene(document.getElementById('scene'));

const stack = document.getElementById('stack');
const dock = document.getElementById('dock');

// Faz 0 test paneli: açıkken paneli tıklanabilir alana ekler, kapanınca çıkarır.
function togglePanel(btn) {
  const open = stack.querySelector('.card');
  if (open) {
    open.remove();
    btn.classList.remove('on');
    return;
  }
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.hit = '';
  card.innerHTML = `
    <h3>Tıklama geçirgenliği testi</h3>
    <p>Bu panelin, ofisin ve yan çubuğun dışındaki her yere tıklama alttaki pencereye geçer.</p>
    <p>Clawd'a tıklarsan el sallar.</p>
    <p><code>Faz 0 · Tauri 2 + three.js</code></p>`;
  stack.appendChild(card);
  btn.classList.add('on');
}

dock.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-panel]');
  if (btn) togglePanel(btn);
});

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

document.getElementById('quit').addEventListener('click', () => {
  invoke('quit_app').catch(() => window.close());
});

watchHitRegions();
