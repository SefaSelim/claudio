// Claudio Ofis köprüsü. Tauri bu dosyayı `node` ile başlatır; stdin/stdout'ta satır satır JSON konuşur.
//
// Claude Code oturumlarına API anahtarı olmadan bağlanır:
//  - Oturum listesi: ~/.claude/sessions
//  - Canlı olaylar: ~/.claude/settings.json'a eklenen http hook'ları bu köprüye POST eder
//  - Sohbet: bağlı oturumun kayıt (transcript) dosyası izlenir
//  - İzin ve AskUserQuestion: PermissionRequest / PreToolUse hook'u ofisten cevap gelene kadar bekletilir
//  - Mesaj: tur sürerken PostToolUse additionalContext, tur biterken Stop "block",
//    oturum boşta ise claudio-waiter.mjs (asyncRewake) ile iletilir
//
// Gelen komutlar: status, attach {sessionId}, detach, send {text, target?}, answer {requestId, ...},
//                 install_hooks, uninstall_hooks, set_option {answerInOffice}
// Giden olaylar:  ready, sessions, attached, detached, history, chat, hook, request,
//                 request_cancelled, queued, delivered, hooks_status, error

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { listSessions, findTranscript, TranscriptTail, subagentTranscript } from './sessions.mjs';
import { hooksInstalled, installHooks, uninstallHooks } from './hooks-config.mjs';
import { BRIDGE_PORT, tokenFile, attachmentsDir } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = process.env.CLAUDIO_FAKE === '1';

export const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const log = (...parts) => process.stderr.write(parts.join(' ') + '\n');

// ---------- belirteç ----------
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

// ---------- durum ----------
const options = { answerInOffice: true };
let attached = null; // { sessionId, tail, busy, subTails: Map<agentId, { tail, timer }> }
const pending = new Map(); // requestId -> { resolve, kind, input }
const queues = new Map(); // sessionId -> [{ id, text, target }]
const waiters = new Map(); // sessionId -> res
const knownTranscripts = new Map(); // sessionId -> transcript_path (hook'lardan)

const isAttached = (sessionId) => attached?.sessionId === sessionId;

// ---------- oturum listesi ----------
let lastList = '';
function pollSessions() {
  const list = FAKE ? fakeSessions() : listSessions();
  const key = JSON.stringify(list);
  if (key !== lastList) {
    lastList = key;
    emit({ type: 'sessions', list });
  }
}

// ---------- mesaj kuyruğu ----------
function queueFor(sessionId) {
  if (!queues.has(sessionId)) queues.set(sessionId, []);
  return queues.get(sessionId);
}

/** Hedefe uyan mesajları kuyruktan çıkarır. target null: ana ajan; string: o alt ajan. */
function takeMessages(sessionId, target) {
  const queue = queues.get(sessionId);
  if (!queue?.length) return [];
  const taken = queue.filter((m) => (m.target ?? null) === (target ?? null));
  queues.set(sessionId, queue.filter((m) => !taken.includes(m)));
  return taken;
}

const formatMessages = (msgs) =>
  `Kullanıcı Claudio Ofis'ten yazdı:\n${msgs.map((m) => `- ${m.text}`).join('\n')}`;

function markDelivered(msgs, via) {
  for (const m of msgs) emit({ type: 'delivered', id: m.id, via });
}

function wakeWaiter(sessionId) {
  const res = waiters.get(sessionId);
  if (!res) return;
  const msgs = takeMessages(sessionId, null);
  if (!msgs.length) return;
  waiters.delete(sessionId);
  replyWait(res, { kind: 'message', text: formatMessages(msgs) });
  markDelivered(msgs, 'uyandırma');
}

/** Bekçiye cevap: { kind: 'message', text } | { kind: 'timeout' } | { kind: 'superseded' } */
function replyWait(res, payload) {
  if (!res.writableEnded) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
}

// ---------- izin ve soru istekleri ----------
function holdRequest(kind, sessionId, body, res) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(null, 'zaman aşımı'), 590_000);
    function finish(output, why) {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      clearTimeout(timer);
      if (why) emit({ type: 'request_cancelled', requestId, why });
      resolve(output ?? {});
    }
    pending.set(requestId, { finish, kind, input: body.tool_input });
    // Claude Code isteği kendisi bırakırsa (ör. terminalden cevaplandı) kartı kaldır.
    res.on('close', () => finish(null, 'oturum isteği bıraktı'));
    emit({
      type: 'request',
      requestId,
      kind,
      sessionId,
      toolName: body.tool_name,
      input: body.tool_input,
      agentId: body.agent_id ?? null,
      agentType: body.agent_type ?? null,
      suggestions: body.permission_suggestions ?? null,
    });
  });
}

function answer({ requestId, behavior, answers, mode, message }) {
  const entry = pending.get(requestId);
  if (!entry) return;
  if (behavior === 'terminal') return entry.finish({}); // kararı terminale bırak
  if (entry.kind === 'question') {
    return entry.finish(behavior === 'allow'
      ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { ...entry.input, answers } } }
      : {});
  }
  const decision = { behavior };
  if (behavior === 'allow' && mode) decision.updatedPermissions = [{ type: 'setMode', mode, destination: 'session' }];
  if (behavior === 'deny') decision.message = message || 'Kullanıcı Claudio Ofis\'ten reddetti.';
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
}

// ---------- hook'lar ----------
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
});

/** Bir hook olayını işler ve Claude Code'a dönülecek JSON'u verir. */
export async function handleHook(body, res) {
  const sessionId = body.session_id;
  const event = body.hook_event_name;
  if (body.transcript_path) knownTranscripts.set(sessionId, body.transcript_path);
  if (!isAttached(sessionId)) {
    if (event === 'SessionStart' || event === 'SessionEnd') pollSessions();
    return {};
  }
  emit({ type: 'hook', ...pick(body) });
  if (event === 'UserPromptSubmit' || event === 'PreToolUse' || event === 'PostToolUse') setBusy(true);
  if (event === 'SubagentStart' && body.agent_id) startSubagentTail(sessionId, body.agent_id);
  if (event === 'SubagentStop' && body.agent_id) stopSubagentTail(body.agent_id);

  switch (event) {
    case 'PermissionRequest':
      if (!options.answerInOffice) return {};
      return holdRequest('permission', sessionId, body, res);
    case 'PreToolUse':
      if (body.tool_name === 'AskUserQuestion' && options.answerInOffice) return holdRequest('question', sessionId, body, res);
      return {};
    case 'PostToolUse': {
      const msgs = takeMessages(sessionId, body.agent_id ?? null);
      if (!msgs.length) return {};
      markDelivered(msgs, 'araç sonrası');
      return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: formatMessages(msgs) } };
    }
    case 'SubagentStop': {
      const msgs = takeMessages(sessionId, body.agent_id);
      if (!msgs.length) return {};
      markDelivered(msgs, 'alt ajan bitişi');
      return { decision: 'block', reason: formatMessages(msgs) };
    }
    case 'Stop': {
      const msgs = takeMessages(sessionId, null);
      if (!msgs.length) {
        setBusy(false);
        return {};
      }
      markDelivered(msgs, 'tur sonu');
      return { decision: 'block', reason: formatMessages(msgs) };
    }
    case 'SessionEnd':
      detach('Oturum kapandı.');
      return {};
    default:
      return {};
  }
}

// ---------- bağlanma ----------
function attach(sessionId) {
  if (attached) detach();
  const transcript = knownTranscripts.get(sessionId) ?? findTranscript(sessionId);
  const session = (FAKE ? fakeSessions() : listSessions()).find((s) => s.sessionId === sessionId);
  // The session list knows whether the session is mid-turn right now.
  attached = { sessionId, tail: null, busy: session?.status === 'busy', subTails: new Map() };
  emit({ type: 'attached', sessionId, name: session?.name ?? '', cwd: session?.cwd ?? '', busy: attached.busy });
  if (FAKE) return startFake(sessionId);
  if (!transcript) return emit({ type: 'history', items: [], note: 'Kayıt dosyası henüz yok; ilk mesajdan sonra görünür.' });
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
  emit({ type: 'detached', sessionId, why: why ?? null });
}

// ---------- HTTP sunucusu ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      data += d;
      if (data.length > 5_000_000) req.destroy();
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
    log('[köprü]', err.stack ?? err);
    if (!res.writableEnded) res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  }
});

// Hook istemcileri bağlantıyı yeniden kullanabilir; kısa keep-alive süresi ECONNRESET yarışına yol açıyor.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.on('error', (err) => emit({ type: 'error', message: `Köprü ${BRIDGE_PORT} portunu açamadı: ${err.message}` }));
server.listen(BRIDGE_PORT, '127.0.0.1');

// ---------- komutlar ----------
let msgSeq = 0;
const MAX_FILES = 6;
const MAX_BYTES = 15 * 1024 * 1024;

/** Ekleri diske yazar ve yollarını döndürür. Hook'lar yalnızca metin taşıyabildiği için Claude dosyaları Read ile açar. */
function saveAttachments(sessionId, attachments) {
  if (attachments.length > MAX_FILES) throw new Error(`En fazla ${MAX_FILES} dosya eklenebilir.`);
  const dir = path.join(attachmentsDir(), sessionId.slice(0, 8));
  fs.mkdirSync(dir, { recursive: true });
  return attachments.map((a, i) => {
    const data = Buffer.from(a.data ?? '', 'base64');
    if (data.length > MAX_BYTES) throw new Error(`${a.name} 15 MB'tan büyük.`);
    const safe = String(a.name || 'dosya').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80);
    const file = path.join(dir, `${Date.now()}-${i}-${safe}`);
    fs.writeFileSync(file, data);
    return file;
  });
}

function send({ text, target, attachments = [], clientId }) {
  if (!attached) return emit({ type: 'error', message: 'Önce bir oturuma bağlan.' });
  let files = [];
  try {
    files = saveAttachments(attached.sessionId, attachments);
  } catch (err) {
    return emit({ type: 'error', message: err.message, clientId });
  }
  const body = files.length
    ? `${text}\n\nEkli dosyalar (Read aracıyla açabilirsin):\n${files.map((f) => `- ${f}`).join('\n')}`
    : text;
  const msg = { id: `m${++msgSeq}`, text: body, target: target ?? null };
  queueFor(attached.sessionId).push(msg);
  emit({ type: 'queued', id: msg.id, text, target: msg.target, clientId: clientId ?? null, files: files.map((f) => path.basename(f)), busy: attached.busy });
  if (!target) wakeWaiter(attached.sessionId);
  if (FAKE) fakeDeliver(attached.sessionId);
}

function hooksStatus(error) {
  emit({ type: 'hooks_status', installed: FAKE || hooksInstalled(), error: error ?? null });
}

async function handle(command) {
  switch (command.cmd) {
    case 'status':
      emit({ type: 'ready', fake: FAKE, attached: attached?.sessionId ?? null, answerInOffice: options.answerInOffice });
      lastList = '';
      pollSessions();
      return hooksStatus();
    case 'attach':
      return attach(command.sessionId);
    case 'detach':
      return detach();
    case 'send':
      return send(command);
    case 'answer':
      return answer(command);
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
      Object.assign(options, command.options ?? {});
      return emit({ type: 'ready', fake: FAKE, attached: attached?.sessionId ?? null, answerInOffice: options.answerInOffice });
    default:
      return emit({ type: 'error', message: `Bilinmeyen komut: ${command.cmd}` });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    return emit({ type: 'error', message: 'Geçersiz komut satırı.' });
  }
  handle(command).catch((err) => emit({ type: 'error', message: String(err?.message ?? err) }));
});

process.stdin.on('end', () => process.exit(0));

// ---------- demo modu ----------
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
emit({ type: 'ready', fake: FAKE, attached: null, answerInOffice: options.answerInOffice });
pollSessions();
hooksStatus();
