// Office agents end to end: the real bridge with a fake Claude Code CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBridge, ROOT } from './helpers/bridge.mjs';
import { parseRepoUrl } from '../sidecar/library.mjs';

const FAKE = path.join(ROOT, 'test', 'helpers', 'fake-claude.mjs');
const SID = 'sess-main';

async function office() {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-fake-')), 'calls.jsonl');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-wproj-'));
  fs.mkdirSync(path.join(proj, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'agents', 'tester.md'), ['---', 'name: tester', 'description: Writes tests', 'tools: Read, Grep', 'model: haiku', '---', 'You write tests.'].join('\n'));
  const b = await startBridge({ sessions: [{ sessionId: SID, cwd: proj }], env: { CLAUDIO_CLAUDE: FAKE, CLAUDIO_FAKE_LOG: log } });
  b.cmd({ cmd: 'attach', sessionId: SID });
  await b.until((e) => e.type === 'attached');
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const add = async (key) => {
    b.cmd({ cmd: 'worker_add', key });
    return (await b.until((e) => e.type === 'worker_added' || e.type === 'error')).worker;
  };
  const idle = (id) => b.until((e) => e.type === 'worker_state' && e.id === id && e.state === 'idle', 6000);
  return { ...b, proj, calls, add, idle, done: async () => { await b.stop(); fs.rmSync(proj, { recursive: true, force: true }); } };
}

test('library lists the built-in and the project agents; repo URLs parse', async () => {
  const o = await office();
  try {
    o.cmd({ cmd: 'library' });
    const lib = await o.until((e) => e.type === 'library');
    assert(lib.sources.find((s) => s.id === 'builtin').agents.some((a) => a.key === 'builtin/genel'));
    const project = lib.sources.find((s) => s.id === 'project');
    assert.equal(project.agents[0].name, 'tester');
    assert.equal(project.agents[0].prompt, undefined, 'prompts stay in the bridge');
    assert(lib.recommended[0].url.includes('Claude-Code-Game-Studios'));
  } finally { await o.done(); }
  assert.deepEqual(parseRepoUrl('https://github.com/Donchitos/Claude-Code-Game-Studios'), { url: 'https://github.com/Donchitos/Claude-Code-Game-Studios.git', id: 'donchitos__claude-code-game-studios', label: 'Claude Code Game Studios' });
  assert.equal(parseRepoUrl('not a url'), null);
});

test('an office agent keeps one session across tasks and uses its definition', async () => {
  const o = await office();
  try {
    const w = await o.add('project/tester');
    assert.equal(w.title, 'tester');
    o.cmd({ cmd: 'worker_send', id: w.id, text: 'Birinci görev' });
    const reply = await o.until((e) => e.type === 'worker_chat' && e.role === 'assistant');
    assert.match(reply.text, /Birinci görev/);
    await o.idle(w.id);
    o.cmd({ cmd: 'worker_send', id: w.id, text: 'İkinci görev' });
    await o.until((e) => e.type === 'worker_chat' && e.role === 'assistant' && /İkinci/.test(e.text));
    await o.idle(w.id);
    const [first, second] = o.calls();
    assert.equal(first.resume, false);
    assert.equal(second.resume, true);
    assert.equal(first.sessionId, second.sessionId);
    const def = Object.values(first.agents)[0];
    assert.equal(def.prompt, 'You write tests.');
    assert.deepEqual(def.tools, ['Read', 'Grep']);
  } finally { await o.done(); }
});

test('at most five agents; removing one frees a place', async () => {
  const o = await office();
  try {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await o.add('builtin/genel')).id);
    o.cmd({ cmd: 'worker_add', key: 'builtin/genel' });
    assert.match((await o.until((e) => e.type === 'error')).message, /en fazla 5/i);
    o.cmd({ cmd: 'worker_remove', id: ids[0] });
    await o.until((e) => e.type === 'worker_removed' && e.id === ids[0]);
    assert((await o.add('project/tester')).id);
  } finally { await o.done(); }
});

test("an agent's permission prompt reaches the office and a message lands mid-task", async () => {
  const o = await office();
  try {
    const w = await o.add('builtin/genel');
    o.cmd({ cmd: 'worker_send', id: w.id, text: 'SLOW uzun iş' });
    await o.until((e) => e.type === 'worker_state' && e.id === w.id && e.state === 'working');
    const session = o.calls()[0]?.sessionId ?? (await o.wait(200), o.calls()[0].sessionId);
    const permP = o.post({ hook_event_name: 'PermissionRequest', session_id: session, tool_name: 'Bash', tool_input: { command: 'npm test' } });
    const req = await o.until((e) => e.type === 'request');
    assert.equal(req.agentId, `w:${w.id}`);
    o.cmd({ cmd: 'answer', requestId: req.requestId, behavior: 'allow' });
    assert.equal((await permP).json.hookSpecificOutput.decision.behavior, 'allow');

    o.cmd({ cmd: 'worker_send', id: w.id, text: 'şunu da ekle' });
    assert.equal((await o.until((e) => e.type === 'worker_chat' && e.role === 'user' && e.text === 'şunu da ekle')).pending, true);
    const r = await o.post({ hook_event_name: 'PostToolUse', session_id: session, tool_name: 'Read' });
    assert.match(r.json.hookSpecificOutput.additionalContext, /şunu da ekle/);
    // Its own session never shows up as a session to attach to.
    o.events.length = 0;
    o.cmd({ cmd: 'status' });
    const list = await o.until((e) => e.type === 'sessions');
    assert(!list.list.some((s) => s.sessionId === session));
  } finally { await o.done(); }
});

test('meeting: a working agent pauses, everyone speaks read-only, work resumes after', async () => {
  const o = await office();
  try {
    const a = await o.add('builtin/genel');
    const b = await o.add('project/tester');
    o.cmd({ cmd: 'worker_send', id: a.id, text: 'SLOW ana iş' });
    await o.until((e) => e.type === 'worker_state' && e.id === a.id && e.state === 'working');
    o.cmd({ cmd: 'meeting_start', topic: 'Sürüm planı', participants: [a.id, b.id] });
    await o.until((e) => e.type === 'meeting_started');
    await o.until((e) => e.type === 'worker_chat' && e.id === a.id && /ara verdi/.test(e.text));
    const l1 = await o.until((e) => e.type === 'meeting_line' && e.speaker === a.id, 6000);
    const l2 = await o.until((e) => e.type === 'meeting_line' && e.speaker === b.id, 6000);
    assert.match(l1.text, /Toplantı\] Konu: Sürüm planı/);
    assert.match(l2.text, /Toplantı\] Konu/);
    await o.until((e) => e.type === 'meeting_phase' && e.phase === 'waiting');
    o.cmd({ cmd: 'meeting_interject', text: 'Testler önce' });
    await o.until((e) => e.type === 'meeting_line' && e.speaker === b.id, 6000);
    o.cmd({ cmd: 'meeting_end' });
    const summary = await o.until((e) => e.type === 'meeting_summary', 6000);
    assert.match(summary.summary, /Karar: devam/);
    // The paused agent gets its work back after the summary.
    for (let i = 0; i < 80 && !o.calls().some((c) => /kaldığın yerden devam/.test(c.prompt)); i++) await o.wait(50);
    const calls = o.calls();
    const meetingCalls = calls.filter((c) => /Toplantı/.test(c.prompt) && !/kaldığın yerden/.test(c.prompt));
    assert(meetingCalls.every((c) => c.mode === 'plan'), 'meeting turns are read-only');
    assert(meetingCalls.some((c) => /Testler önce/.test(c.prompt)), 'the interjection reached the next round');
    const resumed = calls.find((c) => /kaldığın yerden devam/.test(c.prompt));
    assert.equal(resumed.sessionId, calls[0].sessionId, 'the paused agent resumes in its own session');
    assert.equal(resumed.mode, null);
  } finally { await o.done(); }
});
