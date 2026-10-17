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
