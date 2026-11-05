import * as session from './session.js';

// Browser-only development demo (open the Vite page with ?scene-demo).
// It plays a short session through the same events the bridge sends, and answers
// office commands with a stand-in bridge, so panels, cards and the scene can be
// checked without Tauri or a Claude Code session.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SID = 'demo-session';
let msgSeq = 0;
let busy = true;

const hook = (event, extra = {}) => session.inject({ type: 'hook', event, sessionId: SID, permission_mode: 'default', ...extra });
const tool = async (agent, type, name, input, ms = 1500) => {
  hook('PreToolUse', { agent_id: agent, agent_type: type, tool_name: name, tool_input: input });
  await wait(ms);
  hook('PostToolUse', { agent_id: agent, agent_type: type, tool_name: name, tool_input: input });
};

function devBridge(command) {
  if (command.cmd === 'send') {
    const id = `m${++msgSeq}`;
    session.inject({ type: 'queued', id, text: command.text, target: command.target, clientId: command.clientId, busy });
    setTimeout(() => {
      session.inject({ type: 'delivered', id, via: busy ? 'after a tool' : 'wake-up' });
      if (command.text.startsWith(session.MEETING_START)) demoMeeting();
      else if (command.text.startsWith(session.MEETING_END)) demoSummary();
      else session.inject({ type: 'chat', role: 'assistant', text: `(Demo) Got your message: "${command.text}"` });
    }, 1500);
  }
  if (command.cmd === 'answer') session.inject({ type: 'chat', role: 'system', text: `Demo: request answered (${command.behavior}).` });
  if (command.cmd === 'set_option') session.inject({ type: 'options', ...command.options });
  if (command.cmd === 'roster') session.inject(DEMO_ROSTER);
  if (/^(workers|worker_|library|meeting_)/.test(command.cmd)) demoWorkers(command);
  if (command.cmd === 'diagnostics') {
    session.inject({ type: 'diagnostics', version: 'demo', node: 'v20.13.0', nodeOk: true, port: 47821, hooksInstalled: true, hooksCurrent: true, hooksSeen: 42, lastHookAt: Date.now() - 4000, lastHookEvent: 'PostToolUse', sessions: 2, attached: SID, uptimeMs: 60000 });
  }
}

// ---------- office agents, faked ----------
const DEMO_LIBRARY = {
  type: 'library',
  sources: [
    { id: 'builtin', label: 'Built-in', kind: 'builtin', agents: [{ key: 'builtin/general', name: 'general', description: 'A general assistant for any job.', source: 'builtin' }] },
    { id: 'project', label: 'This project', kind: 'project', agents: [{ key: 'project/reviewer', name: 'reviewer', description: 'Reviews changes for bugs and security issues.', model: 'sonnet', source: 'project' }] },
    { id: 'donchitos__claude-code-game-studios', label: 'Claude Code Game Studios', kind: 'repo', agents: [
      { key: 'repo:gs/creative-director', name: 'creative-director', description: "Guards the game's vision and tone.", source: 'repo' },
      { key: 'repo:gs/gameplay-programmer', name: 'gameplay-programmer', description: 'Writes the gameplay systems.', source: 'repo' },
      { key: 'repo:gs/qa-lead', name: 'qa-lead', description: 'Test plans and bug tracking.', source: 'repo' },
    ] },
  ],
  recommended: [{ url: 'https://github.com/Donchitos/Claude-Code-Game-Studios', label: 'Claude Code Game Studios', note: "A game studio's whole team.", imported: true }],
};
const demoWorkerList = [];
let wSeq = 0;
const winj = (e) => session.inject(e);
async function demoWorkers(c) {
  if (c.cmd === 'library') return winj(DEMO_LIBRARY);
  if (c.cmd === 'workers') return winj({ type: 'workers', max: 5, available: true, list: demoWorkerList });
  if (c.cmd === 'worker_add') {
    if (demoWorkerList.length >= 5) return winj({ type: 'error', message: 'At most 5 agents can work in the office.' });
    const name = c.key.split('/').pop();
    const w = { id: `d${++wSeq}`, name, title: name, defKey: c.key, description: '', state: 'idle', text: 'Arrived at the office', queued: 0 };
    demoWorkerList.push(w);
    return winj({ type: 'worker_added', worker: w });
  }
  if (c.cmd === 'worker_remove') {
    demoWorkerList.splice(demoWorkerList.findIndex((w) => w.id === c.id), 1);
    return winj({ type: 'worker_removed', id: c.id });
  }
  if (c.cmd === 'worker_send') {
    winj({ type: 'worker_chat', id: c.id, role: 'user', text: c.text, msgId: `x${Date.now()}`, clientId: c.clientId });
    winj({ type: 'worker_state', id: c.id, state: 'working', text: 'Thinking…' });
    await wait(1200);
    winj({ type: 'worker_tool', id: c.id, phase: 'start', tool: 'Read', input: { file_path: 'src/ui.js' }, toolUseId: 't1' });
    await wait(1500);
    winj({ type: 'worker_tool', id: c.id, phase: 'end', toolUseId: 't1' });
    winj({ type: 'worker_chat', id: c.id, role: 'assistant', text: `(Demo) I worked on "${c.text}" and I'm done.` });
    winj({ type: 'worker_stats', id: c.id, tokens: 18200, costUsd: 0.021 });
    return winj({ type: 'worker_state', id: c.id, state: 'idle', text: 'Finished its task' });
  }
  if (c.cmd === 'meeting_start') {
    winj({ type: 'meeting_started', topic: c.topic, participants: c.participants });
    for (const id of c.participants) {
      winj({ type: 'meeting_turn', speaker: id });
      await wait(1400);
      winj({ type: 'meeting_line', speaker: id, text: `(Demo) Two suggestions for "${c.topic}" from my side: narrow the scope first, then write tests.` });
    }
    return winj({ type: 'meeting_phase', phase: 'waiting' });
  }
  if (c.cmd === 'meeting_interject') return winj({ type: 'meeting_line', speaker: 'user', text: c.text });
  if (c.cmd === 'meeting_end') {
    winj({ type: 'meeting_phase', phase: 'ending' });
    await wait(1200);
    return winj({ type: 'meeting_summary', summary: '- Decision: the scope is narrowed.\n- Each agent writes tests for its own area.' });
  }
}

const DEMO_ROSTER = {
  type: 'roster',
  cwd: 'C:\\Users\\dev\\Desktop\\Claudio',
  agents: [
    { name: 'Explore', description: 'Fast, read-only search through the codebase.', source: 'builtin' },
    { name: 'general-purpose', description: 'Complex, multi-step work; can search, read and edit.', source: 'builtin' },
    { name: 'Plan', description: 'Drafts an implementation plan; changes no files.', source: 'builtin' },
    { name: 'reviewer', description: 'Reviews changes for bugs, security and readability.', model: 'sonnet', source: 'project' },
    { name: 'docs:writer', description: 'Writes READMEs and user guides.', source: 'plugin:docs' },
  ],
  skills: [{ name: 'release', description: 'Cuts a release: version numbers, CHANGELOG, tag.', source: 'project' }],
  commands: [{ name: '/review', description: 'Review the open changes', hint: '[file]', source: 'user' }],
};

const DEMO_TASKS = (step) => [
  { id: '1', subject: "Find the agent card's code", status: 'completed', blocked: false },
  { id: '2', subject: 'Plan the tabs', activeForm: 'Planning the tabs', status: step > 0 ? 'completed' : 'in_progress', blocked: false },
  { id: '3', subject: 'Add quick commands', activeForm: 'Adding quick commands', status: step > 0 ? 'in_progress' : 'pending', blocked: false },
  { id: '4', subject: 'Run the build', status: 'pending', blocked: true },
];

const shell = async (agent, command, ok, output = '', ms = 1200) => {
  const extra = agent ? { agent_id: agent, agent_type: 'Plan' } : {};
  hook('PreToolUse', { ...extra, tool_name: 'Bash', tool_input: { command } });
  session.inject({ type: 'signal', phase: 'start', agentId: agent, signals: [{ kind: /test/.test(command) ? 'test' : /push/.test(command) ? 'push' : 'build', target: null, decides: true }] });
  await wait(ms);
  const kind = /test/.test(command) ? 'test' : /push/.test(command) ? 'push' : 'build';
  if (ok) hook('PostToolUse', { ...extra, tool_name: 'Bash', tool_input: { command } });
  else hook('PostToolUseFailure', { ...extra, tool_name: 'Bash', error: output });
  session.inject({ type: 'signal', phase: 'end', agentId: agent, signals: [{ kind, target: kind === 'push' ? 'main' : 'npm', toDefault: true, decides: true, result: ok ? 'ok' : 'fail', detail: ok ? null : '2 failed', error: ok ? null : output }] });
};

async function demoSignals() {
  await shell(null, 'npm run build', true);
  hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'plan-1', message: 'Run the tests too' } });
  await shell('plan-1', 'npm test', false, 'Exit code 1: 2 failing');
  await shell(null, 'npm test', false, 'Exit code 1: 2 failing');
  await shell(null, 'npm test', false, 'Exit code 1: 2 failing');
  await wait(6000);
  await shell(null, 'npm test', true);
  await shell(null, 'git push origin main', true);
}

async function demoMeeting() {
  session.inject({ type: 'busy', busy: true });
  hook('UserPromptSubmit', {});
  await wait(1200);
  session.inject({ type: 'chat', role: 'assistant', text: 'Opening the meeting. Me: the card tabs are ready and the tests pass.' });
  await tool(undefined, undefined, 'SendMessage', { to: 'plan-1', message: 'What is your status?' }, 1500);
  session.inject({ type: 'chat', role: 'assistant', text: 'Plan: the card design notes are in docs/phase3.md and wait on one decision.' });
  await wait(800);
  session.inject({
    type: 'request', requestId: 'mq1', kind: 'question', sessionId: SID, toolName: 'AskUserQuestion', agentId: null,
    input: { questions: [{ question: 'Should the meeting room ship in the first release?', header: 'Scope', multiSelect: false, options: [{ label: 'Yes', description: 'Together with phase 5' }, { label: 'Later', description: 'Polish first' }] }] },
  });
  busy = false;
  hook('Stop', {});
  session.inject({ type: 'busy', busy: false });
}

async function demoSummary() {
  session.inject({ type: 'busy', busy: true });
  await wait(1500);
  session.inject({ type: 'chat', role: 'assistant', text: '## Meeting summary\n- Decision: the meeting room ships in this release.\n- The Plan agent finishes the design notes.\n- Next step: polish and packaging.' });
  hook('Stop', {});
  session.inject({ type: 'busy', busy: false });
}

export async function runDevDemo() {
  session.useDevBridge(devBridge);
  session.inject({ type: 'ready', fake: true, attached: null, answerInOffice: true });
  session.inject({ type: 'hooks_status', installed: true, error: null });
  session.inject({ type: 'sessions', list: [{ sessionId: SID, name: 'Demo · office prototype', cwd: 'C:\\Users\\dev\\Desktop\\Claudio', status: 'busy', updatedAt: Date.now() }] });
  session.inject({ type: 'attached', sessionId: SID, name: 'Demo · office prototype', cwd: 'C:\\Users\\dev\\Desktop\\Claudio', busy: true });
  session.inject({ type: 'history', items: [{ role: 'user', text: 'Build the agent card for phase 3' }, { role: 'assistant', text: 'Looking at the project first.' }] });
  session.inject({ type: 'busy', busy: true });
  session.inject(DEMO_ROSTER);
  session.inject({ type: 'tasks', sessionId: SID, tasks: DEMO_TASKS(0) });
  session.inject({ type: 'usage', sessionId: SID, model: 'claude-opus-5-5', context: 312000, window: 1000000, approximate: false, percent: 31, perMinute: 48200 });

  await wait(600);
  hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Scan the source files' } });
  hook('SubagentStart', { agent_id: 'explore-1', agent_type: 'Explore' });
  session.inject({ type: 'agent_chat', agentId: 'explore-1', role: 'user', text: 'Scan the panel code in src and find where the agent card is drawn.' });
  hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', description: 'Plan the card design' } });
  hook('SubagentStart', { agent_id: 'plan-1', agent_type: 'Plan' });
  session.inject({ type: 'agent_chat', agentId: 'plan-1', role: 'user', text: 'Plan the tabs and quick commands for the agent card.' });

  await Promise.all([
    (async () => {
      await tool('explore-1', 'Explore', 'Glob', { pattern: 'src/**/*.js' });
      await tool('explore-1', 'Explore', 'Read', { file_path: 'src/ui.js' }, 2200);
      session.inject({ type: 'agent_chat', agentId: 'explore-1', role: 'assistant', text: 'The card is drawn by the agentPanel function in ui.js.' });
      await tool('explore-1', 'Explore', 'Grep', { pattern: 'renderThread' });
      hook('PreToolUse', { agent_id: 'explore-1', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'npm test' } });
      await wait(900);
      hook('PostToolUseFailure', { agent_id: 'explore-1', agent_type: 'Explore', tool_name: 'Bash', error: 'Exit code 1: 2 failing' });
    })(),
    (async () => {
      await tool('plan-1', 'Plan', 'Read', { file_path: 'CLAUDE.md' }, 2600);
      session.inject({ type: 'agent_chat', agentId: 'plan-1', role: 'assistant', text: 'Two tabs are enough: Chat and Steps. Quick commands go below the chat.' });
      await tool('plan-1', 'Plan', 'Write', { file_path: 'docs/phase3.md' }, 2400);
    })(),
  ]);

  session.inject({
    type: 'request', requestId: 'q1', kind: 'question', sessionId: SID, toolName: 'AskUserQuestion', agentId: null,
    input: { questions: [{ question: 'Where should the quick commands go?', header: 'Placement', multiSelect: false, options: [{ label: 'Below the chat', description: 'Right above the text box' }, { label: 'In the header', description: "Next to the agent's name" }] }] },
  });
  await wait(4000);
  session.inject({
    type: 'request', requestId: 'p1', kind: 'permission', sessionId: SID, toolName: 'Bash', agentId: null, input: { command: 'npm run build' },
    suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run build' }], behavior: 'allow', destination: 'session' }],
  });
  hook('SubagentStop', { agent_id: 'explore-1', agent_type: 'Explore' });
  session.inject({ type: 'agent_stats', agentId: 'explore-1', model: 'claude-haiku-5-5', tokens: 41800 });
  session.inject({ type: 'tasks', sessionId: SID, tasks: DEMO_TASKS(1) });
  // plan-1 stays open so a meeting can be tried with a subagent in the room.
  await wait(3000);
  busy = false;
  hook('Stop', {});
  session.inject({ type: 'busy', busy: false });

  // Signals: a green build, then failing tests that set off the alarm, then green again.
  if (new URLSearchParams(location.search).has('alarm')) await demoSignals();

  // A second, unattached session starts waiting for a permission answer in its terminal.
  await wait(1500);
  session.inject({
    type: 'sessions',
    list: [
      { sessionId: SID, name: 'Demo · office prototype', cwd: 'C:\\Users\\dev\\Desktop\\Claudio', status: 'idle', updatedAt: Date.now(), waiting: null },
      { sessionId: 'demo-other', name: '', cwd: 'C:\\Users\\dev\\code\\api', status: 'busy', updatedAt: Date.now(), waiting: 'permission' },
      { sessionId: 'demo-web', name: 'Landing page', cwd: 'C:\\Users\\dev\\code\\web', status: 'idle', updatedAt: Date.now() - 90_000, waiting: 'done' },
    ],
  });
}
