// Frame for the public web demo: a desktop-like backdrop and a short note that this is a
// recording of the office, not a live Claude Code session. Only loaded in VITE_DEMO builds.

const REPO = 'https://github.com/SefaSelim/claudio';

export function mountDemoShell() {
  document.documentElement.classList.add('demo');
  const params = new URLSearchParams(location.search);
  const alarm = params.has('alarm');
  const note = document.createElement('aside');
  note.className = 'demo-note';
  note.setAttribute('data-hit', '');
  note.innerHTML =
    `<button class="demo-pill" type="button" aria-expanded="false">Demo · info</button>` +
    `<div class="demo-body">` +
    `<b>Claudio · live demo</b>` +
    `<p>A scripted Claude Code session plays in the office: subagents walk in, a question and a permission card pop up, the main agent answers your messages. Click the characters and the dock buttons. Nothing here talks to an AI or needs an API key.</p>` +
    `<p class="demo-links">` +
    `<a href="${alarm ? '?' : '?alarm'}">${alarm ? 'Replay without alarm' : 'Replay with failing tests (alarm)'}</a>` +
    `<a href="${REPO}/releases/latest">Download for Windows</a>` +
    `<a href="${REPO}">Source on GitHub</a>` +
    `</p>` +
    `<button class="demo-x" type="button" aria-label="Fold the note away">×</button>` +
    `</div>`;
  const pill = note.querySelector('.demo-pill');
  const setOpen = (open) => {
    note.classList.toggle('folded', !open);
    pill.setAttribute('aria-expanded', String(open));
  };
  // Where the note would cover the office's panels, it starts folded into a small pill and
  // folds again as soon as the office is used.
  const narrow = matchMedia('(max-width: 900px)');
  setOpen(!narrow.matches);
  pill.addEventListener('click', () => setOpen(true));
  note.querySelector('.demo-x').addEventListener('click', () => setOpen(false));
  document.addEventListener('pointerdown', (e) => {
    if (narrow.matches && !note.contains(e.target)) setOpen(false);
  });
  document.body.appendChild(note);
  fitToScreen();
  addEventListener('resize', fitToScreen);
}

// The office is laid out for its own 482×750 window. On a smaller screen (a phone) the demo
// zooms the whole page out so the office, its dock and the cards above it stay on screen.
const APP_WIDTH = 482;
const APP_HEIGHT = 750;
function fitToScreen() {
  const html = document.documentElement;
  html.style.zoom = '';
  const scale = Math.min(1, innerWidth / APP_WIDTH, innerHeight / APP_HEIGHT);
  if (scale < 1) html.style.zoom = String(Math.floor(scale * 100) / 100);
}
