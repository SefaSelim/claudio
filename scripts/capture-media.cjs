// Captures the README screenshots and GIFs from the browser demo.
//
//   npm run build:demo
//   npx vite preview --port 4174 --strictPort &
//   node scripts/capture-media.cjs http://localhost:4174/
//
// Needs Playwright (with Chromium) and ffmpeg on PATH; neither is a project dependency.
// If Playwright is installed globally, run with NODE_PATH="$(npm root -g)".
// Output: docs/media/*.png and docs/media/*.gif.

const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:4174/';
const OUT = path.resolve(__dirname, '..', 'docs', 'media');
const VIEW = { width: 1280, height: 800 };
// The office, its dock and the cards above it live in the bottom-right 500×800 of the page.
const CROP = { x: 780, y: 0, width: 500, height: 800 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(browser, { query = '', video = null, scale = 2 } = {}) {
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: scale,
    ...(video ? { recordVideo: { dir: video, size: VIEW } } : {}),
  });
  // Daylight by default, so the shots do not depend on the clock; 'evening' switches it.
  await ctx.addInitScript(() => { try { localStorage.setItem('claudio.mood', 'day'); } catch {} });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error('pageerror:', e.message));
  await p.goto(BASE + query);
  await p.evaluate(() => document.querySelector('.demo-note')?.remove());
  return { ctx, p };
}

// Just the room and the dock, for shots without a card or panel above it.
const ROOM = { x: CROP.x, y: 515, width: CROP.width, height: 285 };

/** Screenshot, then requantise to 256 colours: a quarter of the size, no visible loss. */
async function shot(p, name, clip = CROP) {
  const file = path.join(OUT, `${name}.png`);
  const raw = path.join(os.tmpdir(), `claudio-${name}-raw.png`);
  await p.screenshot({ path: raw, clip });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a', file]);
  fs.rmSync(raw, { force: true });
}
const clickOpen = (p, key) => p.click(`[data-open="${key}"]`);

/** Answer the demo's question and permission cards so they stop covering the panels. */
async function answerAll(p) {
  // Clicked from inside the page: the cards animate in, and Playwright's stability wait
  // can outlast the next card's arrival.
  await p.evaluate(() => {
    const card = document.querySelector('#requests .card');
    if (!card) return;
    if (card.classList.contains('perm')) return card.querySelector('[data-a="allow"]')?.click();
    const option = [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Below the chat'));
    option?.click();
    [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Send')?.click();
  });
  await wait(700);
}

/** Turn a recorded webm into a looping GIF of the cropped office. */
function toGif(webm, name, { from = 0, length = 14, width = 400, fps = 12 } = {}) {
  const filters = `crop=${CROP.width}:${CROP.height}:${CROP.x}:${CROP.y},fps=${fps},scale=${width}:-1:flags=lanczos`;
  const palette = path.join(os.tmpdir(), `claudio-${name}-palette.png`);
  const common = ['-y', '-ss', String(from), '-t', String(length), '-i', webm];
  execFileSync('ffmpeg', [...common, '-vf', `${filters},palettegen=stats_mode=diff`, palette], { stdio: 'ignore' });
  execFileSync('ffmpeg', [...common, '-i', palette, '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', path.join(OUT, `${name}.gif`)], { stdio: 'ignore' });
}

async function record(browser, name, query, script, gifOpts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-video-'));
  const { ctx, p } = await page(browser, { query, video: dir, scale: 1 });
  await script(p);
  const video = p.video();
  await ctx.close();
  toGif(await video.path(), name, gifOpts);
  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- Screenshots of the normal run ---
  {
    const { ctx, p } = await page(browser);
    await wait(3500);
    await shot(p, 'office', ROOM); // agents at work, bubbles
    await clickOpen(p, 'chat');
    await wait(900);
    await shot(p, 'question'); // the question card, while Claude's chat opens below it
    await clickOpen(p, 'chat'); // close the card
    await wait(9000); // the question and the permission card arrive
    await shot(p, 'requests');
    // The permission card arrives a few seconds after the question; answer both.
    for (let i = 0; i < 12; i++) await answerAll(p);
    await wait(3000); // the turn ends, the recap row and the other sessions appear
    // Answering a card may already have opened the chat; the dock button toggles it.
    if (!(await p.$('#panel .card'))) await clickOpen(p, 'chat');
    await wait(900);
    await shot(p, 'turn-recap');
    await p.click('#panel button:has-text("Steps")').catch(() => {});
    await wait(700);
    await shot(p, 'agent-steps');
    await clickOpen(p, 'session');
    await wait(900);
    await shot(p, 'sessions');
    await clickOpen(p, 'team');
    await wait(1200);
    await shot(p, 'team');
    await clickOpen(p, 'settings');
    await wait(900);
    await shot(p, 'settings');
    await clickOpen(p, 'settings');
    await p.click('#moodBtn');
    await wait(1500);
    await shot(p, 'evening', ROOM);
    await p.click('#moodBtn');
    await ctx.close();
  }

  // --- Alarm: failing tests turn the office red ---
  {
    const { ctx, p } = await page(browser, { query: '?alarm' });
    // Keep answering the cards until the failing tests set the alarm off.
    for (let i = 0; i < 40 && !(await p.$('#alarmPill:not([hidden])')); i++) await answerAll(p);
    if (await p.$('#panel .card')) await clickOpen(p, 'chat');
    await wait(1200);
    await shot(p, 'alarm');
    await ctx.close();
  }

  // --- GIFs ---
  await record(browser, 'hero', '', async (p) => { await wait(16_000); }, { from: 0.5, length: 15, width: 420 });
  await record(browser, 'meeting', '', async (p) => {
    await wait(9_000); // let the opening play out, then clear the cards
    for (let i = 0; i < 12; i++) await answerAll(p);
    await wait(3_000);
    await clickOpen(p, 'meeting');
    await wait(1200);
    // The panel re-renders while the demo runs, so address the topic box by id each time.
    await p.click('#meetTopic').catch(() => {});
    await p.keyboard.type('Release plan', { delay: 60 });
    await p.keyboard.press('Enter');
    await wait(16_000);
  }, { from: 27, length: 14, width: 420 });

  await browser.close();
  for (const f of fs.readdirSync(OUT)) console.log(f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB');
})();
