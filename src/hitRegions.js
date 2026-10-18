import { invoke } from '@tauri-apps/api/core';

// Rust tarafı imleci yoklar ve sadece bu alanların üstündeyken pencereyi tıklanabilir yapar.
// Burada [data-hit] öğelerinin kutularını ona bildiriyoruz. An element can also register a
// shape: a polygon in its own CSS px, so only that part of its box catches clicks.
const inTauri = '__TAURI_INTERNALS__' in window;
const shapes = new WeakMap(); // element -> () => [[x, y], ...]
let last = '';

export function setHitShape(el, fn) {
  shapes.set(el, fn);
  reportHitRegions();
}

function collect() {
  const out = [];
  for (const el of document.querySelectorAll('[data-hit]')) {
    // Children of a folded office keep their boxes (clip-path does not change them).
    if (el.closest('.collapsed')) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) continue;
    const region = { x: r.left, y: r.top, w: r.width, h: r.height };
    const shape = shapes.get(el)?.();
    if (shape?.length >= 3) region.poly = shape.map(([x, y]) => [Math.round((r.left + x) * 10) / 10, Math.round((r.top + y) * 10) / 10]);
    out.push(region);
  }
  return out;
}

export function reportHitRegions() {
  const regions = collect();
  const key = JSON.stringify(regions);
  if (key === last) return;
  last = key;
  if (inTauri) invoke('set_hit_regions', { regions }).catch(console.error);
}

/** Last reported regions, for the browser preview's debug overlay. */
export const debugRegions = () => collect();

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
