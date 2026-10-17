import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Köprüden gelen olayları ofis durumuna çevirir.
// Ajan durumu hook'lardan, sohbet bağlı oturumun kayıt dosyasından, kartlar izin/soru isteklerinden gelir.

export const state = {
  ready: false,
  fake: false,
  hooksInstalled: false,
  hooksError: null,
  answerInOffice: true,
  sessions: [], // { sessionId, name, cwd, status, version, entrypoint, updatedAt }
  attached: null, // { sessionId, name, cwd }
  busy: false, // whether the attached session is mid-turn
  mode: null, // oturumun izin modu (hook girdisinden)
  agents: new Map(), // id -> { id, kind, type, label, description, state, text, steps }
  chat: [], // { role: 'user' | 'assistant' | 'system', text, pending?, via? }
  requests: [], // { requestId, kind: 'permission' | 'question', toolName, input, agentId }
  error: null,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(kind, extra = {}) {
  for (const fn of listeners) fn({ kind, ...extra });
}

// Development hooks: outside Tauri, commands go to a stand-in bridge and events can be injected.
let devSender = null;
export function useDevBridge(sender) {
  devSender = sender;
}
export function inject(evt) {
  onEvent(evt);
}

export function send(command) {
  if (devSender) return Promise.resolve(devSender(command));
  return invoke('sidecar_send', { line: JSON.stringify(command) }).catch((err) => {
    state.error = String(err);
    notify('error');
  });
}

// ---------- ajanlar ----------

const TOOL_STATE = {
  Read: 'read', Grep: 'read', Glob: 'read', LS: 'read', NotebookRead: 'read', WebFetch: 'read', WebSearch: 'read',
  Edit: 'write', MultiEdit: 'write', Write: 'write', NotebookEdit: 'write', TodoWrite: 'write',
  Bash: 'bash', PowerShell: 'bash', BashOutput: 'bash',
  Agent: 'talk', Task: 'talk', SendMessage: 'talk',
  AskUserQuestion: 'wait',
};

const base = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';
const clip = (s, n = 42) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

export function describeTool(name, input) {
  input = input ?? {};
  if (input.file_path || input.notebook_path) return `${name} · ${base(input.file_path ?? input.notebook_path)}`;
  if (input.pattern) return `${name} · ${clip(input.pattern, 30)}`;
  if (input.command) return `${name} · ${clip(input.command, 34)}`;
  if (input.url) {
    try { return `${name} · ${new URL(input.url).host}`; } catch { return `${name} · ${clip(input.url, 30)}`; }
  }
  if (input.query) return `${name} · ${clip(input.query, 30)}`;
  if (input.description) return `${name} · ${clip(input.description, 34)}`;
  return name;
}

const TYPE_LABEL = { 'general-purpose': 'Genel', Explore: 'Explore', Plan: 'Plan' };
function labelFor(type) {
  const baseLabel = TYPE_LABEL[type] ?? type ?? 'Ajan';
  const taken = [...state.agents.values()].filter((a) => a.label.startsWith(baseLabel)).length;
  return taken ? `${baseLabel} ${taken + 1}` : baseLabel;
}

function addAgent(agent) {
  const full = { state: 'think', text: '', steps: [], chat: [], description: '', ...agent };
  state.agents.set(full.id, full);
  notify('agent_added', { agent: full });
  return full;
}
function updateAgent(id, patch) {
  const agent = state.agents.get(id);
  if (!agent) return;
  Object.assign(agent, patch);
  notify('agent_updated', { agent });
}
function removeAgent(id) {
  const agent = state.agents.get(id);
  if (!agent) return;
  state.agents.delete(id);
  notify('agent_removed', { agent });
}
function ensureAgent(id, type) {
  if (state.agents.has(id)) return state.agents.get(id);
  if (id === 'main') return addAgent({ id: 'main', kind: 'main', type: 'main', label: 'Claude', state: 'done', text: 'Sıra sende' });
  return addAgent({ id, kind: 'sub', type, label: labelFor(type) });
}
function clearAgents() {
  for (const id of [...state.agents.keys()]) removeAgent(id);
}

// Ana ajanın Agent çağrılarındaki açıklamalar; SubagentStart'ta tipine göre eşlenir.
const pendingLaunches = [];
const now = () => new Date().toTimeString().slice(0, 5);
const say = (id, text) => notify('say', { id, text: clip(text, 70) });

function onHook(evt) {
  const id = evt.agent_id ?? 'main';
  if (evt.permission_mode && evt.permission_mode !== state.mode) {
    state.mode = evt.permission_mode;
    notify('status');
  }
  switch (evt.event) {
    case 'UserPromptSubmit':
      updateAgent('main', { state: 'think', text: 'Düşünüyor…' });
      break;
    case 'PreToolUse': {
      const agent = ensureAgent(id, evt.agent_type);
      const tool = evt.tool_name;
      if (id === 'main' && (tool === 'Agent' || tool === 'Task')) {
        pendingLaunches.push({ type: evt.tool_input?.subagent_type ?? 'general-purpose', description: evt.tool_input?.description ?? '' });
      }
      const detail = describeTool(tool, evt.tool_input);
      agent.steps.push({ time: now(), tool, detail, status: 'run' });
      if (agent.steps.length > 40) agent.steps.shift();
      updateAgent(id, { state: TOOL_STATE[tool] ?? 'think', text: detail });
      break;
    }
    case 'PostToolUse': {
      const agent = state.agents.get(id);
      const step = agent?.steps.findLast((s) => s.tool === evt.tool_name && s.status === 'run');
      if (step) step.status = 'done';
      if (agent && agent.state !== 'done') updateAgent(id, { state: 'think' });
      break;
    }
    case 'SubagentStart': {
      const i = pendingLaunches.findIndex((p) => p.type === evt.agent_type);
      const launch = i >= 0 ? pendingLaunches.splice(i, 1)[0] : null;
      const agent = ensureAgent(evt.agent_id, evt.agent_type);
      updateAgent(agent.id, { description: launch?.description ?? '', text: launch?.description || 'Başladı' });
      say(agent.id, launch?.description || 'Göreve başladım');
      break;
    }
    case 'SubagentStop':
      updateAgent(evt.agent_id, { state: 'done', text: 'Bitti' });
      say(evt.agent_id, 'Bitti, rapor Claude\'da');
      setTimeout(() => removeAgent(evt.agent_id), 6000);
      break;
    case 'Notification':
      if (evt.notification_type === 'idle_prompt') updateAgent('main', { state: 'done', text: 'Sıra sende' });
      break;
    case 'Stop':
      updateAgent('main', { state: 'done', text: 'Sıra sende' });
      break;
  }
}

function resetSessionView() {
  state.chat = [];
  state.requests = [];
  state.mode = null;
  pendingLaunches.length = 0;
  clearAgents();
}

function onEvent(evt) {
  switch (evt.type) {
    case 'ready':
      state.ready = true;
      state.fake = evt.fake;
      state.answerInOffice = evt.answerInOffice;
      // Sayfa yenilendiyse köprü hâlâ bir oturuma bağlı olabilir.
      if (evt.attached && !state.attached) {
        state.attached = { sessionId: evt.attached, name: '', cwd: '' };
        ensureAgent('main');
        state.chat.push({ role: 'system', text: 'Bağlantı sürüyor; önceki mesajlar bu pencerede yok.' });
        notify('chat');
      }
      notify('status');
      break;
    case 'sessions':
      state.sessions = evt.list;
      if (state.attached) {
        const s = evt.list.find((x) => x.sessionId === state.attached.sessionId);
        if (s) Object.assign(state.attached, { name: s.name, cwd: s.cwd });
      }
      notify('sessions');
      break;
    case 'hooks_status':
      state.hooksInstalled = evt.installed;
      state.hooksError = evt.error;
      notify('status');
      break;
    case 'attached':
      resetSessionView();
      state.attached = { sessionId: evt.sessionId, name: evt.name, cwd: evt.cwd };
      state.busy = Boolean(evt.busy);
      ensureAgent('main');
      if (state.busy) updateAgent('main', { state: 'think', text: 'Çalışıyor…' });
      notify('status');
      notify('chat');
      notify('requests');
      break;
    case 'detached':
      resetSessionView();
      state.attached = null;
      if (evt.why) state.error = evt.why;
      notify('status');
      notify('chat');
      notify('requests');
      break;
    case 'history':
      state.chat = [...evt.items, ...(evt.note ? [{ role: 'system', text: evt.note }] : [])];
      notify('chat');
      break;
    case 'chat':
      state.chat.push({ role: evt.role, text: evt.text });
      if (state.chat.length > 200) state.chat.shift();
      if (evt.role === 'assistant') say('main', evt.text);
      notify('chat');
      break;
    case 'hook':
      onHook(evt);
      break;
    case 'busy':
      state.busy = evt.busy;
      notify('busy');
      break;
    case 'agent_chat': {
      const agent = state.agents.get(evt.agentId);
      if (!agent) break;
      agent.chat.push({ role: evt.role === 'user' ? 'task' : 'assistant', text: evt.text });
      if (agent.chat.length > 100) agent.chat.shift();
      if (evt.role === 'assistant') say(agent.id, evt.text);
      notify('agent_chat', { id: agent.id });
      break;
    }
    case 'request': {
      const agentId = evt.agentId && state.agents.has(evt.agentId) ? evt.agentId : 'main';
      state.requests.push({ ...evt, agentId });
      updateAgent(agentId, { state: 'wait', text: evt.kind === 'question' ? 'Sana soruyor' : `İzin bekliyor · ${describeTool(evt.toolName, evt.input)}` });
      notify('requests');
      break;
    }
    case 'request_cancelled': {
      const req = state.requests.find((r) => r.requestId === evt.requestId);
      state.requests = state.requests.filter((r) => r.requestId !== evt.requestId);
      if (req) updateAgent(req.agentId, { state: 'think', text: 'Terminalde cevaplandı' });
      notify('requests');
      break;
    }
    case 'queued': {
      const target = evt.target ? state.agents.get(evt.target)?.label ?? 'alt ajan' : null;
      const files = outgoing.get(evt.clientId) ?? (evt.files ?? []).map((name) => ({ name, preview: null }));
      outgoing.delete(evt.clientId);
      // Where the message will land: the next step if the session is working, a wake-up if idle.
      const hint = evt.target ? 'bir sonraki adımında görecek' : evt.busy ? 'Claude meşgul · bir sonraki adımında görecek' : 'Claude boşta · uyandırılıyor';
      const item = { role: 'user', text: target ? `→ ${target}: ${evt.text}` : evt.text, pending: evt.id, hint, files };
      state.chat.push(item);
      // A message to a subagent also shows in that subagent's own chat.
      if (evt.target) state.agents.get(evt.target)?.chat.push(item);
      notify('chat');
      if (evt.target) notify('agent_chat', { id: evt.target });
      break;
    }
    case 'delivered': {
      const item = state.chat.find((m) => m.pending === evt.id);
      if (item) {
        item.pending = null;
        item.via = evt.via;
        notify('chat');
        for (const agent of state.agents.values()) if (agent.chat.includes(item)) notify('agent_chat', { id: agent.id });
      }
      break;
    }
    case 'sidecar_exit':
      resetSessionView();
      state.attached = null;
      state.ready = false;
      state.error = 'Köprü kapandı; ofisi yeniden başlat.';
      notify('status');
      notify('chat');
      notify('requests');
      break;
    case 'error':
      state.error = evt.message;
      if (evt.clientId) {
        outgoing.delete(evt.clientId);
        state.chat.push({ role: 'system', text: `Gönderilemedi: ${evt.message}` });
        notify('chat');
      }
      notify('error');
      break;
  }
}

// ---------- komutlar ----------

export const attach = (sessionId) => send({ cmd: 'attach', sessionId });
export const detach = () => send({ cmd: 'detach' });
export const installHooks = () => send({ cmd: 'install_hooks' });
export const uninstallHooks = () => send({ cmd: 'uninstall_hooks' });

export function setAnswerInOffice(value) {
  state.answerInOffice = value;
  return send({ cmd: 'set_option', options: { answerInOffice: value } });
}

// Gönderilen eklerin önizlemeleri; köprü 'queued' ile clientId'yi geri yollayınca sohbet öğesine bağlanır.
const outgoing = new Map(); // clientId -> [{ name, preview }]
let clientSeq = 0;

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * agentId 'main' değilse mesaj doğrudan o alt ajana (onun bir sonraki aracında) teslim edilir.
 * files: { file: File, preview?: string }[]
 */
export async function sendMessage(text, agentId = 'main', files = []) {
  const clientId = `c${++clientSeq}`;
  outgoing.set(clientId, files.map((f) => ({ name: f.file.name, preview: f.preview ?? null })));
  const attachments = await Promise.all(files.map(async (f) => ({ name: f.file.name, mime: f.file.type, data: await toBase64(f.file) })));
  return send({ cmd: 'send', text, target: agentId === 'main' ? null : agentId, attachments, clientId });
}

export function answerRequest(requestId, result) {
  const req = state.requests.find((r) => r.requestId === requestId);
  state.requests = state.requests.filter((r) => r.requestId !== requestId);
  if (req) {
    const text = result.behavior === 'allow' ? 'Devam ediyor' : result.behavior === 'terminal' ? 'Terminalde bekliyor' : 'Reddedildi';
    updateAgent(req.agentId, { state: result.behavior === 'terminal' ? 'wait' : 'think', text });
  }
  notify('requests');
  return send({ cmd: 'answer', requestId, ...result });
}

export async function connect() {
  await listen('sidecar', (e) => {
    try {
      onEvent(JSON.parse(e.payload));
    } catch (err) {
      console.error('köprü olayı okunamadı', err, e.payload);
    }
  });
  await send({ cmd: 'status' });
}
