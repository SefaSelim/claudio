// Runs as Claude Code's asyncRewake hook (set up again at SessionStart and Stop).
// Waits on the bridge until the office has a message for this session. Then it writes the
// message to stderr and exits with code 2: Claude Code wakes Claude even if the session is idle
// and shows it the text. If the office is closed or a newer waiter took over, it exits 0 quietly.

import fs from 'node:fs';
import http from 'node:http';
import { tokenFile, BRIDGE_PORT } from './paths.mjs';

const readStdin = () =>
  new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (d) => (data += d)).on('end', () => resolve(data));
  });

function request(sessionId, token) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: BRIDGE_PORT, path: `/wait?session=${encodeURIComponent(sessionId)}`, headers: { 'X-Claudio-Token': token } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (body += d)).on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

const input = JSON.parse((await readStdin()) || '{}');
const sessionId = input.session_id;
let token = '';
try {
  token = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')).token;
} catch {
  process.exit(0); // the office was never set up
}
if (!sessionId) process.exit(0);

for (;;) {
  const { status, body } = await request(sessionId, token);
  let reply = {};
  try {
    reply = status === 200 ? JSON.parse(body) : {};
  } catch {
    // malformed reply: quit
  }
  if (reply.kind === 'message' && reply.text) {
    process.stderr.write(reply.text);
    process.exit(2);
  }
  // "timeout": wait again. "superseded", 401 or a connection error (office closed): quit.
  if (reply.kind !== 'timeout') process.exit(0);
}
