import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Yan süreçten gelen olayları ofis durumuna çevirir.
// Ajan durumu hook'lardan (PreToolUse/PostToolUse/SubagentStart/SubagentStop),
// sohbet ana ajanın SDK mesajlarından, kartlar canUseTool isteklerinden gelir.

export const state = {
  ready: false,
  hasCredentials: false,
  defaultCwd: '',
  running: false,
  cwd: '',
  model: '',
  mode: 'default',
  ask: true,
  agents: new Map(), // id -> { id, kind, type, label, description, state, text, steps }
  chat: [], // { role: 'user' | 'assistant' | 'system', text }
  requests: [], // canUseTool istekleri
  error: null,
  authRequired: false,
  lastCost: null,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(change) {
  for (const fn of listeners) fn(change);
}

export function send(command) {
  return invoke('sidecar_send', { line: JSON.stringify(command) }).catch((err) => {
    state.error = String(err);
    notify({ kind: 'error' });
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

export function describeTool(name, input = {}) {
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
  const full = { state: 'think', text: '', steps: [], description: '', ...agent };
  state.agents.set(full.id, full);
  notify({ kind: 'agent_added', agent: full });
  return full;
}
function updateAgent(id, patch) {
  const agent = state.agents.get(id);
  if (!agent) return;
  Object.assign(agent, patch);
  notify({ kind: 'agent_updated', agent });
}
function removeAgent(id) {
  const agent = state.agents.get(id);
  if (!agent) return;
  state.agents.delete(id);
  notify({ kind: 'agent_removed', agent });
}
function ensureAgent(id, type) {
  if (state.agents.has(id)) return state.agents.get(id);
  if (id === 'main') return addAgent({ id: 'main', kind: 'main', type: 'main', label: 'Claude' });
  return addAgent({ id, kind: 'sub', type, label: labelFor(type) });
}
function clearAgents() {
  for (const id of [...state.agents.keys()]) removeAgent(id);
}

// Ana ajanın Agent çağrılarından gelen açıklamalar; SubagentStart'ta tipine göre eşlenir.
const pendingLaunches = [];
const now = () => new Date().toTimeString().slice(0, 5);

function say(id, text) {
  notify({ kind: 'say', id, text: clip(text, 70) });
}

function onHook(evt) {
  const id = evt.agent_id ?? 'main';
  switch (evt.event) {
    case 'PreToolUse': {
      const agent = ensureAgent(id, evt.agent_type);
      const tool = evt.tool_name;
      if (id === 'main' && (tool === 'Agent' || tool === 'Task')) {
        pendingLaunches.push({
          type: evt.tool_input?.subagent_type ?? 'general-purpose',
          description: evt.tool_input?.description ?? '',
        });
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
      updateAgent(agent.id, { description: launch?.description ?? '', text: launch?.description ?? 'Başladı' });
      say(agent.id, launch?.description || 'Göreve başladım');
      break;
    }
    case 'SubagentStop': {
      updateAgent(evt.agent_id, { state: 'done', text: 'Bitti' });
      say(evt.agent_id, 'Bitti, rapor Claude\'da');
      setTimeout(() => removeAgent(evt.agent_id), 6000);
      break;
    }
    case 'Stop':
      updateAgent('main', { state: 'done', text: 'Sıra sende' });
      break;
  }
}

function onSdk(message) {
  if (message.type === 'system' && message.subtype === 'init') {
    state.model = message.model ?? '';
    state.mode = message.permissionMode ?? state.mode;
    notify({ kind: 'status' });
    return;
  }
  if (message.type === 'assistant' && !message.parent_tool_use_id) {
    for (const block of message.message?.content ?? []) {
      if (block.type === 'text' && block.text.trim()) {
        state.chat.push({ role: 'assistant', text: block.text.trim() });
        notify({ kind: 'chat' });
        say('main', block.text);
      }
    }
    return;
  }
  if (message.type === 'result') {
    state.lastCost = message.total_cost_usd ?? null;
    const cost = state.lastCost != null ? ` · ~$${state.lastCost.toFixed(3)}` : '';
    const text = message.subtype === 'success' ? `Tur bitti${cost}` : `Tur hatayla bitti: ${(message.errors ?? []).join(', ') || message.subtype}`;
    state.chat.push({ role: 'system', text });
    updateAgent('main', { state: 'done', text: 'Sıra sende' });
    notify({ kind: 'chat' });
  }
}

function onEvent(evt) {
  switch (evt.type) {
    case 'ready':
      state.ready = true;
      state.hasCredentials = evt.hasCredentials;
      state.defaultCwd = evt.cwd;
      if (evt.running != null) state.running = evt.running;
      notify({ kind: 'status' });
      break;
    case 'auth_required':
      state.authRequired = true;
      notify({ kind: 'status' });
      break;
    case 'session_started':
      Object.assign(state, { running: true, cwd: evt.cwd, mode: evt.permissionMode, ask: evt.ask, error: null, authRequired: false });
      state.chat = [{ role: 'system', text: `Oturum açıldı · ${evt.cwd}` }];
      state.requests = [];
      pendingLaunches.length = 0;
      clearAgents();
      ensureAgent('main');
      updateAgent('main', { state: 'think', text: 'Düşünüyor…' });
      notify({ kind: 'status' });
      notify({ kind: 'chat' });
      notify({ kind: 'requests' });
      break;
    case 'session_ended':
    case 'sidecar_exit':
      state.running = false;
      state.requests = [];
      for (const agent of [...state.agents.values()]) if (agent.kind === 'sub') removeAgent(agent.id);
      updateAgent('main', { state: 'done', text: 'Oturum kapalı' });
      state.chat.push({ role: 'system', text: evt.type === 'sidecar_exit' ? 'Yan süreç kapandı.' : 'Oturum kapandı.' });
      notify({ kind: 'status' });
      notify({ kind: 'chat' });
      notify({ kind: 'requests' });
      break;
    case 'mode_changed':
      state.mode = evt.mode;
      notify({ kind: 'status' });
      break;
    case 'error':
      state.error = evt.message;
      state.chat.push({ role: 'system', text: `Hata: ${evt.message}` });
      notify({ kind: 'error' });
      notify({ kind: 'chat' });
      break;
    case 'hook':
      onHook(evt);
      break;
    case 'sdk':
      onSdk(evt.message);
      break;
    case 'permission': {
      const agentId = evt.agentID && state.agents.has(evt.agentID) ? evt.agentID : 'main';
      state.requests.push({ ...evt, agentId });
      updateAgent(agentId, { state: 'wait', text: evt.toolName === 'AskUserQuestion' ? 'Sana soruyor' : `İzin bekliyor · ${describeTool(evt.toolName, evt.input)}` });
      notify({ kind: 'requests' });
      break;
    }
    case 'permission_cancelled':
      state.requests = state.requests.filter((r) => r.requestId !== evt.requestId);
      notify({ kind: 'requests' });
      break;
  }
}

// ---------- komutlar ----------

export function startSession({ cwd, prompt, permissionMode, ask }) {
  state.chat = [{ role: 'user', text: prompt }];
  notify({ kind: 'chat' });
  return send({ cmd: 'start', cwd, prompt, permissionMode, ask });
}

export function sendMessage(text, agentId = 'main') {
  const agent = state.agents.get(agentId);
  const line = agentId === 'main' || !agent ? text : `[Ofis] ${agent.label}'a ilet: ${text}`;
  state.chat.push({ role: 'user', text: line });
  notify({ kind: 'chat' });
  updateAgent('main', { state: 'think', text: 'Düşünüyor…' });
  return send({ cmd: 'send', text: line });
}

export function answerRequest(requestId, result) {
  const req = state.requests.find((r) => r.requestId === requestId);
  state.requests = state.requests.filter((r) => r.requestId !== requestId);
  if (req) updateAgent(req.agentId, { state: 'think', text: result.behavior === 'allow' ? 'Devam ediyor' : 'Reddedildi' });
  notify({ kind: 'requests' });
  return send({ cmd: 'answer', requestId, ...result });
}

export const setMode = (mode) => send({ cmd: 'set_mode', mode });
export const interrupt = () => send({ cmd: 'interrupt' });
export const stopSession = () => send({ cmd: 'stop' });

export async function connect() {
  await listen('sidecar', (e) => {
    try {
      onEvent(JSON.parse(e.payload));
    } catch (err) {
      console.error('sidecar olayı okunamadı', err, e.payload);
    }
  });
  await send({ cmd: 'status' });
}
