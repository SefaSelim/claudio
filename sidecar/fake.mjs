// Demo modu (CLAUDIO_FAKE=1): sahte bir Claude Code oturumu. Hook gövdelerini köprünün gerçek
// handleHook fonksiyonuna verir; böylece izin, soru ve mesaj iletimi gerçek kod yolundan geçer.

const SESSION = 'demo-0000-claudio';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeRes = () => ({ writableEnded: false, on() {} });

export function sessions() {
  return [
    { sessionId: SESSION, name: 'Demo · ofis prototipi', cwd: 'C:\\Users\\Selim\\Desktop\\Claudio', status: 'busy', version: 'demo', entrypoint: 'cli', updatedAt: Date.now() },
    { sessionId: 'demo-1111-other', name: 'Demo · başka proje', cwd: 'C:\\Projects\\pixel-runner', status: 'idle', version: 'demo', entrypoint: 'cli', updatedAt: Date.now() - 60_000 },
  ];
}

export async function play({ sessionId, emit, handleHook, isAttached }) {
  emit({ type: 'history', items: [{ role: 'user', text: 'Projeye bak ve Faz 2 için plan çıkar' }] });
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
  say('Önce projeye bir göz atıyorum, sonra planı çıkarıyorum.');
  await hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Kaynak dosyaları tara' } });
  await hook('SubagentStart', { agent_id: 'explore-1', agent_type: 'Explore' });
  await hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', description: 'Faz 2 planını çıkar' } });
  await hook('SubagentStart', { agent_id: 'plan-1', agent_type: 'Plan' });

  await Promise.all([
    (async () => {
      await tool('explore-1', 'Explore', 'Glob', { pattern: 'src/**/*.js' });
      await tool('explore-1', 'Explore', 'Read', { file_path: 'src/scene.js' }, 1800);
      await hook('SubagentStop', { agent_id: 'explore-1', agent_type: 'Explore' });
    })(),
    (async () => {
      await tool('plan-1', 'Plan', 'Read', { file_path: 'README.md' }, 2000);
      await tool('plan-1', 'Plan', 'Write', { file_path: 'docs/faz2.md' }, 2400);
    })(),
  ]);
  if (!isAttached(sessionId)) return;

  const questions = [{
    question: 'Faz 2 ofisinde önce hangi oda yapılsın?',
    header: 'Oda',
    multiSelect: false,
    options: [
      { label: 'Açık ofis', description: 'Masalar, kitaplık, kahve köşesi' },
      { label: 'Toplantı odası', description: 'Uzun masa ve beyaz tahta' },
    ],
  }];
  const out = await hook('PreToolUse', { agent_id: 'plan-1', agent_type: 'Plan', tool_name: 'AskUserQuestion', tool_input: { questions } });
  const choice = Object.values(out?.hookSpecificOutput?.updatedInput?.answers ?? {})[0] ?? 'terminalde cevaplandı';
  await hook('SubagentStop', { agent_id: 'plan-1', agent_type: 'Plan' });
  say(`Plan hazır. Seçimin: ${choice}.`);

  const perm = await hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const allowed = perm?.hookSpecificOutput?.decision?.behavior === 'allow';
  if (allowed) await tool(null, null, 'Bash', { command: 'npm test' }, 2000);
  say(allowed ? 'Testler geçti. Sıra sende.' : 'Testleri çalıştırmadım. Ne yapmamı istersin?');
  await hook('Stop', {});
}

/** Ofisten mesaj gelince sahte oturum bir araç kullanır; mesaj PostToolUse ile teslim edilir. */
export async function deliver({ sessionId, handleHook }) {
  await wait(1200);
  const body = { hook_event_name: 'PostToolUse', session_id: sessionId, tool_name: 'Read', tool_input: { file_path: 'src/main.js' } };
  await handleHook({ ...body, hook_event_name: 'PreToolUse' }, fakeRes());
  await wait(900);
  await handleHook(body, fakeRes());
  await handleHook({ hook_event_name: 'Stop', session_id: sessionId }, fakeRes());
}
