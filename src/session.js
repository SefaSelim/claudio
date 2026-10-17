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
  askQuestions: true,
  askEveryTask: false,
  sessions: [], // { sessionId, name, cwd, status, version, entrypoint, updatedAt }
  attached: null, // { sessionId, name, cwd }
  busy: false, // whether the attached session is mid-turn
  mode: null, // oturumun izin modu (hook girdisinden)
  agents: new Map(), // id -> { id, kind, type, label, description, state, text, steps }
  chat: [], // { role: 'user' | 'assistant' | 'system', text, pending?, via? }
  requests: [], // { requestId, kind: 'permission' | 'question', toolName, input, agentId }
  // { topic, participants, startChat, phase: 'running' | 'ending' | 'done', summary, notes, startedAt }
  meeting: null,
  // What Claude Code can use in the attached project: { cwd, agents, skills, commands }
  roster: null,
  tasks: [], // { id, subject, activeForm, status: 'pending' | 'in_progress' | 'completed', blocked }
  // { model, context, window, approximate, percent, perMinute } from the session transcript
  usage: null,
  // { since, cause, failures } while the office is in alarm (a deploy failed, or three failures in five minutes)
  alarm: null,
  diagnostics: null, // what the bridge reports about the setup (Settings → Tanılama)
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
  // tools: calls per tool name; failures: calls that ended in PostToolUseFailure.
  const full = { state: 'think', text: '', steps: [], chat: [], description: '', tools: {}, failures: 0, startedAt: Date.now(), model: null, tokens: null, ...agent };
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

// ---------- signals and alarm ----------
// Each agent carries the signal it is running (signal.state 'run') or how the last one ended.
const SIGNAL_SHOW_MS = 6000;
const ALARM_WINDOW = 5 * 60_000;
const ALARM_QUIET = 10 * 60_000;
const failureLog = []; // { at, what }
const redKinds = new Map(); // 'build' | 'test' -> target that last failed
let alarmTimer = 0;
let contextWarned = null;

function setSignal(id, signal) {
  const agent = state.agents.get(id) ?? state.agents.get('main');
  if (!agent) return;
  agent.signal = signal;
  notify('agent_signal', { id: agent.id });
  if (signal.state !== 'run') {
    setTimeout(() => {
      if (agent.signal === signal) {
        agent.signal = null;
        notify('agent_signal', { id: agent.id });
      }
    }, SIGNAL_SHOW_MS);
  }
}

function systemRow(text) {
  state.chat.push({ role: 'system', text });
  notify('chat');
}

function startAlarm(cause) {
  clearTimeout(alarmTimer);
  if (!state.alarm) {
    state.alarm = { since: Date.now(), cause, failures: failureLog.length };
    systemRow(`🚨 Alarm: ${cause}`);
    notify('alarm', { started: true });
  } else {
    state.alarm.cause = cause;
    notify('alarm');
  }
  alarmTimer = setTimeout(() => endAlarm('on dakikadır yeni hata yok'), ALARM_QUIET);
}

/** /alarm in the chat: declare one by hand. */
export function startManualAlarm(cause) {
  startAlarm(cause || 'elle başlatıldı');
}

/** A system row only the office sees (slash command output). */
export function systemNote(text) {
  systemRow(text);
}

/** /temizle: clears the office's copy of the chat; the session itself is untouched. */
export function clearChatView() {
  state.chat = [];
  if (state.meeting) state.meeting.startChat = 0;
  systemRow('Ofisteki sohbet görünümü temizlendi. Oturumun kendisi değişmedi.');
}

/** Ends the alarm with a one-line postmortem. */
export function endAlarm(why = 'elle kapatıldı') {
  if (!state.alarm) return;
  clearTimeout(alarmTimer);
  const mins = Math.max(1, Math.round((Date.now() - state.alarm.since) / 60_000));
  const failures = failureLog.filter((f) => f.at >= state.alarm.since - ALARM_WINDOW).length;
  systemRow(`✅ Alarm bitti (${why}) · ${mins} dk · ${failures} hata · son sebep: ${state.alarm.cause}`);
  state.alarm = null;
  failureLog.length = 0;
  notify('alarm');
}

function noteFailure(what) {
  const now = Date.now();
  failureLog.push({ at: now, what });
  while (failureLog.length && now - failureLog[0].at > ALARM_WINDOW) failureLog.shift();
  if (failureLog.length >= 3) startAlarm(`5 dakikada ${failureLog.length} hata · son: ${what}`);
  else if (state.alarm) startAlarm(what);
}

const SIGNAL_NAME = { deploy: 'deploy', build: 'derleme', test: 'testler', push: 'push' };

function onSignal(evt) {
  const id = evt.agentId && state.agents.has(evt.agentId) ? evt.agentId : 'main';
  if (evt.phase === 'start') {
    const sig = evt.signals.find((s) => s.kind === 'deploy') ?? evt.signals[evt.signals.length - 1];
    setSignal(id, { kind: sig.kind, state: 'run', target: sig.target });
    return;
  }
  const done = evt.signals.filter((s) => s.result);
  if (!done.length) {
    setSignal(id, { kind: evt.signals[0].kind, state: 'none' });
    return;
  }
  const failed = done.find((s) => s.result === 'fail');
  const shown = failed ?? done.find((s) => s.kind === 'deploy') ?? done[done.length - 1];
  setSignal(id, { kind: shown.kind, state: shown.result, target: shown.target });
  if (evt.interrupted) return;
  const who = state.agents.get(id)?.label ?? 'Claude';
  for (const s of done) {
    const target = s.target ? ` (${s.target})` : '';
    if (s.result === 'fail') {
      const why = s.detail || s.error || 'hata';
      if (s.kind === 'deploy') {
        systemRow(`❌ ${who}: deploy başarısız${target} · ${why}`);
        startAlarm(`deploy başarısız${target}: ${why}`);
      } else {
        if (s.kind === 'build' || s.kind === 'test') redKinds.set(s.kind, s.target);
        systemRow(`❌ ${who}: ${SIGNAL_NAME[s.kind]} başarısız${target} · ${why}`);
      }
      say(id, `${SIGNAL_NAME[s.kind]} başarısız`);
    } else if (s.kind === 'deploy') {
      systemRow(`🚀 ${who}: deploy tamam${target}`);
      say(id, 'Yayında!');
      if (state.alarm) endAlarm('deploy başarılı');
    } else if (s.kind === 'push') {
      if (s.toDefault) systemRow(`🎉 ${who}: ${s.target}'a push edildi`);
      say(id, s.toDefault ? `${s.target}'a gönderdim` : 'Push ettim');
    } else if (redKinds.has(s.kind)) {
      redKinds.delete(s.kind);
      systemRow(`✅ ${who}: ${SIGNAL_NAME[s.kind]} yeniden yeşil${target}`);
      if (state.alarm && !redKinds.size) endAlarm(`${SIGNAL_NAME[s.kind]} yeşile döndü`);
    }
  }
}

/** SendMessage to another agent: which office agent it names, if any. */
function messageTarget(to) {
  const t = String(to ?? '').toLowerCase();
  if (!t) return null;
  for (const a of state.agents.values()) {
    if (a.id.toLowerCase() === t || a.label.toLowerCase() === t || String(a.type).toLowerCase() === t) return a.id;
  }
  return null;
}

// Claude dozes off when a turn has been over for a while; any new activity wakes it.
const DOZE_AFTER = 30_000;
let dozeTimer = 0;
function scheduleDoze() {
  clearTimeout(dozeTimer);
  dozeTimer = setTimeout(() => {
    const main = state.agents.get('main');
    if (main?.state === 'done' && !state.requests.some((r) => r.agentId === 'main')) updateAgent('main', { state: 'sleep', text: 'Uyukluyor · yazınca uyanır' });
  }, DOZE_AFTER);
}

function onHook(evt) {
  const id = evt.agent_id ?? 'main';
  if (evt.permission_mode && evt.permission_mode !== state.mode) {
    state.mode = evt.permission_mode;
    notify('status');
  }
  switch (evt.event) {
    case 'UserPromptSubmit':
      clearTimeout(dozeTimer);
      updateAgent('main', { state: 'think', text: 'Düşünüyor…', error: null });
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
      agent.tools[tool] = (agent.tools[tool] ?? 0) + 1;
      if (tool === 'SendMessage') {
        const to = messageTarget(evt.tool_input?.to ?? evt.tool_input?.recipient);
        if (to && to !== id) notify('visit', { from: id, to });
      }
      if (id === 'main') clearTimeout(dozeTimer);
      updateAgent(id, { state: TOOL_STATE[tool] ?? 'think', text: detail });
      break;
    }
    case 'PostToolUseFailure': {
      const agent = state.agents.get(id);
      if (!agent) break;
      const step = agent.steps.findLast((s) => s.tool === evt.tool_name && s.status === 'run');
      if (step) {
        step.status = 'fail';
        step.error = clip(evt.error, 120);
      }
      agent.failures += 1;
      // An interrupted call (Esc) is not a failure of the work.
      if (!/interrupt/i.test(evt.error ?? '')) noteFailure(`${agent.label}: ${evt.tool_name} başarısız`);
      updateAgent(id, { state: 'think', text: `${evt.tool_name} başarısız` });
      say(id, `${evt.tool_name} başarısız oldu`);
      break;
    }
    case 'StopFailure':
      updateAgent('main', { state: 'error', text: `API hatası · ${evt.error ?? 'bilinmiyor'}`, error: evt.error ?? 'unknown' });
      state.chat.push({ role: 'system', text: `Tur bir API hatasıyla bitti (${evt.error ?? 'bilinmiyor'}). Claude Code tekrar deneyebilir ya da senden bekler.` });
      notify('chat');
      break;
    case 'PreCompact':
      if (id === 'main') updateAgent('main', { state: 'compact', text: evt.trigger === 'auto' ? 'Bağlam doldu, topluyor' : 'Bağlamı topluyor' });
      break;
    case 'PostCompact':
      if (id === 'main') {
        updateAgent('main', { state: state.busy ? 'think' : 'done', text: 'Bağlam toplandı' });
        say('main', 'Masamı topladım');
      }
      break;
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
      updateAgent(evt.agent_id, { state: 'done', text: 'Bitti', endedAt: Date.now() });
      say(evt.agent_id, 'Bitti, rapor Claude\'da');
      setTimeout(() => removeAgent(evt.agent_id), 6000);
      break;
    case 'Notification':
      if (evt.notification_type === 'idle_prompt') updateAgent('main', { state: 'done', text: 'Sıra sende' });
      break;
    case 'Stop':
      updateAgent('main', { state: 'done', text: 'Sıra sende' });
      scheduleDoze();
      break;
  }
}

function resetSessionView() {
  state.chat = [];
  state.requests = [];
  state.roster = null;
  state.tasks = [];
  state.usage = null;
  if (state.alarm) {
    state.alarm = null;
    clearTimeout(alarmTimer);
    notify('alarm');
  }
  failureLog.length = 0;
  redKinds.clear();
  notify('usage');
  clearTimeout(dozeTimer);
  notify('roster');
  notify('tasks');
  if (state.meeting) {
    state.meeting = null;
    notify('meeting');
  }
  state.mode = null;
  pendingLaunches.length = 0;
  clearAgents();
}

function onEvent(evt) {
  switch (evt.type) {
    case 'ready':
      state.ready = true;
      state.fake = evt.fake;
      for (const key of OPTION_KEYS) if (typeof evt[key] === 'boolean') state[key] = evt[key];
      {
        // A fresh bridge starts with defaults; push the options the user picked earlier.
        const saved = savedOptions();
        const differ = OPTION_KEYS.filter((k) => typeof saved[k] === 'boolean' && saved[k] !== state[k]);
        if (differ.length) {
          for (const k of differ) state[k] = saved[k];
          send({ cmd: 'set_option', options: Object.fromEntries(differ.map((k) => [k, saved[k]])) });
        }
      }
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
      if (state.chat.length > 200) {
        state.chat.shift();
        if (state.meeting) state.meeting.startChat = Math.max(0, state.meeting.startChat - 1);
      }
      if (evt.role === 'assistant') {
        say('main', evt.text);
        captureSummary(evt.text);
      }
      notify('chat');
      break;
    case 'hook':
      onHook(evt);
      break;
    case 'busy':
      state.busy = evt.busy;
      notify('busy');
      break;
    case 'options':
      for (const key of OPTION_KEYS) if (typeof evt[key] === 'boolean') state[key] = evt[key];
      notify('status');
      break;
    case 'decided_alone': {
      const id = evt.agentId && state.agents.has(evt.agentId) ? evt.agentId : 'main';
      state.chat.push({ role: 'system', text: `Soru sorma kapalı; ${state.agents.get(id)?.label ?? 'Claude'} kendi karar verdi${evt.question ? `: "${evt.question}"` : ''}.` });
      say(id, 'Kendim karar veriyorum');
      notify('chat');
      notify('decided', { id, question: evt.question });
      break;
    }
    case 'roster':
      state.roster = { cwd: evt.cwd, agents: evt.agents ?? [], skills: evt.skills ?? [], commands: evt.commands ?? [] };
      notify('roster');
      break;
    case 'tasks':
      if (evt.sessionId !== state.attached?.sessionId) break;
      state.tasks = evt.tasks ?? [];
      notify('tasks');
      break;
    case 'signal':
      onSignal(evt);
      break;
    case 'diagnostics':
      state.diagnostics = { ...evt, at: Date.now() };
      notify('diagnostics');
      break;
    case 'usage': {
      if (evt.sessionId !== state.attached?.sessionId) break;
      state.usage = evt;
      notify('usage');
      if (evt.percent >= 85 && contextWarned !== evt.sessionId) {
        contextWarned = evt.sessionId;
        systemRow(`Claude'un masası doluyor: bağlam %${evt.percent}. Claude Code yakında konuşmayı özetleyebilir.`);
      }
      break;
    }
    case 'agent_stats':
      updateAgent(evt.agentId, { model: evt.model ?? null, tokens: evt.tokens ?? null });
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
      // Meeting prompts are not handed over; the meeting walk covers them.
      if (!state.meeting) notify('handover', { to: evt.target ?? 'main', text: evt.text });
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
export const refreshRoster = () => send({ cmd: 'roster' });
export const requestDiagnostics = () => send({ cmd: 'diagnostics' });

/** Ask Claude to launch a subagent of this type; Claude stays in charge of the launch. */
export function launchAgent(name, task) {
  return sendMessage(`"${name}" alt ajanını (subagent_type: ${name}) şu görevle başlat ve sonucunu bana özetle:\n${task}`);
}

/** Ask Claude to use a skill or run a slash command's instructions for this request. */
export function useSkill(kind, name, task) {
  const what = kind === 'command' ? `${name} komutunun talimatlarını` : `"${name}" becerisini`;
  return sendMessage(`${what} kullanarak şunu yap:\n${task}`);
}

// ---------- meetings ----------
// A meeting is a structured prompt to the main agent. The office walks everyone to the
// meeting room, shows the conversation, and ends when Claude writes the summary heading.

export const SUMMARY_MARK = 'Toplantı özeti';
export const MEETING_START = '[Toplantı] Konu:';
export const MEETING_INTERJECT = '[Toplantı, araya giriyorum]';
export const MEETING_END = '[Toplantı] Toplantıyı bitir';

function meetingPrompt(topic, names) {
  return [
    `${MEETING_START} ${topic}`,
    `Katılımcılar: ${names.join(', ')}`,
    '',
    'Kısa bir toplantı yapalım:',
    '1. Her katılımcının durumunu bir iki cümleyle anlat. Açık alt ajanlar varsa onlara SendMessage ile sor; yoksa bildiklerinden özetle.',
    '2. Karar gereken noktalarda AskUserQuestion ile bana çoktan seçmeli soru sor.',
    '3. Araya girersem notlarımı dikkate al.',
    `4. Bitirince "## ${SUMMARY_MARK}" başlığı altında kararları ve görevleri madde madde yaz.`,
  ].join('\n');
}

export function startMeeting(topic, participants) {
  if (!state.attached || state.meeting) return;
  const ids = ['main', ...participants.filter((id) => id !== 'main' && state.agents.has(id))];
  const names = ids.map((id) => state.agents.get(id)?.label ?? 'Claude');
  state.meeting = { topic, participants: ids, startChat: state.chat.length, phase: 'running', summary: null, notes: [], startedAt: Date.now() };
  notify('meeting');
  return sendMessage(meetingPrompt(topic, names));
}

export function interjectMeeting(text) {
  if (!state.meeting || state.meeting.phase === 'done') return;
  state.meeting.notes.push(text);
  return sendMessage(`${MEETING_INTERJECT} ${text}`);
}

export function endMeeting() {
  if (!state.meeting || state.meeting.phase !== 'running') return;
  state.meeting.phase = 'ending';
  notify('meeting');
  return sendMessage(`${MEETING_END} ve "## ${SUMMARY_MARK}" başlığıyla kısa bir özet yaz.`);
}

export function closeMeeting() {
  state.meeting = null;
  notify('meeting');
}

/** When Claude writes the summary heading, the meeting is over. */
function captureSummary(text) {
  const m = state.meeting;
  if (!m || m.phase === 'done') return;
  // Only a real heading counts, not a sentence that mentions the summary.
  const heading = new RegExp(`^\\s*(#{1,4}\\s*|\\*\\*)${SUMMARY_MARK}`, 'mi').exec(text);
  if (!heading) return;
  const rest = text.slice(heading.index + heading[0].length).replace(/^[*:\s]*/, '').trim();
  m.summary = rest || text.trim();
  m.phase = 'done';
  notify('meeting');
}

// Bridge options are kept in the office so they survive restarts of the bridge.
const OPTIONS_KEY = 'claudio.bridgeOptions';
const OPTION_KEYS = ['answerInOffice', 'askQuestions', 'askEveryTask'];

function savedOptions() {
  try {
    return JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function setOption(key, value) {
  if (!OPTION_KEYS.includes(key)) return;
  state[key] = value;
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ ...savedOptions(), [key]: value }));
  } catch {
    // Storage unavailable: the option lasts until the bridge restarts.
  }
  return send({ cmd: 'set_option', options: { [key]: value } });
}

export const setAnswerInOffice = (value) => setOption('answerInOffice', value);

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
