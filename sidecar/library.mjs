// The agent library: definitions the user can bring into the office.
//
// Sources are the attached project's .claude/agents, ~/.claude/agents, enabled plugins, a
// general-purpose built-in, and git repositories the user imports (for example a studio of
// ready-made agents). Imported repositories are shallow, sparse clones of only their agent
// folders, kept in the app data folder.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appDir } from './paths.mjs';
import { CLAUDE_DIR } from './sessions.mjs';
import { parseFrontmatter } from './roster.mjs';

export const RECOMMENDED = [
  { url: 'https://github.com/Donchitos/Claude-Code-Game-Studios', label: 'Claude Code Game Studios', note: 'Bir oyun stüdyosunun ekibi: yönetmenler, programcılar, tasarımcılar, test ve yayın uzmanları.' },
];

const GENERAL = {
  key: 'builtin/genel',
  name: 'genel',
  description: 'Her işe bakan genel bir asistan: kod okur, yazar, komut çalıştırır.',
  prompt: 'Sen Claudio Ofis\'te çalışan genel amaçlı bir yazılım ajanısın. Kullanıcının verdiği işi dikkatle yap, ne yaptığını kısaca özetle. Türkçe konuş.',
  source: 'builtin',
};

const libDir = () => path.join(appDir(), 'library');
const sourcesFile = () => path.join(libDir(), 'sources.json');

function readSources() {
  try {
    return JSON.parse(fs.readFileSync(sourcesFile(), 'utf8'));
  } catch {
    return [];
  }
}

function writeSources(list) {
  fs.mkdirSync(libDir(), { recursive: true });
  fs.writeFileSync(sourcesFile(), JSON.stringify(list, null, 2));
}

/** owner/repo from a GitHub URL, or null for other git URLs. */
export function parseRepoUrl(url) {
  const s = String(url ?? '').trim();
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(s);
  if (m) return { url: `https://github.com/${m[1]}/${m[2]}.git`, id: `${m[1]}__${m[2]}`.toLowerCase(), label: m[2].replace(/[-_]+/g, ' ') };
  if (/^https:\/\/[\w.-]+\/[\w./-]+$/.test(s)) {
    const parts = s.replace(/\.git$/, '').split('/');
    return { url: s, id: parts.slice(-2).join('__').toLowerCase().replace(/[^a-z0-9_-]/g, '-'), label: parts[parts.length - 1] };
  }
  return null;
}

const git = (args, cwd) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, timeout: 180_000, windowsHide: true }, (err, stdout, stderr) => {
    if (err) reject(new Error(err.code === 'ENOENT' ? 'Git bulunamadı. Repo içe aktarmak için Git kurulu olmalı.' : (stderr || err.message).trim().split('\n').pop()));
    else resolve(stdout);
  });
});

/** Clone (or update) only the agent folders of a repository. */
export async function importRepo(url) {
  const repo = parseRepoUrl(url);
  if (!repo) throw new Error('Geçerli bir GitHub adresi gir (https://github.com/sahip/repo).');
  const dir = path.join(libDir(), repo.id);
  if (fs.existsSync(path.join(dir, '.git'))) {
    await git(['pull', '--depth', '1', '--ff-only'], dir).catch(() => {});
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(libDir(), { recursive: true });
    await git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', repo.url, dir]);
    await git(['sparse-checkout', 'set', '--no-cone', '/.claude/agents/', '/agents/'], dir);
  }
  const count = agentsInRepo(dir, repo.id).length;
  if (!count) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('Bu repoda .claude/agents ya da agents klasöründe ajan bulunamadı.');
  }
  const sources = readSources().filter((s) => s.id !== repo.id);
  sources.push({ id: repo.id, url: repo.url, label: repo.label, importedAt: Date.now(), count });
  writeSources(sources);
  return { id: repo.id, count };
}

export function removeSource(id) {
  writeSources(readSources().filter((s) => s.id !== id));
  const dir = path.join(libDir(), id);
  if (path.dirname(dir) === libDir()) fs.rmSync(dir, { recursive: true, force: true });
}

function mdFiles(dir, depth = 2) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 1) return mdFiles(p, depth - 1);
    return e.isFile() && e.name.endsWith('.md') && !/^readme\.md$/i.test(e.name) ? [p] : [];
  });
}

/** Agent entries of one folder; `prompt` is read later, only for the agent being added. */
function agentsIn(dir, source, keyPrefix) {
  return mdFiles(dir).flatMap((file) => {
    let md;
    try {
      md = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    } catch {
      return [];
    }
    if (!md.meta.name && !md.meta.description) return [];
    const name = md.meta.name || path.basename(file, '.md');
    return [{
      key: `${keyPrefix}/${name}`,
      name,
      description: String(md.meta.description || '').slice(0, 280),
      model: md.meta.model || null,
      tools: md.meta.tools || null,
      source,
      file,
    }];
  });
}

const agentsInRepo = (dir, id) => [...agentsIn(path.join(dir, '.claude', 'agents'), `repo:${id}`, `repo:${id}`), ...agentsIn(path.join(dir, 'agents'), `repo:${id}`, `repo:${id}`)];

function projectAgentDirs(cwd) {
  const dirs = [];
  if (!cwd) return dirs;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 12; i++) {
    const d = path.join(dir, '.claude', 'agents');
    if (path.resolve(path.join(dir, '.claude')) !== path.resolve(CLAUDE_DIR) && fs.existsSync(d)) dirs.push(d);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dirs;
}

function pluginAgentDirs() {
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {};
    let enabled = {};
    try { enabled = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'settings.json'), 'utf8')).enabledPlugins ?? {}; } catch { /* none */ }
    return Object.entries(installed).flatMap(([id, installs]) => {
      if (enabled[id] === false) return [];
      const dir = [...(installs ?? [])].reverse().find((x) => x?.installPath)?.installPath;
      return dir ? [{ name: id.split('@')[0], dir: path.join(dir, 'agents') }] : [];
    });
  } catch {
    return [];
  }
}

/** Everything that can be brought into the office, grouped by source. */
export function listLibrary(cwd) {
  const sources = [];
  sources.push({ id: 'builtin', label: 'Yerleşik', kind: 'builtin', agents: [{ ...GENERAL, file: null }] });
  const project = projectAgentDirs(cwd).flatMap((d) => agentsIn(d, 'project', 'project'));
  if (project.length) sources.push({ id: 'project', label: 'Bu proje', kind: 'project', agents: project });
  const user = agentsIn(path.join(CLAUDE_DIR, 'agents'), 'user', 'user');
  if (user.length) sources.push({ id: 'user', label: 'Kendi ajanların', kind: 'user', agents: user });
  for (const p of pluginAgentDirs()) {
    const agents = agentsIn(p.dir, `plugin:${p.name}`, `plugin:${p.name}`);
    if (agents.length) sources.push({ id: `plugin:${p.name}`, label: `Eklenti · ${p.name}`, kind: 'plugin', agents });
  }
  for (const s of readSources()) {
    const agents = agentsInRepo(path.join(libDir(), s.id), s.id);
    sources.push({ id: s.id, label: s.label, kind: 'repo', url: s.url, importedAt: s.importedAt, agents });
  }
  const imported = new Set(readSources().map((s) => s.id));
  return {
    sources: sources.map((s) => ({ ...s, agents: s.agents.map(({ file, prompt, ...rest }) => rest).sort((a, b) => a.name.localeCompare(b.name)) })),
    recommended: RECOMMENDED.map((r) => ({ ...r, imported: imported.has(parseRepoUrl(r.url).id) })),
  };
}

/** The full definition (with its prompt) of one library entry. */
export function getDefinition(key, cwd) {
  if (key === GENERAL.key) return { ...GENERAL };
  for (const s of listSourcesWithFiles(cwd)) {
    const a = s.find((x) => x.key === key);
    if (!a) continue;
    const md = parseFrontmatter(fs.readFileSync(a.file, 'utf8'));
    return { name: a.name, description: a.description, model: a.model, tools: a.tools, prompt: md.body.trim() };
  }
  return null;
}

function listSourcesWithFiles(cwd) {
  return [
    projectAgentDirs(cwd).flatMap((d) => agentsIn(d, 'project', 'project')),
    agentsIn(path.join(CLAUDE_DIR, 'agents'), 'user', 'user'),
    ...pluginAgentDirs().map((p) => agentsIn(p.dir, `plugin:${p.name}`, `plugin:${p.name}`)),
    ...readSources().map((s) => agentsInRepo(path.join(libDir(), s.id), s.id)),
  ];
}
