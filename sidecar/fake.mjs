// Demo oturumu: CLAUDIO_FAKE=1 iken gerçek SDK yerine bu senaryo çalışır.
// API anahtarı olmadan ofisin olay akışını (alt ajanlar, araçlar, izin, soru) denemek için.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runFake({ emit, canUseTool, inbox, signal }) {
  let n = 0;
  const id = () => `demo-${++n}`;
  const hook = (event, extra) => emit({ type: 'hook', event, agent_id: null, agent_type: null, tool_name: null, tool_input: null, tool_use_id: null, ...extra });
  const say = (text) => emit({ type: 'sdk', message: { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } } });
  const tool = async (agent, type, name, input, ms = 1400) => {
    const tool_use_id = id();
    hook('PreToolUse', { agent_id: agent, agent_type: type, tool_name: name, tool_input: input, tool_use_id });
    await wait(ms);
    hook('PostToolUse', { agent_id: agent, agent_type: type, tool_name: name, tool_input: input, tool_use_id });
  };
  const ask = (name, input, agentID = null) =>
    canUseTool(name, input, { requestId: id(), toolUseID: id(), agentID, signal });

  emit({ type: 'sdk', message: { type: 'system', subtype: 'init', model: 'demo', permissionMode: 'default' } });
  await wait(900);
  say('Merhaba! Önce projeye bir göz atıyorum, sonra planı çıkarıp küçük bir değişiklik yapacağım.');
  await wait(1200);

  hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Kaynak dosyaları tara' } });
  await wait(600);
  hook('SubagentStart', { agent_id: 'explore-1', agent_type: 'Explore' });
  hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', description: 'Faz 2 planını çıkar' } });
  await wait(500);
  hook('SubagentStart', { agent_id: 'plan-1', agent_type: 'Plan' });

  await Promise.all([
    (async () => {
      await tool('explore-1', 'Explore', 'Glob', { pattern: 'src/**/*.js' });
      await tool('explore-1', 'Explore', 'Read', { file_path: 'src/scene.js' }, 1800);
      await tool('explore-1', 'Explore', 'Grep', { pattern: 'setIgnoreCursorEvents' });
      hook('SubagentStop', { agent_id: 'explore-1', agent_type: 'Explore' });
    })(),
    (async () => {
      await tool('plan-1', 'Plan', 'Read', { file_path: 'README.md' }, 2000);
      await tool('plan-1', 'Plan', 'Write', { file_path: 'docs/faz2.md' }, 2600);
    })(),
  ]);

  const answer = await ask('AskUserQuestion', {
    questions: [
      {
        question: 'Faz 2 ofisinde önce hangi oda yapılsın?',
        header: 'Oda',
        multiSelect: false,
        options: [
          { label: 'Açık ofis', description: 'Masalar, kitaplık, kahve köşesi' },
          { label: 'Toplantı odası', description: 'Uzun masa ve beyaz tahta' },
        ],
      },
    ],
  }, 'plan-1');
  const choice = answer.behavior === 'allow' ? Object.values(answer.updatedInput.answers ?? {})[0] : 'karar vermeden';
  await tool('plan-1', 'Plan', 'Edit', { file_path: 'docs/faz2.md' }, 1500);
  hook('SubagentStop', { agent_id: 'plan-1', agent_type: 'Plan' });
  say(`Plan hazır. Seçimin: ${choice}.`);
  await wait(800);

  const perm = await ask('Bash', { command: 'npm test' });
  if (perm.behavior === 'allow') {
    await tool(null, null, 'Bash', { command: 'npm test' }, 2200);
    say('Testler geçti. Sıra sende: bir sonraki adımı yaz.');
  } else {
    say('Testleri çalıştırmadım. Ne yapmamı istersin?');
  }
  hook('Stop', {});
  emit({ type: 'sdk', message: { type: 'result', subtype: 'success', total_cost_usd: 0 } });

  // Sonraki mesajlara kısa demo cevapları.
  for await (const msg of inbox) {
    const text = msg.message?.content ?? '';
    await wait(700);
    if (/^\[Ofis\]/.test(text)) {
      hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { description: 'Mesajı ilet' } });
      await wait(900);
      say(`İlettim: ${text.replace(/^\[Ofis\]\s*/, '')}`);
    } else {
      await tool(null, null, 'Read', { file_path: 'src/main.js' }, 1000);
      say(`(Demo) "${text}" üzerine çalışıyorum gibi yapıyorum.`);
    }
    hook('Stop', {});
    emit({ type: 'sdk', message: { type: 'result', subtype: 'success', total_cost_usd: 0 } });
  }
}
