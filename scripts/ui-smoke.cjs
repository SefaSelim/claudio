// Functional smoke test of the browser demo: keyboard shortcuts on the cards, office chat
// commands, the alarm, lighting, folding the office away, a settings switch and sending an
// attachment, in the app's own 482×750 window.
//
//   npm run build:demo
//   npx vite preview --port 4174 --strictPort &
//   node scripts/ui-smoke.cjs http://localhost:4174/
//
// Needs Playwright with Chromium (with a global install, run with NODE_PATH="$(npm root -g)").
// Prints PASS/FAIL per check and exits with code 1 if any check fails.

const { chromium } = require('playwright');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 482, height: 750 } });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('fresh')) { localStorage.clear(); sessionStorage.setItem('fresh', '1'); } } catch {} });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(process.argv[2] || 'http://localhost:4174/');
  await wait(1500);
  // Esc closes the open panel.
  const hadPanel = !!(await p.$('#panel .card'));
  await p.click('body', { position: { x: 5, y: 300 } }).catch(() => {});
  await p.keyboard.press('Escape');
  await wait(400);
  check('Esc closes the panel', hadPanel && !(await p.$('#panel .card')));
  // Question card: key 2 picks the second option, Enter sends.
  await p.waitForSelector('#requests .qc:not(.perm)', { timeout: 20000 });
  await wait(600);
  await p.keyboard.press('2');
  await wait(200);
  const picked = await p.$eval('#requests .qc:not(.perm) .opt.picked b', (e) => e.textContent).catch(() => null);
  check('1-9 picks an option', picked === 'In the header', String(picked));
  await p.keyboard.press('Enter');
  await wait(900);
  check('Enter sends the answer', !(await p.$('#requests .qc:not(.perm)')));
  // Permission card: N denies.
  await p.waitForSelector('#requests .qc.perm', { timeout: 20000 });
  await wait(600);
  await p.keyboard.press('n');
  await wait(900);
  check('N answers the permission card', !(await p.$('#requests .qc.perm')));
  const chat = await p.evaluate(() => [...document.querySelectorAll('.m')].map((m) => m.textContent).join('\n'));
  // Open chat and use office commands.
  await p.click('[data-open="chat"]');
  await wait(500);
  await p.fill('#msgInput', '/clear');
  await p.press('#msgInput', 'Enter');
  await wait(400);
  const afterClear = await p.$$eval('#thread .m', (els) => els.map((e) => e.textContent));
  check('/clear empties the chat view', afterClear.length <= 1, JSON.stringify(afterClear).slice(0, 120));
  await p.fill('#msgInput', '/tasks');
  await p.press('#msgInput', 'Enter');
  await wait(600);
  check('/tasks opens the task list', !!(await p.$('#teamTabs [data-v="tasks"][aria-pressed="true"]')));
  await p.click('[data-open="chat"]');
  await wait(400);
  await p.fill('#msgInput', '/meeting Sprint review');
  await p.press('#msgInput', 'Enter');
  await wait(600);
  check('/meeting opens setup with the topic', (await p.$eval('#meetTopic', (e) => e.value).catch(() => '')) === 'Sprint review');
  await p.keyboard.press('Escape');
  await p.click('[data-open="chat"]');
  await wait(400);
  await p.fill('#msgInput', '/alarm demo outage');
  await p.press('#msgInput', 'Enter');
  await wait(600);
  check('/alarm starts the alarm', !!(await p.$('#alarmPill:not([hidden])')));
  await p.fill('#msgInput', '/all-clear');
  await p.press('#msgInput', 'Enter');
  await wait(600);
  check('/all-clear ends the alarm', !!(await p.$('#alarmPill[hidden]')));
  await p.fill('#msgInput', '/unknown thing');
  await p.press('#msgInput', 'Enter');
  await wait(2200);
  const unknown = await p.$$eval('#thread .m', (els) => els.map((e) => e.textContent).join('|'));
  check('unknown slash text goes to Claude', /unknown thing/.test(unknown));
  // Mood toggle, right-click back to auto.
  const night0 = await p.$eval('#moodBtn', (e) => e.classList.contains('night'));
  await p.click('#moodBtn');
  await wait(300);
  const night1 = await p.$eval('#moodBtn', (e) => e.classList.contains('night'));
  check('mood button toggles the light', night0 !== night1);
  await p.click('#moodBtn', { button: 'right' });
  await wait(300);
  check('right-click returns to auto', /\(auto\)/.test(await p.$eval('#moodTip', (e) => e.textContent)));
  // Collapse is remembered across a reload.
  await p.keyboard.press('Escape');
  await p.click('#collapseBtn');
  await wait(700);
  await p.reload();
  await wait(1500);
  check('collapsed office stays collapsed after reload', await p.$eval('#office', (e) => e.classList.contains('collapsed')));
  await p.click('#reopenBtn');
  await wait(700);
  check('reopen shows the office', !(await p.$eval('#office', (e) => e.classList.contains('collapsed'))));
  // Settings switches persist.
  await p.click('[data-open="settings"]');
  await wait(500);
  const before = await p.$eval('#soundSw', (e) => e.getAttribute('aria-checked'));
  await p.click('#soundSw');
  await wait(300);
  const after = await p.$eval('#soundSw', (e) => e.getAttribute('aria-checked'));
  check('sound switch flips', before !== after);
  // Attach a file via the file input and send.
  await p.click('[data-open="chat"]');
  await wait(400);
  await p.setInputFiles('#fileInput', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await wait(300);
  check('attachment chip appears', !!(await p.$('#attachRow .att')));
  await p.press('#msgInput', 'Enter');
  await wait(600);
  check('message with only a file is sent', /Take a look at the attached files/.test(await p.$$eval('#thread .m', (els) => els.map((e) => e.textContent).join('|'))));
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
