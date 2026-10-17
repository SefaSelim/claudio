import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// CLAUDE_CONFIG_DIR is read when sessions.mjs loads, so set it before the import.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-roster-'));
const claudeDir = path.join(tmp, 'claude');
process.env.CLAUDE_CONFIG_DIR = claudeDir;
const { parseFrontmatter, readRoster, readTasks } = await import('../sidecar/roster.mjs');

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('frontmatter: quoted values, continuation lines, no frontmatter', () => {
  const { meta, body } = parseFrontmatter('---\nname: "reviewer"\ndescription: Reviews code\n  for bugs\ntools: Read, Grep\n---\n# Title\n');
  assert.equal(meta.name, 'reviewer');
  assert.equal(meta.description, 'Reviews code for bugs');
  assert.equal(meta.tools, 'Read, Grep');
  assert.equal(body.trim(), '# Title');
  assert.deepEqual(parseFrontmatter('just text').meta, {});
});

test('roster: built-ins, user, project and plugin sources; project wins a clash', () => {
  const project = path.join(tmp, 'work', 'app');
  write(path.join(claudeDir, 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: user reviewer\n---\n');
  write(path.join(project, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: project reviewer\nmodel: haiku\n---\n');
  write(path.join(project, '.claude', 'agents', 'nested', 'db.md'), '# Database helper\n');
  write(path.join(project, '.claude', 'skills', 'release', 'SKILL.md'), '---\nname: release\ndescription: Cut a release\n---\n');
  write(path.join(project, '.claude', 'commands', 'git', 'ship.md'), '---\ndescription: Ship it\nargument-hint: <branch>\n---\n');
  write(path.join(project, '.claude', 'agents', 'broken.md'), '---\nname: [unclosed\n');
  const pluginDir = path.join(tmp, 'plugin');
  write(path.join(pluginDir, 'agents', 'writer.md'), '---\nname: writer\ndescription: Writes docs\n---\n');
  write(path.join(claudeDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'docs@market': [{ installPath: pluginDir }], 'off@market': [{ installPath: pluginDir }] } }));
  write(path.join(claudeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'off@market': false } }));

  const r = readRoster(path.join(project, 'src'));
  const names = r.agents.map((a) => a.name);
  for (const n of ['general-purpose', 'Explore', 'Plan', 'reviewer', 'db', 'docs:writer']) assert(names.includes(n), n);
  assert(!names.includes('off:writer'), 'disabled plugin hidden');
  const reviewer = r.agents.find((a) => a.name === 'reviewer');
  assert.equal(reviewer.description, 'project reviewer');
  assert.equal(reviewer.source, 'project');
  assert.equal(reviewer.model, 'haiku');
  assert.equal(r.agents.find((a) => a.name === 'db').description, 'Database helper');
  assert.deepEqual(r.skills.map((s) => s.name), ['release']);
  assert.equal(r.commands[0].name, '/git:ship');
  assert.equal(r.commands[0].hint, '<branch>');
});

test('roster: missing directories give built-ins only', () => {
  const r = readRoster(path.join(tmp, 'nowhere'));
  assert(r.agents.length >= 3);
});

test('tasks: id order, status fallback, blocked, deleted and broken skipped', () => {
  const dir = path.join(claudeDir, 'tasks', 'sess-1');
  write(path.join(dir, '10.json'), JSON.stringify({ id: '10', subject: 'Ten', status: 'completed' }));
  write(path.join(dir, '2.json'), JSON.stringify({ id: '2', subject: 'Two', status: 'in_progress', activeForm: 'Doing two', blockedBy: ['1'] }));
  write(path.join(dir, '3.json'), JSON.stringify({ id: '3', subject: 'Gone', status: 'deleted' }));
  write(path.join(dir, '4.json'), JSON.stringify({ id: '4', subject: 'Odd', status: 'weird' }));
  write(path.join(dir, '5.json'), '{ half');
  const t = readTasks('sess-1');
  assert.deepEqual(t.map((x) => x.id), ['2', '4', '10']);
  assert.equal(t[0].blocked, true);
  assert.equal(t[0].activeForm, 'Doing two');
  assert.equal(t[1].status, 'pending');
  assert.deepEqual(readTasks('none'), []);
});
