// ~/.claude/settings.json içine ofisin hook'larını ekler ya da kaldırır.
// Kullanıcı düzeyi hook'lar bütün Claude Code oturumlarında çalışır ve Claude Code
// ayar dosyasını izlediği için açık oturumlar da yeniden başlatmadan alır.
// Ofis kapalıyken http hook'ları bağlanamaz ve Claude Code bunu engelleyici olmayan bir hata sayar.

import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from './sessions.mjs';
import { BRIDGE_PORT } from './paths.mjs';

export const HOOK_URL = `http://127.0.0.1:${BRIDGE_PORT}/hook`;
const WAITER_MARK = 'claudio-waiter';

const settingsPath = () => path.join(CLAUDE_DIR, 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`settings.json okunamadı: ${err.message}`);
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n');
}

const isOurs = (hook) =>
  (hook.type === 'http' && String(hook.url ?? '').startsWith(HOOK_URL)) ||
  (hook.type === 'command' && String(hook.command ?? '').includes(WAITER_MARK));

function withoutOurs(settings) {
  const hooks = settings.hooks ?? {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  return settings;
}

export function hooksInstalled() {
  try {
    const hooks = readSettings().hooks ?? {};
    return Object.values(hooks).some((groups) => groups.some((g) => (g.hooks ?? []).some(isOurs)));
  } catch {
    return false;
  }
}

/**
 * @param {string} token  köprünün isteği tanıması için başlıkta gönderilen paylaşılan gizli değer
 * @param {string} waiterPath  claudio-waiter.mjs dosyasının mutlak yolu
 */
export function installHooks({ token, waiterPath }) {
  const settings = withoutOurs(readSettings());
  const backup = `${settingsPath()}.claudio-backup`;
  if (fs.existsSync(settingsPath()) && !fs.existsSync(backup)) fs.copyFileSync(settingsPath(), backup);

  const http = (timeout) => ({ type: 'http', url: HOOK_URL, timeout, headers: { 'X-Claudio-Token': token } });
  // Boştaki oturumu ofisten gelen mesajla uyandıran bekçi; her tur sonunda yeniden kurulur.
  const waiter = { type: 'command', command: `node "${waiterPath.replaceAll('\\', '/')}"`, asyncRewake: true, timeout: 86400 };

  const plan = {
    SessionStart: [waiter],
    UserPromptSubmit: [http(5)],
    PreToolUse: [http(600)], // AskUserQuestion cevabı ofisten gelene kadar bekleyebilir
    PermissionRequest: [http(600)], // izin ofisten verilene kadar bekleyebilir
    PostToolUse: [http(5)],
    SubagentStart: [http(5)],
    SubagentStop: [http(5)],
    Notification: [http(5)],
    Stop: [http(10), waiter],
    SessionEnd: [http(5)],
  };
  settings.hooks ??= {};
  for (const [event, hooks] of Object.entries(plan)) {
    (settings.hooks[event] ??= []).push({ hooks });
  }
  writeSettings(settings);
}

/**
 * True when the installed hooks carry this token and point at this waiter. They go stale
 * when the app moves (for example from the source tree to an installed build).
 */
export function hooksCurrent({ token, waiterPath }) {
  try {
    const all = Object.values(readSettings().hooks ?? {}).flatMap((groups) => groups.flatMap((g) => g.hooks ?? [])).filter(isOurs);
    const waiter = waiterPath.replaceAll('\\', '/');
    return all.every((h) => (h.type === 'http' ? h.headers?.['X-Claudio-Token'] === token : String(h.command).includes(waiter)));
  } catch {
    return true;
  }
}

export function uninstallHooks() {
  writeSettings(withoutOurs(readSettings()));
}
