// Starts a real bridge (sidecar/index.mjs) against throwaway Claude and app-data folders
// on its own port, and gives a test the bridge's events plus ways to talk to it.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let nextPort = 48100 + Math.floor(Math.random() * 400) * 4;

/**
 * @param {{ sessions?: object[], settings?: object, env?: object }} [opts]
 *   sessions: entries written to <claude>/sessions/<pid>.json (pid defaults to this process)
 */
export async function startBridge(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-test-'));
  const claudeDir = path.join(tmp, 'claude');
  const appData = path.join(tmp, 'appdata');
  fs.mkdirSync(path.join(claudeDir, 'sessions'), { recursive: true });
  (opts.sessions ?? []).forEach((s, i) => {
    fs.writeFileSync(path.join(claudeDir, 'sessions', `${process.pid + i * 100000}.json`), JSON.stringify({ pid: process.pid, status: 'idle', ...s }));
  });
  if (opts.settings) fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(opts.settings));
  const port = nextPort++;
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, APPDATA: appData, CLAUDIO_BRIDGE_PORT: String(port), CLAUDIO_FAKE: '', ...opts.env };
  const child = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'index.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  readline.createInterface({ input: child.stdout }).on('line', (l) => {
    try { events.push(JSON.parse(l)); } catch { /* not ours */ }
  });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Resolves with (and consumes) the first event that matches. */
  async function until(pred, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = events.findIndex(pred);
      if (i >= 0) return events.splice(i, 1)[0];
      await wait(25);
    }
    throw new Error(`no matching event in ${ms} ms; got: ${events.map((e) => e.type).join(', ')}\n${stderr}`);
  }
  const cmd = (c) => child.stdin.write(JSON.stringify(c) + '\n');

  cmd({ cmd: 'status' });
  await until((e) => e.type === 'ready');
  const token = JSON.parse(fs.readFileSync(path.join(appData, 'com.sefaselim.claudio', 'bridge.json'), 'utf8')).token;

  /** POST a hook body; resolves { status, json }. Retries while the server is still binding. */
  const post = async (body, tok = token) => {
    for (let i = 0; ; i++) {
      try {
        return await postOnce(body, tok);
      } catch (err) {
        if (err.code !== 'ECONNREFUSED' || i > 40) throw err;
        await wait(50);
      }
    }
  };
  const postOnce = (body, tok) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', agent: false, headers: { 'content-type': 'application/json', 'X-Claudio-Token': tok } }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d)).on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });

  async function stop() {
    child.stdin.end();
    child.kill();
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return { tmp, claudeDir, appData, port, env, token, events, until, cmd, post, wait, stop, child };
}
