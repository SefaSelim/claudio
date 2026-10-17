// End-to-end tests of the bridge over its real stdin/stdout and HTTP interfaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBridge, ROOT } from './helpers/bridge.mjs';

const SID = 'sess-test';
const nl = String.fromCharCode(10);
const userLine = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + nl;
const replyLine = (text) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }) + nl;

async function attached(opts = {}) {
  const b = await startBridge({ sessions: [{ sessionId: SID, cwd: opts.cwd ?? 'x', name: 'test', status: opts.status ?? 'idle', secret: 'GIZLI' }], ...opts });
  const transcript = path.join(b.tmp, 'transcript.jsonl');
  fs.writeFileSync(transcript, opts.transcript ?? userLine('merhaba'));
  await b.post({ hook_event_name: 'SessionStart', session_id: SID, transcript_path: transcript });
  b.cmd({ cmd: 'attach', sessionId: SID });
  await b.until((e) => e.type === 'attached');
  return { ...b, transcript };
}

test('session list hides private fields; a wrong token is refused', async () => {
  const b = await startBridge({ sessions: [{ sessionId: SID, cwd: 'x', secret: 'GIZLI' }] });
  try {
    const list = await b.until((e) => e.type === 'sessions');
    assert.equal(list.list[0].sessionId, SID);
    assert(!JSON.stringify(list).includes('GIZLI'));
    assert.equal((await b.post({ hook_event_name: 'PreToolUse', session_id: SID }, 'wrong')).status, 401);
  } finally { await b.stop(); }
});

test('install and uninstall hooks, keeping user hooks', async () => {
  const b = await startBridge({ settings: { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } } });
  try {
    b.cmd({ cmd: 'install_hooks' });
    await b.until((e) => e.type === 'hooks_status' && e.installed);
    const s = JSON.parse(fs.readFileSync(path.join(b.claudeDir, 'settings.json'), 'utf8'));
    assert.equal(s.hooks.PermissionRequest[0].hooks[0].type, 'http');
    assert(s.hooks.Stop.some((g) => g.hooks.some((h) => h.asyncRewake)));
    assert(s.hooks.PostToolUseFailure && s.hooks.TaskCreated);
    assert(fs.existsSync(path.join(b.claudeDir, 'settings.json.claudio-backup')));
    b.events.length = 0;
    b.cmd({ cmd: 'uninstall_hooks' });
    await b.until((e) => e.type === 'hooks_status' && !e.installed);
    const after = JSON.parse(fs.readFileSync(path.join(b.claudeDir, 'settings.json'), 'utf8'));
    assert.deepEqual(after.hooks, { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] });
  } finally { await b.stop(); }
});

test('stale hooks from an older install are rewritten on connect', async () => {
  const b = await startBridge({ settings: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "C:/old/claudio-waiter.mjs"', asyncRewake: true }] }] } } });
  try {
    b.cmd({ cmd: 'status' });
    await b.until((e) => e.type === 'hooks_status');
    const text = fs.readFileSync(path.join(b.claudeDir, 'settings.json'), 'utf8');
    assert(!text.includes('C:/old'));
    assert(text.includes(path.join(ROOT, 'sidecar').split(path.sep).join('/')));
  } finally { await b.stop(); }
});

test('history, live transcript and hook events', async () => {
  const b = await attached();
  try {
    assert.equal((await b.until((e) => e.type === 'history')).items[0].text, 'merhaba');
    fs.appendFileSync(b.transcript, replyLine('selam!'));
    assert.equal((await b.until((e) => e.type === 'chat')).text, 'selam!');
    assert.deepEqual((await b.post({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Read', tool_input: { file_path: 'a.js' } })).json, {});
    assert.equal((await b.until((e) => e.type === 'hook' && e.event === 'PreToolUse')).tool_name, 'Read');
  } finally { await b.stop(); }
});

test('messages: after a tool, at the end of a turn, and by waking an idle session', async () => {
  const b = await attached();
  try {
    b.cmd({ cmd: 'send', text: 'testleri de çalıştır' });
    await b.until((e) => e.type === 'queued');
    const r1 = await b.post({ hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Read' });
    assert.match(r1.json.hookSpecificOutput.additionalContext, /testleri de çalıştır/);
    assert.equal((await b.until((e) => e.type === 'delivered')).via, 'araç sonrası');

    b.cmd({ cmd: 'send', text: 'bitince özet yaz' });
    await b.until((e) => e.type === 'queued');
    assert.equal((await b.post({ hook_event_name: 'Stop', session_id: SID })).json.decision, 'block');

    const waiter = spawn(process.execPath, [path.join(ROOT, 'sidecar', 'claudio-waiter.mjs')], { env: b.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    waiter.stderr.on('data', (d) => (stderr += d));
    waiter.stdin.end(JSON.stringify({ session_id: SID }));
    await b.wait(500);
    b.cmd({ cmd: 'send', text: 'uyan ve README güncelle' });
    assert.equal(await new Promise((r) => waiter.on('exit', r)), 2);
    assert.match(stderr, /README/);
  } finally { await b.stop(); }
});

test('permissions and questions answered from the office', async () => {
  const b = await attached();
  try {
    const permP = b.post({ hook_event_name: 'PermissionRequest', session_id: SID, tool_name: 'Bash', tool_input: { command: 'npm test' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }] });
    const req = await b.until((e) => e.type === 'request');
    b.cmd({ cmd: 'answer', requestId: req.requestId, behavior: 'always' });
    const decision = (await permP).json.hookSpecificOutput.decision;
    assert.equal(decision.behavior, 'allow');
    assert.equal(decision.updatedPermissions[0].type, 'addRules');

    const questions = [{ question: 'Hangi?', header: 'H', multiSelect: false, options: [{ label: 'A', description: '' }, { label: 'B', description: '' }] }];
    const qP = b.post({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'AskUserQuestion', tool_input: { questions } });
    const q = await b.until((e) => e.type === 'request' && e.kind === 'question');
    b.cmd({ cmd: 'answer', requestId: q.requestId, behavior: 'allow', answers: { 'Hangi?': 'B' } });
    assert.equal((await qP).json.hookSpecificOutput.updatedInput.answers['Hangi?'], 'B');

    const tP = b.post({ hook_event_name: 'PermissionRequest', session_id: SID, tool_name: 'Edit', tool_input: {} });
    const t = await b.until((e) => e.type === 'request');
    b.cmd({ cmd: 'answer', requestId: t.requestId, behavior: 'terminal' });
    assert.deepEqual((await tP).json, {});

    b.cmd({ cmd: 'set_option', options: { askQuestions: false } });
    await b.until((e) => e.type === 'options');
    const denied = await b.post({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'AskUserQuestion', tool_input: { questions } });
    assert.equal(denied.json.hookSpecificOutput.permissionDecision, 'deny');
  } finally { await b.stop(); }
});

test('other sessions: passed through, and marked while they wait', async () => {
  const b = await startBridge({ sessions: [{ sessionId: 'other', cwd: 'y' }] });
  try {
    await b.until((e) => e.type === 'sessions');
    assert.deepEqual((await b.post({ hook_event_name: 'PermissionRequest', session_id: 'other', tool_name: 'Bash', tool_input: {} })).json, {});
    await b.until((e) => e.type === 'sessions' && e.list[0].waiting === 'permission');
    await b.post({ hook_event_name: 'PostToolUse', session_id: 'other', tool_name: 'Bash' });
    await b.until((e) => e.type === 'sessions' && e.list[0].waiting === null);
  } finally { await b.stop(); }
});

test('roster, task list, failure hooks and cwd changes', async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-proj-'));
  fs.mkdirSync(path.join(proj, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'agents', 'qa.md'), ['---', 'name: qa', 'description: Tests things', '---', ''].join(nl));
  const b = await attached({ cwd: proj });
  try {
    const roster = await b.until((e) => e.type === 'roster');
    assert(roster.agents.some((a) => a.name === 'qa' && a.source === 'project'));
    const dir = path.join(b.claudeDir, 'tasks', SID);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '1.json'), JSON.stringify({ id: '1', subject: 'Write tests', status: 'in_progress' }));
    await b.post({ hook_event_name: 'TaskCreated', session_id: SID, task_id: '1', task_subject: 'Write tests' });
    assert.equal((await b.until((e) => e.type === 'tasks' && e.tasks.length === 1, 3000)).tasks[0].status, 'in_progress');
    await b.post({ hook_event_name: 'StopFailure', session_id: SID, error: 'rate_limit' });
    assert.equal((await b.until((e) => e.type === 'hook' && e.event === 'StopFailure')).error, 'rate_limit');
    await b.post({ hook_event_name: 'CwdChanged', session_id: SID, old_cwd: proj, new_cwd: b.tmp });
    const r2 = await b.until((e) => e.type === 'roster' && !e.agents.some((a) => a.name === 'qa'));
    assert(r2.agents.some((a) => a.name === 'Explore'));
  } finally {
    await b.stop();
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('signals and usage', async () => {
  const usage = (id, input) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id, model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: 0 } } }) + nl;
  const b = await attached({ transcript: usage('a', 100_000) });
  try {
    const u = await b.until((e) => e.type === 'usage', 3000);
    assert.equal(u.percent, 10);
    const command = 'npm run build && npm test';
    await b.post({ hook_event_name: 'PreToolUse', session_id: SID, tool_name: 'Bash', tool_use_id: 't1', tool_input: { command } });
    assert.deepEqual((await b.until((e) => e.type === 'signal' && e.phase === 'start')).signals.map((s) => s.kind), ['build', 'test']);
    await b.post({ hook_event_name: 'PostToolUseFailure', session_id: SID, tool_name: 'Bash', tool_use_id: 't1', tool_input: { command }, error: `Exit code 1${nl}  2 failing` });
    const end = await b.until((e) => e.type === 'signal' && e.phase === 'end');
    assert.equal(end.signals[1].result, 'fail');
    assert.equal(end.signals[1].detail, '2 başarısız');
  } finally { await b.stop(); }
});

test('diagnostics report the setup', async () => {
  const b = await startBridge({ env: { CLAUDIO_VERSION: '9.9.9' } });
  try {
    b.cmd({ cmd: 'diagnostics' });
    const d = await b.until((e) => e.type === 'diagnostics');
    assert.equal(d.version, '9.9.9');
    assert.equal(d.node, process.version);
    assert.equal(d.hooksInstalled, false);
    assert.equal(d.hooksSeen, 0);
    await b.post({ hook_event_name: 'SessionStart', session_id: 'z' });
    b.cmd({ cmd: 'diagnostics' });
    assert.equal((await b.until((e) => e.type === 'diagnostics')).hooksSeen, 1);
  } finally { await b.stop(); }
});

test('a message to a subagent that has finished is refused, not left queued', async () => {
  const b = await attached();
  try {
    await b.post({ hook_event_name: 'SubagentStart', session_id: SID, agent_id: 'sub1', agent_type: 'Explore' });
    assert.deepEqual((await b.post({ hook_event_name: 'SubagentStop', session_id: SID, agent_id: 'sub1' })).json, {});
    b.cmd({ cmd: 'send', text: 'hâlâ orada mısın?', target: 'sub1', clientId: 'c1' });
    const err = await b.until((e) => e.type === 'error' && e.clientId === 'c1');
    assert.match(err.message, /bitirdi/);
    assert(!b.events.some((e) => e.type === 'queued'));
  } finally { await b.stop(); }
});

test('a waiter that disconnected before the message does not take it', async () => {
  const b = await attached();
  try {
    const http = await import('node:http');
    const req = http.request({ host: '127.0.0.1', port: b.port, path: `/wait?session=${SID}`, headers: { 'X-Claudio-Token': b.token }, agent: false });
    req.on('error', () => {});
    req.end();
    await b.wait(150);
    req.destroy();
    await b.wait(150);
    b.cmd({ cmd: 'send', text: 'kaybolma' });
    await b.until((e) => e.type === 'queued');
    await b.wait(100);
    assert(!b.events.some((e) => e.type === 'delivered'), 'not marked delivered by the dead waiter');
    const r = await b.post({ hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Read' });
    assert.match(r.json.hookSpecificOutput.additionalContext, /kaybolma/);
  } finally { await b.stop(); }
});

test('detaching drops messages that never reached the session', async () => {
  const b = await attached();
  try {
    b.cmd({ cmd: 'send', text: 'eski mesaj' });
    await b.until((e) => e.type === 'queued');
    b.cmd({ cmd: 'detach' });
    await b.until((e) => e.type === 'detached');
    b.cmd({ cmd: 'attach', sessionId: SID });
    await b.until((e) => e.type === 'attached');
    assert.deepEqual((await b.post({ hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Read' })).json, {});
  } finally { await b.stop(); }
});
