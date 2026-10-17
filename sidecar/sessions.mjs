// Çalışan Claude Code oturumlarını listeler ve kayıt (transcript) dosyalarını okur.
// ~/.claude/sessions/<pid>.json ve kayıtların satır biçimi belgelenmemiş; bu yüzden
// yalnızca ihtiyaç duyulan alanlar okunur ve tanınmayan her şey sessizce atlanır.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Açık oturumlar, en son güncellenen önce. Gizli alanlar (token, soket yolu) dışarı çıkmaz. */
export function listSessions() {
  const dir = path.join(CLAUDE_DIR, 'sessions');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return [];
  }
  const sessions = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (!data.sessionId || (data.pid && !isAlive(data.pid))) continue;
      sessions.push({
        sessionId: data.sessionId,
        name: data.name || '',
        cwd: data.cwd || '',
        status: data.status || '',
        version: data.version || '',
        entrypoint: data.entrypoint || '',
        updatedAt: data.updatedAt || data.startedAt || 0,
      });
    } catch {
      // Yazılırken okunan ya da biçimi farklı dosya: atla.
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findTranscript(sessionId) {
  const projects = path.join(CLAUDE_DIR, 'projects');
  try {
    for (const dir of fs.readdirSync(projects)) {
      const file = path.join(projects, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(file)) return file;
    }
  } catch {
    // projects klasörü yok
  }
  return null;
}

const NOISE = /^<(command-|local-command|system-reminder|bash-|task-notification)/;

/**
 * Bir kayıt satırını sohbet öğesine çevirir; sohbetle ilgisi yoksa null.
 * Subagent transcripts mark every record as a sidechain, so they pass { sidechain: true }.
 */
export function parseRecord(line, { sidechain = false } = {}) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if ((rec.isSidechain && !sidechain) || rec.isMeta) return null;
  const content = rec.message?.content;
  if (rec.type === 'user') {
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
    const clean = text.trim();
    if (!clean || NOISE.test(clean)) return null;
    return { role: 'user', text: clean, uuid: rec.uuid };
  }
  if (rec.type === 'assistant' && Array.isArray(content)) {
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) return null;
    return { role: 'assistant', text, uuid: rec.uuid };
  }
  return null;
}

/** Kayıt dosyasının sonunu izler: önce son mesajları verir, sonra eklenen satırları. */
export class TranscriptTail {
  #file;
  #onItem;
  #options;
  #offset = 0;
  #partial = '';
  #timer = null;

  constructor(file, onItem, options = {}) {
    this.#file = file;
    this.#onItem = onItem;
    this.#options = options;
  }

  /** Son `limit` sohbet öğesini döndürür ve izlemeyi başlatır. */
  start(limit = 30) {
    const size = fs.statSync(this.#file).size;
    const from = Math.max(0, size - 512 * 1024);
    const text = this.#read(from, size);
    const lines = text.split('\n');
    if (from > 0) lines.shift(); // yarım kalan ilk satır
    const history = lines.map((l) => parseRecord(l, this.#options)).filter(Boolean).slice(-limit);
    this.#offset = size;
    this.#timer = setInterval(() => this.#poll(), 400);
    return history;
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
  }

  #read(from, to) {
    if (to <= from) return '';
    const fd = fs.openSync(this.#file, 'r');
    try {
      const buf = Buffer.alloc(to - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }

  #poll() {
    let size;
    try {
      size = fs.statSync(this.#file).size;
    } catch {
      return;
    }
    if (size < this.#offset) this.#offset = 0; // dosya yeniden yazıldı
    if (size === this.#offset) return;
    const chunk = this.#partial + this.#read(this.#offset, size);
    this.#offset = size;
    const lines = chunk.split('\n');
    this.#partial = lines.pop() ?? '';
    for (const line of lines) {
      const item = parseRecord(line, this.#options);
      if (item) this.#onItem(item);
    }
  }

  /** Read whatever was appended since the last poll, then stop. */
  flushAndStop() {
    this.#poll();
    this.stop();
  }
}

/** Where Claude Code keeps a subagent's transcript, next to the session transcript. */
export function subagentTranscript(sessionTranscript, sessionId, agentId) {
  return path.join(path.dirname(sessionTranscript), sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

/**
 * Model and token use from the last assistant reply in a transcript, read from the end of
 * the file only. `context` is what the reply had in its window: input plus both cache
 * counts plus output, the number Claude Code reports for a resumed session.
 */
export function lastUsage(file, maxBytes = 256 * 1024) {
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - maxBytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue;
    try {
      const rec = JSON.parse(lines[i]);
      const msg = rec.message;
      const u = msg?.usage;
      if (rec.type !== 'assistant' || !u) continue;
      const context = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
      return { model: msg.model ?? null, context, output: u.output_tokens ?? 0, at: rec.timestamp ? Date.parse(rec.timestamp) : null };
    } catch {
      // a line cut at the read boundary
    }
  }
  return null;
}

// ---------- usage meters ----------

// Context windows, from Claude Code's own model table. A [1m] tag always means 1M.
const WINDOW_1M = /^claude-(haiku-5-5|sonnet-5(-5)?|opus-4-[78]|opus-5(-5)?|fable-5(-1)?|mythos-)/;

/** { size, approximate } for a model id; dated and provider-prefixed ids count as the id. */
export function contextWindow(model, used = 0) {
  const id = String(model ?? '').toLowerCase().replace(/^(us\.|eu\.|apac\.)?anthropic\./, '').replace(/@.*$/, '');
  if (id.includes('[1m]') || WINDOW_1M.test(id)) return { size: 1_000_000, approximate: false };
  if (/^claude-(3|haiku-4|sonnet-4|opus-4)/.test(id)) return { size: used > 200_000 ? 1_000_000 : 200_000, approximate: used > 200_000 };
  return { size: used > 200_000 ? 1_000_000 : 200_000, approximate: true };
}

/**
 * Follows the token use in a transcript: each assistant reply once (streamed replies repeat
 * their message id), for a context meter and tokens per minute.
 */
export class UsageTail {
  #file;
  #offset = 0;
  #rest = '';
  #seen = new Set();
  replies = []; // { at, tokens } for the last few minutes
  last = null; // { model, context, at }

  constructor(file) {
    this.#file = file;
    try {
      // Start near the end: only the latest reply matters for the context meter.
      this.#offset = Math.max(0, fs.statSync(file).size - 256 * 1024);
    } catch {
      this.#offset = 0;
    }
  }

  poll(now = Date.now()) {
    let size;
    try {
      size = fs.statSync(this.#file).size;
    } catch {
      return false;
    }
    if (size < this.#offset) { this.#offset = 0; this.#rest = ''; }
    let changed = false;
    if (size > this.#offset) {
      const fd = fs.openSync(this.#file, 'r');
      try {
        const buf = Buffer.alloc(Math.min(size - this.#offset, 4 * 1024 * 1024));
        fs.readSync(fd, buf, 0, buf.length, this.#offset);
        this.#offset += buf.length;
        const lines = (this.#rest + buf.toString('utf8')).split('\n');
        this.#rest = lines.pop();
        for (const line of lines) if (line.includes('"usage"') && this.#take(line)) changed = true;
      } finally {
        fs.closeSync(fd);
      }
    }
    const before = this.replies.length;
    this.replies = this.replies.filter((r) => now - r.at < 5 * 60_000);
    return changed || before !== this.replies.length;
  }

  #take(line) {
    try {
      const rec = JSON.parse(line);
      const msg = rec.message;
      const u = msg?.usage;
      if (rec.type !== 'assistant' || !u || rec.isSidechain) return false;
      const context = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
      const at = rec.timestamp ? Date.parse(rec.timestamp) : Date.now();
      this.last = { model: msg.model ?? this.last?.model ?? null, context, at };
      const id = msg.id ?? rec.uuid;
      if (id && this.#seen.has(id)) return true;
      if (id) this.#seen.add(id);
      if (this.#seen.size > 2000) this.#seen = new Set([...this.#seen].slice(-500));
      this.replies.push({ at, tokens: context });
      return true;
    } catch {
      return false;
    }
  }

  /** Context fill and tokens per minute over the last five minutes. */
  snapshot(now = Date.now()) {
    if (!this.last) return null;
    const win = contextWindow(this.last.model, this.last.context);
    const recent = this.replies.filter((r) => now - r.at < 5 * 60_000);
    const minutes = recent.length ? Math.max(1, (now - Math.min(...recent.map((r) => r.at))) / 60_000) : 5;
    return {
      model: this.last.model,
      context: this.last.context,
      window: win.size,
      approximate: win.approximate,
      percent: Math.min(100, Math.round((this.last.context / win.size) * 100)),
      perMinute: Math.round(recent.reduce((n, r) => n + r.tokens, 0) / Math.min(5, minutes)),
    };
  }
}
