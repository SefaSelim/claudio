// What Claude Code can use in a project: subagent types, skills and slash commands.
// Read from the same places Claude Code reads them: built-ins, ~/.claude, the project's
// .claude folders (the working directory and its parents) and enabled plugins.
// Every reader tolerates missing or malformed files; a broken definition is skipped.

import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from './sessions.mjs';

export const BUILTIN_AGENTS = [
  { name: 'general-purpose', description: 'Karmaşık, çok adımlı işler; arama, okuma ve düzenleme yapabilir.', source: 'builtin' },
  { name: 'Explore', description: 'Kod tabanında hızlı, salt okunur arama.', source: 'builtin' },
  { name: 'Plan', description: 'Uygulama planı çıkarır; dosya değiştirmez.', source: 'builtin' },
];

/** Splits `---\nkey: value\n---\nbody`. Values may be quoted; lists stay strings. */
export function parseFrontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      meta[key] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    } else if (key && /^\s+\S/.test(line)) {
      // folded or list continuation
      meta[key] = `${meta[key]} ${line.trim().replace(/^-\s*/, '')}`.trim();
    }
  }
  return { meta, body: m[2] };
}

const firstLine = (body) => body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? '';
const clip = (s, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function readMd(file) {
  try {
    return parseFrontmatter(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function mdFiles(dir, depth = 2) {
  let out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 1) out = out.concat(mdFiles(p, depth - 1));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function agentsIn(dir, source, prefix = '') {
  return mdFiles(dir).flatMap((file) => {
    const md = readMd(file);
    if (!md) return [];
    const name = md.meta.name || path.basename(file, '.md');
    return [{
      name: prefix + name,
      description: clip(md.meta.description || firstLine(md.body)),
      model: md.meta.model || null,
      tools: md.meta.tools || null,
      color: md.meta.color || null,
      source,
    }];
  });
}

function skillsIn(dir, source, prefix = '') {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).flatMap((e) => {
    const md = readMd(path.join(dir, e.name, 'SKILL.md'));
    if (!md) return [];
    return [{ name: prefix + (md.meta.name || e.name), description: clip(md.meta.description || firstLine(md.body)), source }];
  });
}

function commandsIn(dir, source, prefix = '') {
  return mdFiles(dir).flatMap((file) => {
    const md = readMd(file);
    if (!md) return [];
    const rel = path.relative(dir, file).replace(/\.md$/, '').split(path.sep).join(':');
    return [{ name: `/${prefix}${rel}`, description: clip(md.meta.description || firstLine(md.body)), hint: md.meta['argument-hint'] || null, source }];
  });
}

/** Project .claude folders from the working directory up to (not including) the user's own. */
function projectDirs(cwd) {
  const dirs = [];
  if (!cwd) return dirs;
  let dir = path.resolve(cwd);
  const user = path.resolve(CLAUDE_DIR);
  for (let i = 0; i < 12; i++) {
    const claude = path.join(dir, '.claude');
    if (path.resolve(claude) !== user && fs.existsSync(claude)) dirs.push(claude);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dirs;
}

function enabledPlugins() {
  let installed = {};
  let enabled = {};
  try {
    installed = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {};
  } catch {
    return [];
  }
  try {
    enabled = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'settings.json'), 'utf8')).enabledPlugins ?? {};
  } catch {
    enabled = {};
  }
  return Object.entries(installed).flatMap(([id, installs]) => {
    if (enabled[id] === false) return [];
    const install = [...(installs ?? [])].reverse().find((x) => x?.installPath);
    return install ? [{ id, name: id.split('@')[0], dir: install.installPath }] : [];
  });
}

/** Later sources win on a name clash, as in Claude Code: project over user over built-in. */
function dedupe(list) {
  const byName = new Map();
  for (const item of list) byName.set(item.name.toLowerCase(), item);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function readRoster(cwd) {
  const plugins = enabledPlugins();
  const projects = projectDirs(cwd).reverse(); // outermost first, so the closest wins
  const agents = [
    ...BUILTIN_AGENTS,
    ...plugins.flatMap((p) => agentsIn(path.join(p.dir, 'agents'), `plugin:${p.name}`, `${p.name}:`)),
    ...agentsIn(path.join(CLAUDE_DIR, 'agents'), 'user'),
    ...projects.flatMap((d) => agentsIn(path.join(d, 'agents'), 'project')),
  ];
  const skills = [
    ...plugins.flatMap((p) => skillsIn(path.join(p.dir, 'skills'), `plugin:${p.name}`, `${p.name}:`)),
    ...skillsIn(path.join(CLAUDE_DIR, 'skills'), 'user'),
    ...projects.flatMap((d) => skillsIn(path.join(d, 'skills'), 'project')),
  ];
  const commands = [
    ...plugins.flatMap((p) => commandsIn(path.join(p.dir, 'commands'), `plugin:${p.name}`, `${p.name}:`)),
    ...commandsIn(path.join(CLAUDE_DIR, 'commands'), 'user'),
    ...projects.flatMap((d) => commandsIn(path.join(d, 'commands'), 'project')),
  ];
  return { cwd: cwd || '', agents: dedupe(agents), skills: dedupe(skills), commands: dedupe(commands) };
}

// ---------- task list ----------

const TASK_STATUS = new Set(['pending', 'in_progress', 'completed']);

/** The session's TaskCreate list from ~/.claude/tasks/<session>/<n>.json, in id order. */
export function readTasks(sessionId) {
  const dir = path.join(CLAUDE_DIR, 'tasks', sessionId);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const tasks = [];
  for (const file of files) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const status = TASK_STATUS.has(t.status) ? t.status : 'pending';
      if (t.status === 'deleted') continue;
      tasks.push({
        id: String(t.id ?? path.basename(file, '.json')),
        subject: clip(String(t.subject ?? t.content ?? ''), 140),
        activeForm: t.activeForm ? clip(String(t.activeForm), 140) : null,
        status,
        blocked: Array.isArray(t.blockedBy) && t.blockedBy.length > 0,
      });
    } catch {
      // half-written file; the next read picks it up
    }
  }
  const num = (id) => (/^\d+$/.test(id) ? Number(id) : Infinity);
  return tasks.filter((t) => t.subject).sort((a, b) => num(a.id) - num(b.id) || a.id.localeCompare(b.id));
}
