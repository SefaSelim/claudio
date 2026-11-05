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
    `<b>Claudio · live demo</b>` +
    `<p>A scripted Claude Code session plays in the office on the right: subagents walk in, a question and a permission card pop up, the main agent answers your messages. Click the characters and the dock buttons.</p>` +
    `<p class="demo-links">` +
    `<a href="${alarm ? '?' : '?alarm'}">${alarm ? 'Replay without alarm' : 'Replay with failing tests (alarm)'}</a>` +
    `<a href="${REPO}/releases/latest">Download for Windows</a>` +
    `<a href="${REPO}">Source on GitHub</a>` +
    `</p>` +
    `<button class="demo-x" aria-label="Close">×</button>`;
  note.querySelector('.demo-x').addEventListener('click', () => note.remove());
  document.body.appendChild(note);
}
