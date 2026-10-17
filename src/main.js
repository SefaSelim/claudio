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

document.getElementById('quit').addEventListener('click', () => {
  invoke('quit_app').catch(() => window.close());
});

watchHitRegions();
connect().catch(console.error);
