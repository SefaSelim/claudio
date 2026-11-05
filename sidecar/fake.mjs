// Demo mode (CLAUDIO_FAKE=1): a fake Claude Code session. It hands hook bodies to the bridge's real
// handleHook function, so permissions, questions and message delivery take the real code path.

const SESSION = 'demo-0000-claudio';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeRes = () => ({ writableEnded: false, on() {} });

export function sessions() {
  return [
    { sessionId: SESSION, name: 'Demo · office prototype', cwd: 'C:\\Users\\dev\\Desktop\\Claudio', status: 'busy', version: 'demo', entrypoint: 'cli', updatedAt: Date.now() },
    { sessionId: 'demo-1111-other', name: 'Demo · another project', cwd: 'C:\\Projects\\pixel-runner', status: 'idle', version: 'demo', entrypoint: 'cli', updatedAt: Date.now() - 60_000 },
  ];
}

export async function play({ sessionId, emit, handleHook, isAttached }) {
  emit({ type: 'history', items: [{ role: 'user', text: 'Look at the project and draft a plan for phase 2' }] });
  if (sessionId !== SESSION) return;
  const hook = (event, extra = {}) =>
    handleHook({ hook_event_name: event, session_id: sessionId, permission_mode: 'default', ...extra }, fakeRes());
  const tool = async (agent, type, name, input, ms = 1400) => {
    await hook('PreToolUse', { agent_id: agent, agent_type: type, tool_name: name, tool_input: input });
    await wait(ms);
    await hook('PostToolUse', { agent_id: agent, agent_type: type, tool_name: name, tool_input: input });
  };
  const say = (text) => isAttached(sessionId) && emit({ type: 'chat', role: 'assistant', text });

  await wait(800);
  say('Taking a look at the project first, then drafting the plan.');
  await hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Scan the source files' } });
  await hook('SubagentStart', { agent_id: 'explore-1', agent_type: 'Explore' });
  await hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', description: 'Draft the phase 2 plan' } });
  await hook('SubagentStart', { agent_id: 'plan-1', agent_type: 'Plan' });

  await Promise.all([
    (async () => {
      await tool('explore-1', 'Explore', 'Glob', { pattern: 'src/**/*.js' });
      await tool('explore-1', 'Explore', 'Read', { file_path: 'src/scene.js' }, 1800);
      await hook('SubagentStop', { agent_id: 'explore-1', agent_type: 'Explore' });
    })(),
    (async () => {
      await tool('plan-1', 'Plan', 'Read', { file_path: 'README.md' }, 2000);
      await tool('plan-1', 'Plan', 'Write', { file_path: 'docs/phase2.md' }, 2400);
    })(),
  ]);
  if (!isAttached(sessionId)) return;

  const questions = [{
    question: 'Which room should the phase 2 office get first?',
    header: 'Room',
    multiSelect: false,
    options: [
      { label: 'Open office', description: 'Desks, a bookshelf, a coffee corner' },
      { label: 'Meeting room', description: 'A long table and a whiteboard' },
    ],
  }];
  const out = await hook('PreToolUse', { agent_id: 'plan-1', agent_type: 'Plan', tool_name: 'AskUserQuestion', tool_input: { questions } });
  const choice = Object.values(out?.hookSpecificOutput?.updatedInput?.answers ?? {})[0] ?? 'answered in the terminal';
  await hook('SubagentStop', { agent_id: 'plan-1', agent_type: 'Plan' });
  say(`The plan is ready. Your choice: ${choice}.`);

  const perm = await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const allowed = perm?.hookSpecificOutput?.decision?.behavior === 'allow';
  if (allowed) await tool(null, null, 'Bash', { command: 'npm test' }, 2000);
  say(allowed ? 'The tests pass. Your turn.' : 'I did not run the tests. What would you like me to do?');
  await hook('Stop', {});
}

/** When the office sends a message, the fake session uses a tool; the message lands with PostToolUse. */
export async function deliver({ sessionId, handleHook }) {
  await wait(1200);
  const body = { hook_event_name: 'PostToolUse', session_id: sessionId, tool_name: 'Read', tool_input: { file_path: 'src/main.js' } };
  await handleHook({ ...body, hook_event_name: 'PreToolUse' }, fakeRes());
  await wait(900);
  await handleHook(body, fakeRes());
  await handleHook({ hook_event_name: 'Stop', session_id: sessionId }, fakeRes());
}
