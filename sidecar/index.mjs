// The Claudio Office bridge. Tauri starts this file with `node`; it speaks JSON lines on stdin/stdout.
//
// It attaches to Claude Code sessions without an API key:
//  - Session list: ~/.claude/sessions
//  - Live events: the http hooks added to ~/.claude/settings.json POST to this bridge
//  - Chat: the attached session's transcript file is tailed
//  - Permissions and AskUserQuestion: the PermissionRequest / PreToolUse hook is held until the office answers
//  - Messages: delivered as PostToolUse additionalContext mid-turn, a Stop "block" at the end of a turn,
//    or through claudio-waiter.mjs (asyncRewake) when the session is idle
//
// Commands in: status, attach {sessionId}, detach, send {text, target?}, answer {requestId, ...},
//                 install_hooks, uninstall_hooks, set_option {answerInOffice}, roster
// Events out:  ready, sessions, attached, detached, history, chat, hook, request,
//                 request_cancelled, queued, delivered, hooks_status, error, roster, tasks,
//                 agent_stats, signal, usage

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CLAUDE_DIR, listSessions, findTranscript, TranscriptTail, subagentTranscript, lastUsage, UsageTail } from './sessions.mjs';
import { readRoster, readTasks } from './roster.mjs';
import { classify, outcome } from './signals.mjs';
import { WorkerPool } from './workers.mjs';
import { listLibrary, importRepo, removeSource, getDefinition } from './library.mjs';
import { hooksInstalled, hooksCurrent, installHooks, uninstallHooks } from './hooks-config.mjs';
import { BRIDGE_PORT, tokenFile, attachmentsDir } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = process.env.CLAUDIO_FAKE === '1';

export const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const log = (...parts) => process.stderr.write(parts.join(' ') + '\n');

// ---------- token ----------
function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(tokenFile(), 'utf8')).token;
  } catch {
    const token = crypto.randomBytes(24).toString('hex');
    fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
    fs.writeFileSync(tokenFile(), JSON.stringify({ token }));
    return token;
  }
}
const TOKEN = loadToken();

// ---------- state ----------
// answerInOffice: hold permission prompts and questions for the office.
// askQuestions: when false, AskUserQuestion is denied and Claude decides on its own.
// askEveryTask: office messages ask Claude to check in with a short question before starting.
const options = { answerInOffice: true, askQuestions: true, askEveryTask: false };

const NO_QUESTIONS =
  'The user switched questions off in Claudio Office settings. Do not ask; pick the sensible option, ' +
  'write down your decision and a short reason, then carry on.';
const ASK_FIRST = '\n\n(Before you start, if any point depends on the user, ask a short multiple-choice question with AskUserQuestion.)';
let attached = null; // { sessionId, tail, busy, subTails: Map<agentId, { tail, timer }> }
const pending = new Map(); // requestId -> { resolve, kind, input }
const queues = new Map(); // sessionId -> [{ id, text, target }]
const waiters = new Map(); // sessionId -> res
const knownTranscripts = new Map(); // sessionId -> transcript_path (hook'lardan)

const isAttached = (sessionId) => attached?.sessionId === sessionId;
// Office agents: their own headless sessions, created and resumed by the bridge.
const pool = new WorkerPool((evt) => emit(evt));

// ---------- session list ----------
// Sessions the office is not attached to still send hooks; remember which of them are
// waiting for the user so the office can point at them.
const waiting = new Map(); // sessionId -> 'permission' | 'question' | 'done'

function trackWaiting(sessionId, event, body) {
  const before = waiting.get(sessionId) ?? null;
  if (event === 'PermissionRequest') waiting.set(sessionId, 'permission');
  else if (event === 'PreToolUse' && body.tool_name === 'AskUserQuestion') waiting.set(sessionId, 'question');
  else if (event === 'Notification' && body.notification_type === 'permission_prompt') waiting.set(sessionId, before ?? 'permission');
  // A finished turn waits for the user too, but quietly: the office marks it without blinking.
  else if (event === 'Stop') waiting.set(sessionId, 'done');
  else if (['PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'SessionEnd', 'SessionStart'].includes(event)) waiting.delete(sessionId);
  else if (event === 'PreToolUse') waiting.delete(sessionId);
  if ((waiting.get(sessionId) ?? null) !== before) pollSessions();
}

let lastList = '';
function pollSessions() {
  const list = (FAKE ? fakeSessions() : listSessions()).filter((x) => !pool.isWorkerSession(x.sessionId)).map((x) => ({ ...x, waiting: isAttached(x.sessionId) ? null : waiting.get(x.sessionId) ?? null }));
  const key = JSON.stringify(list);
  if (key !== lastList) {
    lastList = key;
    emit({ type: 'sessions', list });
  }
}

// ---------- message queue ----------
function queueFor(sessionId) {
  if (!queues.has(sessionId)) queues.set(sessionId, []);
  return queues.get(sessionId);
}

/** Takes the messages for a target off the queue. target null: the main agent; a string: that subagent. */
function takeMessages(sessionId, target) {
  const queue = queues.get(sessionId);
  if (!queue?.length) return [];
  const taken = queue.filter((m) => (m.target ?? null) === (target ?? null));
  queues.set(sessionId, queue.filter((m) => !taken.includes(m)));
  return taken;
}

const formatMessages = (msgs) =>
  `The user wrote from Claudio Office:\n${msgs.map((m) => `- ${m.text}`).join('\n')}`;

function markDelivered(msgs, via) {
  for (const m of msgs) emit({ type: 'delivered', id: m.id, via });
}

function wakeWaiter(sessionId) {
  const res = waiters.get(sessionId);
  if (!res) return;
  waiters.delete(sessionId);
  // A waiter whose connection is already gone cannot take the messages; leave them queued.
  if (!canReply(res)) return;
  const msgs = takeMessages(sessionId, null);
  if (!msgs.length) {
    waiters.set(sessionId, res);
    return;
  }
  // Delivered only once the reply is flushed; a connection that closes first puts the
  // messages back at the front of the queue for the next hook or waiter.
  let flushed = false;
  res.once('finish', () => {
    flushed = true;
    markDelivered(msgs, 'wake-up');
  });
  res.once('close', () => {
    if (!flushed) requeue(sessionId, msgs);
  });
  replyWait(res, { kind: 'message', text: formatMessages(msgs) });
}

function requeue(sessionId, msgs) {
  if (!isAttached(sessionId)) return;
  queueFor(sessionId).unshift(...msgs);
}

const canReply = (res) => !res.writableEnded && !res.destroyed && res.socket?.writable !== false;

/** Reply to the waiter: { kind: 'message', text } | { kind: 'timeout' } | { kind: 'superseded' } */
function replyWait(res, payload) {
  if (canReply(res)) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
}

// ---------- permission and question requests ----------
function holdRequest(kind, sessionId, body, res, agentId = body.agent_id ?? null) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null, 'timed out'), 590_000);
    function finish(output, why) {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      clearTimeout(timer);
      if (why) emit({ type: 'request_cancelled', requestId, why });
      resolve(output ?? {});
    }
    pending.set(requestId, { finish, kind, input: body.tool_input, suggestions: body.permission_suggestions ?? null });
    // If Claude Code drops the request itself (e.g. answered in the terminal), remove the card.
    res.on('close', () => finish(null, 'the session dropped the request'));
    emit({
      type: 'request',
      requestId,
      kind,
      sessionId,
      toolName: body.tool_name,
      input: body.tool_input,
      agentId,
      agentType: body.agent_type ?? null,
      suggestions: body.permission_suggestions ?? null,
    });
  });
}

function answer({ requestId, behavior, answers, mode, message }) {
  const entry = pending.get(requestId);
  if (!entry) return;
  if (behavior === 'terminal') return entry.finish({}); // leave the decision to the terminal
  if (entry.kind === 'question') {
    return entry.finish(behavior === 'allow'
      ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...entry.input, answers } } }
      : {});
  }
  // "always": allow and apply the rule Claude Code itself suggested for this tool (session scope).
  const always = behavior === 'always';
  const decision = { behavior: always ? 'allow' : behavior };
  if (always && entry.suggestions?.length) decision.updatedPermissions = entry.suggestions;
  if (behavior === 'allow' && mode) decision.updatedPermissions = [{ type: 'setMode', mode, destination: 'session' }];
  if (behavior === 'deny') decision.message = message || 'The user denied this from Claudio Office.';
  entry.finish({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
}

// ---------- busy tracking and subagent transcripts ----------

/** Tells the office whether queued messages will arrive at the next step or wake the session. */
function setBusy(busy) {
  if (!attached || attached.busy === busy) return;
  attached.busy = busy;
  emit({ type: 'busy', busy });
}

/** Tail a subagent's own transcript so its panel can show what it says. The file appears shortly after SubagentStart. */
function startSubagentTail(sessionId, agentId) {
  const main = knownTranscripts.get(sessionId) ?? findTranscript(sessionId);
  if (!main || !attached || attached.subTails.has(agentId)) return;
  const file = subagentTranscript(main, sessionId, agentId);
  const entry = { tail: null, timer: null };
  attached.subTails.set(agentId, entry);
  let tries = 0;
  const open = () => {
    if (!isAttached(sessionId)) return;
    if (!fs.existsSync(file)) {
      if (++tries < 60) entry.timer = setTimeout(open, 500);
      return;
    }
    entry.tail = new TranscriptTail(file, (item) => isAttached(sessionId) && emit({ type: 'agent_chat', agentId, ...item }), { sidechain: true });
    for (const item of entry.tail.start(30)) emit({ type: 'agent_chat', agentId, ...item });
  };
  open();
}

function stopSubagentTail(agentId) {
  const entry = attached?.subTails.get(agentId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.tail?.flushAndStop();
  attached.subTails.delete(agentId);
  // The finished subagent's model and context size, from its own transcript.
  const main = knownTranscripts.get(attached.sessionId) ?? findTranscript(attached.sessionId);
  const usage = main && lastUsage(subagentTranscript(main, attached.sessionId, agentId));
  if (usage) emit({ type: 'agent_stats', agentId, model: usage.model, tokens: usage.context });
}

// ---------- roster and task list ----------
function sendRoster() {
  if (!attached) return;
  const cwd = attached.cwd || (FAKE ? '' : listSessions().find((s) => s.sessionId === attached.sessionId)?.cwd) || '';
  emit({ type: 'roster', ...readRoster(cwd) });
}

let lastTasks = '';
function pollTasks() {
  if (!attached || FAKE) return;
  const tasks = readTasks(attached.sessionId);
  const key = JSON.stringify(tasks);
  if (key === lastTasks) return;
  lastTasks = key;
  emit({ type: 'tasks', sessionId: attached.sessionId, tasks });
}
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite']);

// ---------- signals: deploys, builds, tests and pushes ----------
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const runningSignals = new Map(); // tool call -> signals classified at PreToolUse
const signalKey = (b) => b.tool_use_id ?? `${b.agent_id ?? 'main'}:${b.tool_input?.command ?? ''}`;

function responseText(r) {
  if (!r) return '';
  if (typeof r === 'string') return r.slice(-20_000);
  return [r.stdout, r.stderr, r.output, typeof r.content === 'string' ? r.content : null].filter((x) => typeof x === 'string').join('\n').slice(-20_000);
}

function trackSignals(event, body) {
  if (!SHELL_TOOLS.has(body.tool_name)) return;
  const agentId = body.agent_id ?? null;
  if (event === 'PreToolUse') {
    const signals = classify(body.tool_input?.command);
    if (!signals.length) return;
    runningSignals.set(signalKey(body), signals);
    if (runningSignals.size > 200) runningSignals.delete(runningSignals.keys().next().value);
    emit({ type: 'signal', phase: 'start', agentId, signals });
    return;
  }
  if (event !== 'PostToolUse' && event !== 'PostToolUseFailure') return;
  const key = signalKey(body);
  const signals = runningSignals.get(key) ?? classify(body.tool_input?.command);
  runningSignals.delete(key);
  // A background command has no outcome yet when its PostToolUse fires.
  if (!signals.length || body.tool_input?.run_in_background) return;
  const results = outcome(signals, {
    ok: event === 'PostToolUse',
    output: responseText(body.tool_response),
    error: typeof body.error === 'string' ? body.error : '',
  });
  emit({ type: 'signal', phase: 'end', agentId, signals: results, interrupted: Boolean(body.is_interrupt) });
}

// ---------- usage meters ----------
let lastUsageKey = '';
let usageAt = 0;
let usageTimer = null;
function pollUsage(force = false) {
  if (!attached || FAKE) return;
  // At most one read every 3 s; a burst of hooks ends in one trailing read.
  const wait = 3000 - (Date.now() - usageAt);
  if (!force && wait > 0) {
    usageTimer ??= setTimeout(() => { usageTimer = null; pollUsage(true); }, wait);
    return;
  }
  usageAt = Date.now();
  if (!attached.usage) {
    const file = knownTranscripts.get(attached.sessionId) ?? findTranscript(attached.sessionId);
    if (!file) return;
    attached.usage = new UsageTail(file);
  }
  attached.usage.poll();
  const snap = attached.usage.snapshot();
  if (!snap) return;
  const key = JSON.stringify(snap);
  if (key === lastUsageKey) return;
  lastUsageKey = key;
  emit({ type: 'usage', sessionId: attached.sessionId, ...snap });
}

// ---------- hooks ----------
const pick = (b) => ({
  event: b.hook_event_name,
  sessionId: b.session_id,
  agent_id: b.agent_id ?? null,
  agent_type: b.agent_type ?? null,
  tool_name: b.tool_name ?? null,
  tool_input: b.tool_input ?? null,
  prompt: b.prompt ?? null,
  permission_mode: b.permission_mode ?? null,
  notification_type: b.notification_type ?? null,
  message: b.message ?? null,
  // PostToolUseFailure carries the error, StopFailure the API error kind.
  error: typeof b.error === 'string' ? b.error.slice(0, 400) : null,
  trigger: b.trigger ?? null,
  task_subject: typeof b.task_subject === 'string' ? b.task_subject.slice(0, 140) : null,
});

/** Hooks from an office agent's own session: requests go to the office, messages land. */
function workerHook(worker, event, body, res) {
  const agentId = `w:${worker.id}`;
  switch (event) {
    case 'PermissionRequest':
      // A headless session cannot ask in a terminal, so the office always answers.
      return holdRequest('permission', body.session_id, body, res, agentId);
    case 'PreToolUse':
      if (body.tool_name !== 'AskUserQuestion') return {};
      if (!options.askQuestions) {
        emit({ type: 'decided_alone', agentId, question: body.tool_input?.questions?.[0]?.question ?? '' });
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: NO_QUESTIONS } };
      }
      return holdRequest('question', body.session_id, body, res, agentId);
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      // A failed call is still a step: queued messages land there instead of waiting for the next success.
      const text = pool.takeQueued(body.session_id);
      return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : {};
    }
    case 'Stop': {
      const text = pool.takeQueued(body.session_id);
      return text ? { decision: 'block', reason: text } : {};
    }
    default:
      return {};
  }
}

function workerCwd() {
  if (attached?.cwd) return attached.cwd;
  if (attached) return listSessions().find((s) => s.sessionId === attached.sessionId)?.cwd ?? null;
  return null;
}

async function workerCommand(command) {
  switch (command.cmd) {
    case 'workers':
      return emit(pool.snapshot());
    case 'worker_add': {
      const cwd = workerCwd();
      const def = getDefinition(command.key, cwd);
      if (!def) throw new Error('This agent is not in the library.');
      pool.add(def, { defKey: command.key, cwd });
      return;
    }
    case 'worker_remove':
      return pool.remove(command.id);
    case 'worker_stop':
      return pool.stop(command.id);
    case 'worker_send': {
      const w = pool.get(command.id);
      if (!w) throw new Error('This agent is no longer in the office.');
      const files = saveAttachments(`worker-${w.id}`, command.attachments ?? []);
      const text = files.length ? `${command.text}\n\nAttached files (open them with the Read tool):\n${files.map((f) => `- ${f}`).join('\n')}` : command.text;
      return pool.send(command.id, text, command.clientId ?? null);
    }
    case 'library':
      return emit({ type: 'library', ...listLibrary(workerCwd()) });
    case 'library_import': {
      emit({ type: 'library_progress', url: command.url, busy: true });
      try {
        const r = await importRepo(command.url);
        emit({ type: 'library_progress', url: command.url, busy: false, imported: r });
      } catch (err) {
        emit({ type: 'library_progress', url: command.url, busy: false, error: err.message });
      }
      return emit({ type: 'library', ...listLibrary(workerCwd()) });
    }
    case 'library_remove':
      removeSource(command.id);
      return emit({ type: 'library', ...listLibrary(workerCwd()) });
    case 'meeting_start':
      return pool.meetingStart(command.topic, command.participants ?? []);
    case 'meeting_interject':
      return pool.meetingInterject(command.text);
    case 'meeting_end':
      return pool.meetingEnd();
    default:
      return false;
  }
}

// What the diagnostics panel shows about the hook pipeline.
const hookStats = { seen: 0, lastAt: null, lastEvent: null };

export async function handleHook(body, res) {
  const sessionId = body.session_id;
  const event = body.hook_event_name;
  hookStats.seen += 1;
  hookStats.lastAt = Date.now();
  hookStats.lastEvent = event ?? null;
  const worker = pool.bySession(sessionId);
  if (worker) return workerHook(worker, event, body, res);
  if (body.transcript_path) knownTranscripts.set(sessionId, body.transcript_path);
  if (!isAttached(sessionId)) {
    trackWaiting(sessionId, event, body);
    if (event === 'SessionStart' || event === 'SessionEnd') pollSessions();
    return {};
  }
  waiting.delete(sessionId);
  emit({ type: 'hook', ...pick(body) });
  if (event === 'TaskCreated' || event === 'TaskCompleted' || (event === 'PostToolUse' && TASK_TOOLS.has(body.tool_name))) setTimeout(pollTasks, 250);
  trackSignals(event, body);
  if (event === 'Stop' || event === 'PostToolUse' || event === 'UserPromptSubmit' || event === 'PostCompact') setTimeout(pollUsage, 300);
  if (event === 'CwdChanged' && typeof body.new_cwd === 'string' && body.new_cwd) {
    attached.cwd = body.new_cwd;
    sendRoster();
  }
  if (event === 'UserPromptSubmit' || event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure') setBusy(true);
  if (event === 'SubagentStart' && body.agent_id) startSubagentTail(sessionId, body.agent_id);
  if (event === 'SubagentStop' && body.agent_id) stopSubagentTail(body.agent_id);

  switch (event) {
    case 'PermissionRequest':
      if (!options.answerInOffice) return {};
      return holdRequest('permission', sessionId, body, res);
    case 'PreToolUse':
      if (body.tool_name !== 'AskUserQuestion') return {};
      if (!options.askQuestions) {
        emit({ type: 'decided_alone', agentId: body.agent_id ?? null, question: body.tool_input?.questions?.[0]?.question ?? '' });
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: NO_QUESTIONS } };
      }
      if (options.answerInOffice) return holdRequest('question', sessionId, body, res);
      return {};
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      // After a failed call too: a run of failing commands must not hold the user's message back.
      const msgs = takeMessages(sessionId, body.agent_id ?? null);
      if (!msgs.length) return {};
      markDelivered(msgs, 'after a tool');
      return { hookSpecificOutput: { hookEventName: event, additionalContext: formatMessages(msgs) } };
    }
    case 'SubagentStop': {
      const msgs = takeMessages(sessionId, body.agent_id);
      if (!msgs.length) {
        // No hook of this subagent will fire again, so later messages to it cannot land.
        if (body.agent_id) attached.finished.add(body.agent_id);
        return {};
      }
      markDelivered(msgs, 'subagent finished');
      return { decision: 'block', reason: formatMessages(msgs) };
    }
    case 'Stop': {
      const msgs = takeMessages(sessionId, null);
      if (!msgs.length) {
        setBusy(false);
        return {};
      }
      markDelivered(msgs, 'end of turn');
      return { decision: 'block', reason: formatMessages(msgs) };
    }
    case 'SessionEnd':
      detach('The session ended.');
      return {};
    default:
      return {};
  }
}

// ---------- attaching ----------
function attach(sessionId) {
  if (attached) detach();
  const transcript = knownTranscripts.get(sessionId) ?? findTranscript(sessionId);
  const session = (FAKE ? fakeSessions() : listSessions()).find((s) => s.sessionId === sessionId);
  // The session list knows whether the session is mid-turn right now.
  attached = { sessionId, cwd: session?.cwd ?? '', tail: null, busy: session?.status === 'busy', subTails: new Map(), finished: new Set() };
  emit({ type: 'attached', sessionId, name: session?.name ?? '', cwd: session?.cwd ?? '', busy: attached.busy });
  lastTasks = '';
  lastUsageKey = '';
  sendRoster();
  pollTasks();
  pollUsage(true);
  if (FAKE) return startFake(sessionId);
  if (!transcript) return emit({ type: 'history', items: [], note: 'No transcript yet; it appears after the first message.' });
  const tail = new TranscriptTail(transcript, (item) => isAttached(sessionId) && emit({ type: 'chat', ...item }));
  attached.tail = tail;
  emit({ type: 'history', items: tail.start(40) });
}

function detach(why) {
  if (!attached) return;
  attached.tail?.stop();
  for (const agentId of [...attached.subTails.keys()]) stopSubagentTail(agentId);
  for (const entry of pending.values()) entry.finish({}, null);
  const { sessionId } = attached;
  attached = null;
  // Messages that never reached the session would otherwise land, out of date, on a later attach.
  queues.delete(sessionId);
  emit({ type: 'detached', sessionId, why: why ?? null });
}

// ---------- HTTP server ----------
const MAX_BODY = 5_000_000;
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      data += d;
      // Destroying the request alone never ends the promise and leaves the handler hanging.
      if (data.length > MAX_BODY) {
        req.destroy();
        reject(Object.assign(new Error('hook body too large'), { tooLarge: true }));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.headers['x-claudio-token'] !== TOKEN) return res.writeHead(401).end();
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'POST' && url.pathname === '/hook') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const out = await handleHook(body, res);
      if (!res.writableEnded) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out ?? {}));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/wait') {
      const sessionId = url.searchParams.get('session');
      if (pool.isWorkerSession(sessionId)) return replyWait(res, { kind: 'none' });
      const previous = waiters.get(sessionId);
      if (previous) replyWait(previous, { kind: 'superseded' });
      waiters.set(sessionId, res);
      const timer = setTimeout(() => {
        if (waiters.get(sessionId) === res) waiters.delete(sessionId);
        replyWait(res, { kind: 'timeout' });
      }, 25 * 60_000);
      res.on('close', () => {
        clearTimeout(timer);
        if (waiters.get(sessionId) === res) waiters.delete(sessionId);
      });
      wakeWaiter(sessionId);
      return;
    }
    res.writeHead(404).end();
  } catch (err) {
    if (err?.tooLarge) return;
    log('[bridge]', err.stack ?? err);
    if (!res.writableEnded) res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  }
});

// Hook clients may reuse the connection; a short keep-alive leads to an ECONNRESET race.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.on('error', (err) => emit({ type: 'error', message: `The bridge could not open port ${BRIDGE_PORT}: ${err.message}` }));
server.listen(BRIDGE_PORT, '127.0.0.1');

// ---------- commands ----------
let msgSeq = 0;
const MAX_FILES = 6;
const MAX_BYTES = 15 * 1024 * 1024;

/** Writes attachments to disk and returns their paths. Hooks carry only text, so Claude opens the files with Read. */
function saveAttachments(sessionId, attachments) {
  if (attachments.length > MAX_FILES) throw new Error(`You can attach at most ${MAX_FILES} files.`);
  const dir = path.join(attachmentsDir(), sessionId.slice(0, 8));
  fs.mkdirSync(dir, { recursive: true });
  return attachments.map((a, i) => {
    const data = Buffer.from(a.data ?? '', 'base64');
    if (data.length > MAX_BYTES) throw new Error(`${a.name} is larger than 15 MB.`);
    const safe = String(a.name || 'file').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80);
    const file = path.join(dir, `${Date.now()}-${i}-${safe}`);
    fs.writeFileSync(file, data);
    return file;
  });
}

function send({ text, target, attachments = [], clientId }) {
  if (!attached) return emit({ type: 'error', message: 'Attach to a session first.' });
  if (target && attached.finished.has(target)) {
    return emit({ type: 'error', message: 'This subagent has finished, so the message cannot reach it. Write to Claude instead.', clientId });
  }
  let files = [];
  try {
    files = saveAttachments(attached.sessionId, attachments);
  } catch (err) {
    return emit({ type: 'error', message: err.message, clientId });
  }
  let body = files.length
    ? `${text}\n\nAttached files (open them with the Read tool):\n${files.map((f) => `- ${f}`).join('\n')}`
    : text;
  // Only the main agent can ask the user: AskUserQuestion is not available inside subagents.
  if (options.askQuestions && options.askEveryTask && !target) body += ASK_FIRST;
  const msg = { id: `m${++msgSeq}`, text: body, target: target ?? null };
  queueFor(attached.sessionId).push(msg);
  emit({ type: 'queued', id: msg.id, text, target: msg.target, clientId: clientId ?? null, files: files.map((f) => path.basename(f)), busy: attached.busy });
  if (!target) wakeWaiter(attached.sessionId);
  if (FAKE) fakeDeliver(attached.sessionId);
}

function diagnostics() {
  const waiterPath = path.join(here, 'claudio-waiter.mjs');
  const installed = FAKE || hooksInstalled();
  return {
    version: process.env.CLAUDIO_VERSION || null,
    node: process.version,
    nodeOk: Number(process.versions.node.split('.')[0]) >= 20,
    port: BRIDGE_PORT,
    claudeDir: CLAUDE_DIR,
    sidecarDir: here,
    hooksInstalled: installed,
    hooksCurrent: installed && (FAKE || hooksCurrent({ token: TOKEN, waiterPath })),
    hooksSeen: hookStats.seen,
    lastHookAt: hookStats.lastAt,
    lastHookEvent: hookStats.lastEvent,
    sessions: (FAKE ? fakeSessions() : listSessions()).length,
    attached: attached?.sessionId ?? null,
    uptimeMs: Math.round(process.uptime() * 1000),
  };
}

/** Rewrite our hooks if they belong to an older install of the office. */
function refreshHooks() {
  if (FAKE || !hooksInstalled()) return;
  const waiterPath = path.join(here, 'claudio-waiter.mjs');
  if (hooksCurrent({ token: TOKEN, waiterPath })) return;
  try {
    installHooks({ token: TOKEN, waiterPath });
  } catch (err) {
    log('could not refresh the hooks', err.message);
  }
}

function hooksStatus(error) {
  emit({ type: 'hooks_status', installed: FAKE || hooksInstalled(), error: error ?? null });
}

async function handle(command) {
  if (/^(workers?|worker_|library|meeting_)/.test(command.cmd ?? '')) {
    try {
      return await workerCommand(command);
    } catch (err) {
      return emit({ type: 'error', message: String(err?.message ?? err), clientId: command.clientId ?? null });
    }
  }
  switch (command.cmd) {
    case 'status':
      emit({ type: 'ready', fake: FAKE, attached: attached?.sessionId ?? null, ...options });
      lastList = '';
      pollSessions();
      refreshHooks();
      emit(pool.snapshot());
      return hooksStatus();
    case 'attach':
      return attach(command.sessionId);
    case 'detach':
      return detach();
    case 'send':
      return send(command);
    case 'answer':
      return answer(command);
    case 'roster':
      return sendRoster();
    case 'diagnostics':
      return emit({ type: 'diagnostics', ...diagnostics() });
    case 'install_hooks':
      try {
        installHooks({ token: TOKEN, waiterPath: path.join(here, 'claudio-waiter.mjs') });
        return hooksStatus();
      } catch (err) {
        return hooksStatus(err.message);
      }
    case 'uninstall_hooks':
      try {
        uninstallHooks();
        return hooksStatus();
      } catch (err) {
        return hooksStatus(err.message);
      }
    case 'set_option':
      for (const key of Object.keys(options)) {
        if (typeof command.options?.[key] === 'boolean') options[key] = command.options[key];
      }
      return emit({ type: 'options', ...options });
    default:
      return emit({ type: 'error', message: `Unknown command: ${command.cmd}` });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return emit({ type: 'error', message: 'Invalid command line.' });
  }
  handle(command).catch((err) => emit({ type: 'error', message: String(err?.message ?? err) }));
});

process.stdin.on('end', () => {
  pool.shutdown();
  process.exit(0);
});

// ---------- demo mode ----------
let fakeModule = null;
function fakeSessions() {
  return fakeModule?.sessions() ?? [];
}
function startFake(sessionId) {
  fakeModule.play({ sessionId, emit, handleHook, isAttached });
}
function fakeDeliver(sessionId) {
  fakeModule.deliver({ sessionId, handleHook });
}
if (FAKE) fakeModule = await import('./fake.mjs');

setInterval(pollSessions, 2000);
// No hook fires when a task goes in progress, so the files are polled as well.
setInterval(pollTasks, 2000);
// Tokens per minute fall back to zero while the session sits idle.
setInterval(() => pollUsage(true), 15_000);
emit({ type: 'ready', fake: FAKE, attached: null, ...options });
pollSessions();
// Repair hooks from an older install before reporting them.
refreshHooks();
hooksStatus();
