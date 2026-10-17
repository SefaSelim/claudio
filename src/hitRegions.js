import { invoke } from '@tauri-apps/api/core';

// Rust tarafı imleci yoklar ve sadece bu dikdörtgenlerin üstündeyken pencereyi
// tıklanabilir yapar. Burada [data-hit] öğelerinin kutularını ona bildiriyoruz.
const inTauri = '__TAURI_INTERNALS__' in window;
let last = '';

function collect() {
  return [...document.querySelectorAll('[data-hit]')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
}

export function reportHitRegions() {
  const regions = collect();
  const key = JSON.stringify(regions);
  if (key === last) return;
  last = key;
  if (inTauri) invoke('set_hit_regions', { regions }).catch(console.error);
}

export function watchHitRegions() {
  const ro = new ResizeObserver(reportHitRegions);
  const observeAll = () => document.querySelectorAll('[data-hit]').forEach((el) => ro.observe(el));
  observeAll();
  new MutationObserver(() => { observeAll(); reportHitRegions(); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-hit', 'hidden', 'class'] });
  window.addEventListener('resize', reportHitRegions);
  // Animasyonlar bittiğinde kutular yerine oturur; seyrek bir yedek kontrol yeterli.
  setInterval(reportHitRegions, 1000);
  reportHitRegions();
}
