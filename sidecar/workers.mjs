// Office agents: persistent Claude Code sessions the user adds to the office.
//
// Unlike subagents, which live inside the attached session and end with their task, each
// office agent is its own headless Claude Code session (`claude -p --agent <name>`). The
// first task creates it with --session-id, every later one continues it with --resume, so
// it keeps its context across tasks, meetings and restarts. No API key is involved: the
// CLI uses the user's own Claude Code login.
//
// Output is read from `--output-format stream-json`. The sessions also fire the user's
// hooks, which the bridge routes here so permission prompts and questions reach the
// office, and so messages typed while an agent works land at its next tool call.

import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir } from './paths.mjs';

export const MAX_WORKERS = 5;
const PROMPT_LIMIT = 24_000; // Windows command lines stop at 32 767 characters

/** How to start the Claude Code CLI: { cmd, prefix } or null. */
export function findClaude() {
  const override = process.env.CLAUDIO_CLAUDE;
  if (override) return /\.(m?js)$/.test(override) ? { cmd: process.execPath, prefix: [override] } : { cmd: override, prefix: [] };
  const win = process.platform === 'win32';
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  dirs.push(path.join(os.homedir(), '.local', 'bin'));
  for (const dir of dirs) {
    const exe = path.join(dir, win ? 'claude.exe' : 'claude');
    if (fs.existsSync(exe)) return { cmd: exe, prefix: [] };
    if (!win) continue;
    // npm's shim: claude.cmd calls node_modules\@anthropic-ai\claude-code\bin\claude.exe
    const shim = path.join(dir, 'claude.cmd');
    if (!fs.existsSync(shim)) continue;
    const m = /"%dp0%\\([^"]+\.exe)"/i.exec(fs.readFileSync(shim, 'utf8'));
    if (m && fs.existsSync(path.join(dir, m[1]))) return { cmd: path.join(dir, m[1]), prefix: [] };
  }
  return null;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent';
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Kill a process and its children (Claude Code starts shells and tools). */
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
  else proc.kill('SIGTERM');
}

export class WorkerPool {
  #emit;
  #file;
  #claude;
  #workers = new Map(); // id -> record (persisted fields + runtime)
  meeting = null;

  constructor(emit, { dir = appDir(), claude = findClaude() } = {}) {
    this.#emit = emit;
    this.#file = path.join(dir, 'workers.json');
    this.#claude = claude;
    this.#load();
  }

  // ---------- persistence ----------
  #load() {
    try {
      const list = JSON.parse(fs.readFileSync(this.#file, 'utf8'));
      for (const w of list) this.#workers.set(w.id, { ...w, proc: null, state: 'idle', queue: [], interrupted: false, text: '' });
    } catch {
      // first run
    }
  }

  #save() {
    const list = [...this.#workers.values()].map(({ id, name, title, defKey, def, sessionId, started, cwd, createdAt, note }) => ({ id, name, title, defKey, def, sessionId, started, cwd, createdAt, note }));
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    fs.writeFileSync(this.#file, JSON.stringify(list, null, 2));
  }

  #public(w) {
    return { id: w.id, name: w.name, title: w.title, defKey: w.defKey, description: w.def.description ?? '', model: w.def.model ?? null, cwd: w.cwd, state: w.state, text: w.text, started: w.started, queued: w.queue.length };
  }

  snapshot() {
    return { type: 'workers', max: MAX_WORKERS, available: Boolean(this.#claude), list: [...this.#workers.values()].map((w) => this.#public(w)) };
  }

  bySession(sessionId) {
    for (const w of this.#workers.values()) if (w.sessionId === sessionId) return w;
    return null;
  }

  isWorkerSession(sessionId) {
    return Boolean(this.bySession(sessionId));
  }

  get(id) {
    return this.#workers.get(id) ?? null;
  }

  // ---------- add, remove ----------
  add(def, { defKey, cwd }) {
    if (!this.#claude) throw new Error('Claude Code CLI bulunamadı. Terminalde `claude` komutunun çalıştığından emin ol.');
    if (this.#workers.size >= MAX_WORKERS) throw new Error(`Ofiste en fazla ${MAX_WORKERS} ajan çalışabilir. Önce birini çıkar.`);
    const sameDef = [...this.#workers.values()].filter((w) => w.defKey === defKey).length;
    const id = crypto.randomBytes(4).toString('hex');
    const w = {
      id,
      name: def.name,
      title: sameDef ? `${def.name} ${sameDef + 1}` : def.name,
      defKey,
      def: { description: def.description ?? '', prompt: def.prompt ?? '', tools: def.tools ?? null, model: def.model ?? null },
      sessionId: crypto.randomUUID(),
      started: false,
      cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
      createdAt: Date.now(),
      note: null,
      proc: null,
      state: 'idle',
      queue: [],
      interrupted: false,
      text: 'Ofise geldi',
    };
    this.#workers.set(id, w);
    this.#save();
    this.#emit({ type: 'worker_added', worker: this.#public(w) });
    return w;
  }

  remove(id) {
    const w = this.#workers.get(id);
    if (!w) return;
    killTree(w.proc);
    this.#workers.delete(id);
    if (this.meeting) this.meeting.participants = this.meeting.participants.filter((p) => p !== id);
    this.#save();
    this.#emit({ type: 'worker_removed', id });
  }

  #setState(w, state, text) {
    w.state = state;
    if (text !== undefined) w.text = text;
    this.#emit({ type: 'worker_state', id: w.id, state, text: w.text, queued: w.queue.length });
  }

  // ---------- messages ----------
  /** A task or message from the office. While the agent works it lands at its next step. */
  send(id, text, clientId = null) {
    const w = this.#workers.get(id);
    if (!w) throw new Error('Bu ajan artık ofiste değil.');
    const msg = { id: `wm${crypto.randomBytes(3).toString('hex')}`, text };
    this.#emit({ type: 'worker_chat', id, role: 'user', text, msgId: msg.id, clientId, pending: Boolean(w.proc) });
    if (w.proc || this.#inMeeting(w)) {
      w.queue.push(msg);
      this.#emit({ type: 'worker_state', id, state: w.state, text: w.text, queued: w.queue.length });
      return;
    }
    this.#run(w, this.#withNote(w, text), { msgIds: [msg.id] });
  }

  #withNote(w, text) {
    if (!w.note) return text;
    const note = w.note;
    w.note = null;
    this.#save();
    return `${note}\n\n${text}`;
  }

  #inMeeting(w) {
    return Boolean(this.meeting && this.meeting.participants.includes(w.id));
  }

  /** Messages for a working agent, taken by its PostToolUse or Stop hook. */
  takeQueued(sessionId) {
    const w = this.bySession(sessionId);
    if (!w || !w.queue.length || this.#inMeeting(w)) return null;
    const msgs = w.queue.splice(0);
    for (const m of msgs) this.#emit({ type: 'worker_delivered', id: w.id, msgId: m.id });
    this.#emit({ type: 'worker_state', id: w.id, state: w.state, text: w.text, queued: 0 });
    return `Kullanıcı Claudio Ofis'ten yazdı:\n${msgs.map((m) => `- ${m.text}`).join('\n')}`;
  }

  stop(id) {
    const w = this.#workers.get(id);
    if (!w?.proc) return;
    w.stopped = true;
    killTree(w.proc);
  }

  // ---------- running a turn ----------
  #args(w, prompt, mode) {
    const agent = `claudio-${slug(w.name)}`;
    const def = { description: w.def.description || w.name, prompt: clip(w.def.prompt || `Sen ${w.name} adlı bir ajansın.`, PROMPT_LIMIT) };
    const tools = typeof w.def.tools === 'string' ? w.def.tools.split(/[,\s]+/).filter(Boolean) : Array.isArray(w.def.tools) ? w.def.tools : null;
    if (tools?.length) def.tools = tools;
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    args.push(...(w.started ? ['--resume', w.sessionId] : ['--session-id', w.sessionId]));
    args.push('--agents', JSON.stringify({ [agent]: def }), '--agent', agent, '--name', `Claudio · ${w.title}`);
    if (w.def.model && w.def.model !== 'inherit') args.push('--model', w.def.model);
    if (mode) args.push('--permission-mode', mode);
    return args;
  }

  /**
   * One turn of the agent's session. Resolves with { ok, text } where text is the final
   * answer. `mode` 'plan' keeps meeting turns read-only.
   */
  #run(w, prompt, { mode = null, msgIds = [], quiet = false } = {}) {
    return new Promise((resolve) => {
      const { cmd, prefix } = this.#claude;
      let proc;
      try {
        proc = spawn(cmd, [...prefix, ...this.#args(w, prompt, mode)], { cwd: w.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, CLAUDIO_WORKER: w.id } });
      } catch (err) {
        this.#setState(w, 'error', `Başlatılamadı: ${err.message}`);
        return resolve({ ok: false, text: '' });
      }
      w.proc = proc;
      w.stopped = false;
      for (const m of msgIds) this.#emit({ type: 'worker_delivered', id: w.id, msgId: m });
      this.#setState(w, 'working', quiet ? 'Toplantıda konuşuyor' : 'Düşünüyor…');
      let finalText = '';
      let result = null;
      let stderr = '';
      let buf = '';
      const seen = new Set();
      proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
      proc.stdout.on('data', (d) => {
        buf += d;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'system' && ev.subtype === 'init' && !w.started) {
            w.started = true;
            this.#save();
          } else if (ev.type === 'assistant') {
            (ev.message?.content ?? []).forEach((block, i) => {
              const key = `${ev.message.id}:${i}:${block.type}`;
              if (seen.has(key)) return;
              seen.add(key);
              if (block.type === 'text' && block.text?.trim()) {
                finalText = block.text;
                if (!quiet) this.#emit({ type: 'worker_chat', id: w.id, role: 'assistant', text: block.text });
              } else if (block.type === 'tool_use') {
                this.#emit({ type: 'worker_tool', id: w.id, phase: 'start', tool: block.name, input: block.input ?? {}, toolUseId: block.id });
              }
            });
          } else if (ev.type === 'user') {
            for (const block of ev.message?.content ?? []) {
              if (block.type !== 'tool_result') continue;
              const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => c.text ?? '').join('\n');
              this.#emit({ type: 'worker_tool', id: w.id, phase: block.is_error ? 'fail' : 'end', toolUseId: block.tool_use_id, error: block.is_error ? clip(text, 200) : null });
            }
          } else if (ev.type === 'result') {
            result = ev;
          }
        }
      });
      proc.on('close', (code) => {
        w.proc = null;
        const tokens = result?.usage ? (result.usage.input_tokens ?? 0) + (result.usage.cache_read_input_tokens ?? 0) + (result.usage.cache_creation_input_tokens ?? 0) + (result.usage.output_tokens ?? 0) : null;
        if (result) this.#emit({ type: 'worker_stats', id: w.id, tokens, costUsd: result.total_cost_usd ?? null, durationMs: result.duration_ms ?? null, turns: result.num_turns ?? null });
        const ok = Boolean(result && !result.is_error);
        if (w.stopped) {
          this.#setState(w, 'idle', 'Durduruldu');
        } else if (!ok) {
          const why = result?.result || stderr.trim().split('\n').pop() || `çıkış kodu ${code}`;
          this.#setState(w, 'error', clip(String(why), 160));
          if (!quiet) this.#emit({ type: 'worker_chat', id: w.id, role: 'system', text: `Tur bir hatayla bitti: ${clip(String(why), 300)}` });
        } else {
          this.#setState(w, 'idle', 'İşini bitirdi');
        }
        if (!finalText && result?.result) finalText = String(result.result);
        resolve({ ok, text: finalText });
        // Messages that arrived after the last tool call start the next turn.
        if (!w.stopped && w.queue.length && !this.#inMeeting(w) && this.#workers.has(w.id)) {
          const msgs = w.queue.splice(0);
          this.#run(w, this.#withNote(w, msgs.map((m) => m.text).join('\n\n')), { msgIds: msgs.map((m) => m.id) });
        }
      });
    });
  }

  #halt(w) {
    if (!w.proc) return Promise.resolve(false);
    return new Promise((resolve) => {
      w.stopped = true;
      w.proc.once('close', () => resolve(true));
      killTree(w.proc);
    });
  }

  // ---------- meetings ----------
  // The office runs the meeting: each participant speaks in turn in its own session (so it
  // keeps the meeting in its context), read-only. Agents that were working are stopped
  // first and pick their work up again once the meeting is over.

  async meetingStart(topic, ids) {
    if (this.meeting) throw new Error('Bir toplantı zaten sürüyor.');
    const participants = ids.filter((id) => this.#workers.has(id));
    if (!participants.length) throw new Error('Toplantıya katılacak ofis ajanı seç.');
    this.meeting = { topic, participants, lines: [], seen: new Map(), running: false, ending: false, interrupted: new Set() };
    this.#emit({ type: 'meeting_started', topic, participants });
    for (const id of participants) {
      const w = this.#workers.get(id);
      if (await this.#halt(w)) {
        this.meeting.interrupted.add(id);
        this.#emit({ type: 'worker_chat', id, role: 'system', text: 'Toplantı için işine ara verdi; toplantıdan sonra kaldığı yerden devam edecek.' });
      }
    }
    this.#round();
  }

  meetingInterject(text) {
    const m = this.meeting;
    if (!m || m.ending) return;
    m.lines.push({ speaker: 'user', text });
    this.#emit({ type: 'meeting_line', speaker: 'user', text });
    if (!m.running) this.#round();
  }

  meetingEnd() {
    const m = this.meeting;
    if (!m || m.ending) return;
    m.ending = true;
    this.#emit({ type: 'meeting_phase', phase: 'ending' });
    if (!m.running) this.#summarize();
  }

  #name(id) {
    return id === 'user' ? 'Kullanıcı' : this.#workers.get(id)?.title ?? 'ajan';
  }

  /** What a participant has not heard yet: everything since its last turn. */
  #news(id) {
    const m = this.meeting;
    const from = m.seen.get(id) ?? 0;
    m.seen.set(id, m.lines.length);
    return m.lines.slice(from).map((l) => `${this.#name(l.speaker)}: ${l.text}`).join('\n\n');
  }

  async #round() {
    const m = this.meeting;
    if (!m || m.running) return;
    m.running = true;
    const others = (id) => m.participants.filter((p) => p !== id).map((p) => this.#name(p)).join(', ') || 'yalnızca sen';
    for (const id of [...m.participants]) {
      if (this.meeting !== m || m.ending) break;
      const w = this.#workers.get(id);
      if (!w) continue;
      const first = !m.seen.has(id);
      const news = this.#news(id);
      const prompt = [
        first ? `[Toplantı] Konu: ${m.topic}\nKatılımcılar: ${others(id)} ve kullanıcı. Bu bir toplantı: dosya değiştirme, kısa konuş.` : '[Toplantı devam ediyor]',
        news ? `Senden önce söylenenler:\n${news}` : '',
        'Sıra sende. Konuyla ilgili durumunu, görüşünü ya da sorunu en fazla beş cümleyle söyle. Kullanıcıya bir şey sorman gerekiyorsa AskUserQuestion kullan.',
      ].filter(Boolean).join('\n\n');
      this.#emit({ type: 'meeting_turn', speaker: id });
      const { text } = await this.#run(w, prompt, { mode: 'plan', quiet: true });
      if (this.meeting !== m) return;
      const said = text.trim() || '(sessiz kaldı)';
      m.lines.push({ speaker: id, text: said });
      m.seen.set(id, m.lines.length);
      this.#emit({ type: 'meeting_line', speaker: id, text: said });
    }
    m.running = false;
    if (this.meeting !== m) return;
    if (m.ending) return this.#summarize();
    // Someone interjected during the round: everyone gets to answer it.
    const unanswered = m.lines.length && m.lines[m.lines.length - 1].speaker === 'user';
    if (unanswered) return this.#round();
    this.#emit({ type: 'meeting_phase', phase: 'waiting' });
  }

  async #summarize() {
    const m = this.meeting;
    const lead = this.#workers.get(m.participants.find((id) => this.#workers.has(id)));
    let summary = m.lines.map((l) => `${this.#name(l.speaker)}: ${l.text}`).join('\n');
    if (lead) {
      this.#emit({ type: 'meeting_turn', speaker: lead.id });
      const news = this.#news(lead.id);
      const { text } = await this.#run(lead, [
        '[Toplantı bitiyor]',
        news ? `Son söylenenler:\n${news}` : '',
        '"## Toplantı özeti" başlığı altında kararları ve her katılımcının yapacağı işi madde madde yaz. Başka bir şey yazma.',
      ].filter(Boolean).join('\n\n'), { mode: 'plan', quiet: true });
      if (text.trim()) summary = text.trim().replace(/^#+\s*Toplantı özeti\s*/i, '').trim();
    }
    const interrupted = [...m.interrupted];
    const participants = [...m.participants];
    this.meeting = null;
    this.#emit({ type: 'meeting_summary', summary });
    const note = `Az önce şu toplantı yapıldı: "${m.topic}". Özet:\n${summary}`;
    for (const id of participants) {
      const w = this.#workers.get(id);
      if (!w) continue;
      if (interrupted.includes(id)) {
        this.#run(w, `${note}\n\nToplantı bitti. Toplantıdan önce yarım kalan işine kaldığın yerden devam et.`);
      } else if (w.queue.length) {
        const msgs = w.queue.splice(0);
        this.#run(w, `${note}\n\n${msgs.map((x) => x.text).join('\n\n')}`, { msgIds: msgs.map((x) => x.id) });
      }
    }
  }

  shutdown() {
    for (const w of this.#workers.values()) killTree(w.proc);
  }
}
