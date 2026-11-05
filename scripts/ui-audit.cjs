// Visual audit of the browser demo: walks the office through its panels, cards and states
// and reports text that overlaps other text, text that is cut off, and anything that
// spills out of its card or off the window. Screenshots of every state go to the output
// folder so they can be looked at as well.
//
//   npm run build:demo
//   npx vite preview --port 4174 --strictPort &
//   node scripts/ui-audit.cjs http://localhost:4174/ <out-dir>
//
// Needs Playwright with Chromium (not a project dependency; with a global install run it
// with NODE_PATH="$(npm root -g)"). Exits with code 1 when it finds a problem.

const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:4174/';
const OUT = path.resolve(process.argv[3] || 'ui-audit');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs in the page: every problem visible right now. */
function inspect() {
  const problems = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const label = (el) => {
    const t = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${t}"`;
  };
  // Elements that draw text of their own.
  const texts = [...document.querySelectorAll('body *')].filter((el) => {
    if (!visible(el) || el.closest('svg, canvas, script, style')) return false;
    if (el.closest('.tip')) return false; // hover tooltips are checked separately
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  // The part of a box that ancestors with overflow clipping (scroll areas, rounded cards)
  // let through; null when nothing of it shows.
  const clip = (el, r) => {
    let { left, top, right, bottom } = r;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const c = e.getBoundingClientRect();
      left = Math.max(left, c.left); right = Math.min(right, c.right);
      top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom);
    }
    return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
  };
  // A text node's own box: the range around its text, not the element's padding.
  const textRect = (el) => {
    const rs = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        const c = r.width > 0 && r.height > 0 ? clip(el, r) : null;
        if (c) rs.push({ c, full: r });
      }
    }
    return rs;
  };
  // Surfaces that are painted on top of one another. Text on different surfaces is normal
  // layering (a card over the office); text on the same surface must not collide. Name tags,
  // the badge, the meter and the alarm pill all float over the room, so they share one.
  const surface = (el) => {
    const card = el.closest('.card, .dock, .demo-note, .reopen-btn');
    if (card) return card;
    if (el.closest('.tag, .modebadge, .meterbar, .alarmpill')) return 'room';
    return 'page';
  };
  const boxes = texts.map((el) => ({ el, rects: textRect(el), surface: surface(el) })).filter((b) => b.rects.length);
  // 1. Text over text, on the same surface.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.surface !== b.surface || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const hit = a.rects.some(({ c: ra }) => b.rects.some(({ c: rb }) => {
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        return w > 2 && h > 2;
      }));
      if (!hit) continue;
      // A speech bubble is drawn on top of the room for a few seconds, like a comic; it may
      // pass over another character's name. Name over name, or anything over the badge, may not.
      const bubble = a.el.closest('.bubble') || b.el.closest('.bubble');
      const tagPair = a.el.closest('.tag') && b.el.closest('.tag');
      problems.push({ kind: bubble && tagPair ? 'bubble-over-tag' : tagPair ? 'tags-overlap' : 'text-overlap', a: label(a.el), b: label(b.el) });
    }
  }
  // 2. Text cut off inside its own box (an intended ellipsis is reported separately), or
  //    spilling out of a box that does not clip (a long word that cannot wrap).
  for (const { el } of boxes) {
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'visible' && cs.display !== 'inline' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
      problems.push({ kind: 'text-spills', a: label(el), b: `${el.scrollWidth}px in ${el.clientWidth}px` });
    }
    const clipsX = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis';
    if (clipsX && el.scrollWidth > el.clientWidth + 1) {
      problems.push({ kind: cs.textOverflow === 'ellipsis' ? 'ellipsis' : 'text-clipped', a: label(el), b: `${el.scrollWidth}px in ${el.clientWidth}px` });
    }
  }
  // 3. Text partly hidden by a clipping parent that does not scroll (cut, not scrollable),
  //    or outside the window.
  const vw = innerWidth;
  const vh = innerHeight;
  for (const { el, rects } of boxes) {
    for (const { c, full } of rects) {
      if (c.right > vw + 1 || c.bottom > vh + 1 || c.left < -1 || c.top < -1) problems.push({ kind: 'off-window', a: label(el), b: `${Math.round(c.left)},${Math.round(c.top)}` });
      const cut = full.width - c.width > 2 || full.height - c.height > 2;
      if (!cut) continue;
      // Rows that scroll out of a scrolling body are fine; anything else is cut off.
      let scrolls = false;
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) { scrolls = true; break; }
      }
      if (!scrolls && getComputedStyle(el).textOverflow !== 'ellipsis') problems.push({ kind: 'text-cut', a: label(el), b: `${Math.round(full.width)}×${Math.round(full.height)} shows ${Math.round(c.width)}×${Math.round(c.height)}` });
    }
  }
  // 4. Cards and panels that cover each other.
  const cards = [...document.querySelectorAll('#requests .card, #panel .card, .requests > *')].filter(visible);
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].contains(cards[j]) || cards[j].contains(cards[i])) continue;
      const a = cards[i].getBoundingClientRect();
      const b = cards[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) problems.push({ kind: 'card-overlap', a: label(cards[i]), b: label(cards[j]) });
    }
  }
  return problems;
}

async function run(browser, viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('claudio.mood', 'day'); } catch {} });
  const report = [];
  const errors = [];
  let last = 'load';
  const shot = async (p, name) => {
    last = name;
    await p.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) });
    const found = await p.evaluate(inspect);
    for (const f of found) report.push({ state: name, ...f });
  };
  // A click that cannot land (covered, off screen, missing) is a finding, not a crash.
  const click = async (p, sel, state) => {
    try {
      await p.click(sel, { timeout: 3000 });
      return true;
    } catch (err) {
      const why = String(err.message).split('\n').find((l) => /intercepts|outside of the viewport|not visible|Timeout/.test(l)) ?? err.message.split('\n')[0];
      report.push({ state, kind: 'blocked-click', a: sel, b: why.trim().slice(0, 160) });
      return false;
    }
  };
  const fill = async (p, sel, text, state) => {
    try {
      await p.fill(sel, text, { timeout: 3000 });
      return true;
    } catch (err) {
      report.push({ state, kind: 'blocked-input', a: sel, b: err.message.split('\n')[0].slice(0, 160) });
      return false;
    }
  };
  const open = (p, key, state = 'open') => click(p, `[data-open="${key}"]`, state);
  const closePanel = (p) => p.evaluate(() => document.querySelector('#panel [data-close]')?.click());
  const answerAll = async (p) => {
    for (let i = 0; i < 16; i++) {
      await p.evaluate(() => {
        const card = document.querySelector('#requests .card');
        if (!card) return;
        if (card.classList.contains('perm')) return card.querySelector('[data-a="allow"]')?.click();
        card.querySelector('.opt')?.click();
        card.querySelector('[data-send]')?.click();
      });
      await wait(600);
    }
  };
  const page = async (query = '') => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${tag} pageerror after ${last}: ${e.message} ${String(e.stack).split('\n').slice(1, 3).join(' ').trim()}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    await p.goto(BASE + query);
    return p;
  };

  // --- the scripted session ---
  const p = await page();
  await wait(1500);
  await shot(p, '01-start');
  await wait(3000);
  await shot(p, '02-subagents-working');
  await closePanel(p);
  await wait(400);
  // Every agent tag in the room, one at a time.
  const tagIds = await p.$$eval('#tags .tag .nm', (els) => els.map((e) => e.textContent));
  for (const name of tagIds) {
    await p.evaluate((n) => [...document.querySelectorAll('#tags .tag')].find((t) => t.querySelector('.nm')?.textContent === n)?.click(), name);
    await wait(700);
    await shot(p, `03-agent-${name.replace(/\W+/g, '_')}`);
    await p.evaluate(() => document.querySelector('#agentTabs [data-v="steps"]')?.click());
    await wait(500);
    await shot(p, `03-agent-${name.replace(/\W+/g, '_')}-steps`);
    await closePanel(p);
    await wait(300);
  }
  await p.waitForSelector('#requests .card', { timeout: 20000 }).catch(() => {});
  await wait(4500);
  await shot(p, '04-requests');
  await open(p, 'chat');
  await wait(600);
  await shot(p, '05-requests-with-panel');
  await answerAll(p);
  await wait(2500);
  if (!(await p.$('#panel .card'))) await open(p, 'chat');
  await wait(600);
  await shot(p, '06-chat-after-turn');
  // Slash commands write into the chat.
  for (const cmd of ['/help', '/status', '/agents']) {
    if (await fill(p, '#msgInput', cmd, 'slash')) await p.press('#msgInput', 'Enter');
    await wait(400);
  }
  await shot(p, '07-slash-commands');
  // A long message with an attachment-like name, to check wrapping.
  if (await fill(p, '#msgInput', 'Please refactor src/components/OfficeAgentLibraryPanelWithAVeryLongFileName.tsx and keep the tests green while you are at it', 'long-message')) await p.press('#msgInput', 'Enter');
  await wait(2500);
  await shot(p, '08-long-message');
  await open(p, 'session');
  await wait(600);
  await shot(p, '09-sessions');
  await open(p, 'settings');
  await wait(900);
  await shot(p, '10-settings');
  await p.evaluate(() => { const b = document.querySelector('#panel .pbody'); if (b) b.scrollTop = b.scrollHeight; });
  await wait(300);
  await shot(p, '11-settings-bottom');
  await open(p, 'team');
  await wait(800);
  for (const tab of ['office', 'library', 'skills', 'tasks']) {
    await p.evaluate((v) => document.querySelector(`#teamTabs [data-v="${v}"]`)?.click(), tab);
    await wait(600);
    await shot(p, `12-team-${tab}`);
  }
  // Open every library source, search, then add two agents.
  await p.evaluate(() => document.querySelector('#teamTabs [data-v="library"]')?.click());
  await wait(400);
  for (let i = 0; i < 4; i++) {
    await p.evaluate(() => [...document.querySelectorAll('[data-src]')].find((b) => !b.querySelector('.chev.open'))?.click());
    await wait(250);
  }
  await shot(p, '13-library-open');
  await fill(p, '#libSearch', 'qa', 'library-search');
  await wait(400);
  await shot(p, '14-library-search');
  await fill(p, '#libSearch', '', 'library-search');
  await wait(300);
  for (let i = 0; i < 2; i++) {
    await p.evaluate(() => document.querySelector('[data-add]:not([disabled])')?.click());
    await wait(900);
  }
  await p.evaluate(() => document.querySelector('#teamTabs [data-v="office"]')?.click());
  await wait(2500);
  await shot(p, '15-team-office-agents');
  await p.evaluate(() => document.querySelector('[data-open-agent]')?.click());
  await wait(700);
  await shot(p, '16-office-agent-card');
  if (await fill(p, '#msgInput', 'Review the open pull request', 'office-agent')) await p.press('#msgInput', 'Enter');
  await wait(1800);
  await shot(p, '17-office-agent-working');
  await wait(3000);
  await shot(p, '18-office-agent-done');
  await closePanel(p);
  await open(p, 'meeting');
  await wait(700);
  await shot(p, '19-meeting-setup');
  if (await click(p, '#meetTopic', 'meeting-setup')) {
    await p.keyboard.type('Release plan for the next version with a long topic that wraps');
    await p.keyboard.press('Enter');
  }
  await wait(5000);
  await shot(p, '20-meeting-running');
  if (await fill(p, '#meetInput', 'Tests first, please', 'meeting')) await p.press('#meetInput', 'Enter');
  await wait(4000);
  await p.evaluate(() => document.querySelector('[data-meet="end"]')?.click());
  await wait(3000);
  await shot(p, '21-meeting-summary');
  await p.evaluate(() => document.querySelector('[data-meet="close"]')?.click());
  await wait(1500);
  await click(p, '#moodBtn', 'evening');
  await wait(1200);
  await shot(p, '22-evening');
  await click(p, '#collapseBtn', 'collapse');
  await wait(900);
  await shot(p, '23-collapsed');
  await click(p, '#reopenBtn', 'reopen');
  await wait(900);
  await shot(p, '24-reopened');
  await p.close();

  // --- the failing-tests run with the alarm ---
  const a = await page('?alarm');
  for (let i = 0; i < 40 && !(await a.$('#alarmPill:not([hidden])')); i++) await answerAll(a);
  await wait(1000);
  await shot(a, '25-alarm');
  await open(a, 'chat');
  await wait(700);
  await shot(a, '26-alarm-chat');
  await a.close();

  await ctx.close();
  return { report, errors };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const all = [];
  // The app's own window, a laptop screen, and a phone for the web demo.
  const views = [[{ width: 482, height: 750 }, 'app'], [{ width: 1280, height: 800 }, 'wide'], [{ width: 390, height: 844 }, 'phone']]
    .filter(([, tag]) => !process.env.VIEWS || process.env.VIEWS.split(',').includes(tag));
  for (const [vp, tag] of views) {
    const { report, errors } = await run(browser, vp, tag);
    all.push(...report.map((r) => ({ view: tag, ...r })), ...errors.map((e) => ({ view: tag, kind: 'error', a: e })));
  }
  await browser.close();
  // One line per distinct problem, with the states it shows up in.
  const seen = new Map();
  for (const r of all) {
    const key = `${r.view} ${r.kind} ${r.a} ${r.b ?? ''}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(r.state ?? '');
  }
  const lines = [...seen].map(([k, states]) => `${k}  [${[...new Set(states)].join(', ')}]`).sort();
  fs.writeFileSync(path.join(OUT, 'report.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n') || 'no problems found');
  process.exit(all.some((r) => r.kind !== 'ellipsis' && r.kind !== 'bubble-over-tag') ? 1 : 0);
})();
