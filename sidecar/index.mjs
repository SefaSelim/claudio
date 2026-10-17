// Claudio Ofis yan süreci: Claude Agent SDK oturumunu tutar.
// Tauri bu dosyayı `node` ile başlatır ve stdin/stdout üzerinden satır satır JSON konuşur.
//
// Gelen komutlar (stdin):
//   { cmd: "status" }
//   { cmd: "start", cwd, prompt, permissionMode, ask }
//   { cmd: "send", text }
//   { cmd: "set_mode", mode }
//   { cmd: "answer", requestId, behavior: "allow" | "deny", updatedInput?, message? }
//   { cmd: "interrupt" }
//   { cmd: "stop" }
//
// Giden olaylar (stdout): ready, auth_required, session_started, sdk, hook,
// permission, permission_cancelled, mode_changed, session_ended, error.

import readline from 'node:readline';
import { query } from '@anthropic-ai/claude-agent-sdk';

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const log = (...parts) => process.stderr.write(parts.join(' ') + '\n');

// Anthropic, Agent SDK ile yapılan uygulamaların claude.ai girişi kullanmasına izin vermiyor;
// bu yüzden yalnızca API anahtarı ya da bulut sağlayıcı kimlikleriyle çalışıyoruz.
const CREDENTIAL_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
];
// CLAUDIO_FAKE=1: gerçek SDK yerine fake.mjs'deki demo senaryosu (anahtar gerekmez).
const FAKE = process.env.CLAUDIO_FAKE === '1';
const hasCredentials = () => FAKE || CREDENTIAL_VARS.some((name) => process.env[name]);

const ASK_RULE =
  'Kullanıcı seni masaüstündeki Claudio Ofis uygulamasından izliyor. ' +
  'Belirsiz ya da kullanıcının tercihine bağlı kararlarda AskUserQuestion ile kısa, çoktan seçmeli sorular sor. ' +
  '"[Ofis] X\'a ilet:" ile başlayan mesajlar kullanıcının belirli bir alt ajana talimatıdır; ilgili ajana ilet.';
const SELF_RULE =
  'Kullanıcı seni masaüstündeki Claudio Ofis uygulamasından izliyor ve soru sorulmasını istemiyor. ' +
  'Belirsiz kararlarda makul olanı seç ve kısaca nedenini yaz. ' +
  '"[Ofis] X\'a ilet:" ile başlayan mesajlar kullanıcının belirli bir alt ajana talimatıdır; ilgili ajana ilet.';

/** SDK'ye akıtılan kullanıcı mesajları için basit bir asenkron kuyruk. */
class Inbox {
  #items = [];
  #waiters = [];
  #closed = false;

  push(message) {
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.#items.push(message);
  }

  close() {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.#items.length) return Promise.resolve({ value: this.#items.shift(), done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

const userMessage = (text) => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
  origin: { kind: 'human' },
});

let session = null; // { query, inbox }
const pending = new Map(); // requestId -> { resolve, input }

function hookForwarder(event) {
  return async (input) => {
    emit({
      type: 'hook',
      event,
      agent_id: input.agent_id ?? null,
      agent_type: input.agent_type ?? null,
      tool_name: input.tool_name ?? null,
      tool_input: input.tool_input ?? null,
      tool_use_id: input.tool_use_id ?? null,
      message: input.message ?? null,
      notification_type: input.notification_type ?? null,
    });
    return {};
  };
}

const forward = (event) => [{ hooks: [hookForwarder(event)] }];

function canUseTool(toolName, input, options) {
  return new Promise((resolve) => {
    const { requestId } = options;
    pending.set(requestId, { resolve, input });
    emit({
      type: 'permission',
      requestId,
      toolName,
      input,
      agentID: options.agentID ?? null,
      toolUseID: options.toolUseID,
      reason: options.decisionReason ?? null,
    });
    options.signal?.addEventListener('abort', () => {
      if (!pending.delete(requestId)) return;
      emit({ type: 'permission_cancelled', requestId });
      resolve({ behavior: 'deny', message: 'İstek iptal edildi.' });
    });
  });
}

async function start({ cwd, prompt, permissionMode = 'default', ask = true }) {
  if (session) return emit({ type: 'error', message: 'Zaten açık bir oturum var.' });
  if (!hasCredentials()) return emit({ type: 'auth_required' });
  if (!prompt?.trim()) return emit({ type: 'error', message: 'İlk mesaj boş olamaz.' });

  const inbox = new Inbox();
  inbox.push(userMessage(prompt));
  if (FAKE) return startFake({ cwd, permissionMode, ask, inbox });
  const q = query({
    prompt: inbox,
    options: {
      cwd,
      permissionMode,
      // Ayarlardan "İzinleri atla" seçilebilsin diye; başlangıç modunu değiştirmez.
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: ask ? ASK_RULE : SELF_RULE },
      disallowedTools: ask ? [] : ['AskUserQuestion'],
      canUseTool,
      hooks: {
        PreToolUse: forward('PreToolUse'),
        PostToolUse: forward('PostToolUse'),
        SubagentStart: forward('SubagentStart'),
        SubagentStop: forward('SubagentStop'),
        Notification: forward('Notification'),
        Stop: forward('Stop'),
      },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'claudio-ofis/0.1.0' },
      stderr: (data) => log('[claude]', data.trimEnd()),
    },
  });
  session = { query: q, inbox };
  emit({ type: 'session_started', cwd, permissionMode, ask });

  try {
    for await (const message of q) emit({ type: 'sdk', message });
    emit({ type: 'session_ended' });
  } catch (err) {
    emit({ type: 'error', message: String(err?.message ?? err) });
    emit({ type: 'session_ended' });
  } finally {
    session = null;
    for (const { resolve } of pending.values()) resolve({ behavior: 'deny', message: 'Oturum kapandı.' });
    pending.clear();
  }
}

async function startFake({ cwd, permissionMode, ask, inbox }) {
  const { runFake } = await import('./fake.mjs');
  const abort = new AbortController();
  // Demo, query() nesnesinin kullandığımız kısmını taklit eder.
  session = {
    inbox,
    query: { setPermissionMode: async () => {}, interrupt: async () => {}, close: () => { abort.abort(); inbox.close(); } },
  };
  emit({ type: 'session_started', cwd, permissionMode, ask });
  // İlk mesaj senaryoyu başlatır; sonrakiler senaryonun cevap döngüsüne gider.
  await inbox[Symbol.asyncIterator]().next();
  try {
    await runFake({ emit, canUseTool, inbox, signal: abort.signal });
  } catch (err) {
    emit({ type: 'error', message: String(err?.message ?? err) });
  } finally {
    session = null;
    emit({ type: 'session_ended' });
  }
}

function answer({ requestId, behavior, updatedInput, message }) {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  if (behavior === 'allow') entry.resolve({ behavior: 'allow', updatedInput: updatedInput ?? entry.input });
  else entry.resolve({ behavior: 'deny', message: message || 'Kullanıcı reddetti.' });
}

async function handle(command) {
  switch (command.cmd) {
    case 'status':
      return emit({ type: 'ready', cwd: process.cwd(), hasCredentials: hasCredentials(), running: Boolean(session) });
    case 'start':
      return start(command);
    case 'send':
      if (!session) return emit({ type: 'error', message: 'Açık oturum yok.' });
      return session.inbox.push(userMessage(command.text));
    case 'set_mode':
      if (!session) return emit({ type: 'mode_changed', mode: command.mode });
      await session.query.setPermissionMode(command.mode);
      return emit({ type: 'mode_changed', mode: command.mode });
    case 'answer':
      return answer(command);
    case 'interrupt':
      return session?.query.interrupt();
    case 'stop':
      if (!session) return;
      session.inbox.close();
      return session.query.close();
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

process.stdin.on('end', () => {
  session?.query.close();
  process.exit(0);
});

emit({ type: 'ready', cwd: process.cwd(), hasCredentials: hasCredentials() });
