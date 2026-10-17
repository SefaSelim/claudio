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
      session.inject({ type: 'delivered', id, via: busy ? 'araç sonrası' : 'uyandırma' });
      session.inject({ type: 'chat', role: 'assistant', text: `(Demo) Mesajını aldım: "${command.text}"` });
    }, 1500);
  }
  if (command.cmd === 'answer') session.inject({ type: 'chat', role: 'system', text: `Demo: istek cevaplandı (${command.behavior}).` });
  if (command.cmd === 'set_option') session.inject({ type: 'options', ...command.options });
}

export async function runDevDemo() {
  session.useDevBridge(devBridge);
  session.inject({ type: 'ready', fake: true, attached: null, answerInOffice: true });
  session.inject({ type: 'hooks_status', installed: true, error: null });
  session.inject({ type: 'sessions', list: [{ sessionId: SID, name: 'Demo · ofis prototipi', cwd: 'C:\\Users\\Selim\\Desktop\\Claudio', status: 'busy', updatedAt: Date.now() }] });
  session.inject({ type: 'attached', sessionId: SID, name: 'Demo · ofis prototipi', cwd: 'C:\\Users\\Selim\\Desktop\\Claudio', busy: true });
  session.inject({ type: 'history', items: [{ role: 'user', text: 'Faz 3 için ajan kartını yap' }, { role: 'assistant', text: 'Önce projeye bakıyorum.' }] });
  session.inject({ type: 'busy', busy: true });

  await wait(600);
  hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Kaynak dosyaları tara' } });
  hook('SubagentStart', { agent_id: 'explore-1', agent_type: 'Explore' });
  session.inject({ type: 'agent_chat', agentId: 'explore-1', role: 'user', text: 'src klasöründeki panel kodunu tara ve ajan kartının nerede çizildiğini bul.' });
  hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', description: 'Kart tasarımını planla' } });
  hook('SubagentStart', { agent_id: 'plan-1', agent_type: 'Plan' });
  session.inject({ type: 'agent_chat', agentId: 'plan-1', role: 'user', text: 'Ajan kartı için sekmeleri ve hızlı komutları planla.' });

  await Promise.all([
    (async () => {
      await tool('explore-1', 'Explore', 'Glob', { pattern: 'src/**/*.js' });
      await tool('explore-1', 'Explore', 'Read', { file_path: 'src/ui.js' }, 2200);
      session.inject({ type: 'agent_chat', agentId: 'explore-1', role: 'assistant', text: 'Kart ui.js içinde agentPanel fonksiyonunda çiziliyor.' });
      await tool('explore-1', 'Explore', 'Grep', { pattern: 'renderThread' });
    })(),
    (async () => {
      await tool('plan-1', 'Plan', 'Read', { file_path: 'CLAUDE.md' }, 2600);
      session.inject({ type: 'agent_chat', agentId: 'plan-1', role: 'assistant', text: 'İki sekme yeterli: Sohbet ve Adımlar. Hızlı komutlar sohbetin altında.' });
      await tool('plan-1', 'Plan', 'Write', { file_path: 'docs/faz3.md' }, 2400);
    })(),
  ]);

  session.inject({
    type: 'request', requestId: 'q1', kind: 'question', sessionId: SID, toolName: 'AskUserQuestion', agentId: null,
    input: { questions: [{ question: 'Hızlı komutlar nerede dursun?', header: 'Yer', multiSelect: false, options: [{ label: 'Sohbetin altında', description: 'Yazı kutusunun hemen üstünde' }, { label: 'Başlıkta', description: 'Ajan adının yanında' }] }] },
  });
  await wait(4000);
  session.inject({
    type: 'request', requestId: 'p1', kind: 'permission', sessionId: SID, toolName: 'Bash', agentId: null, input: { command: 'npm run build' },
    suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm run build' }], behavior: 'allow', destination: 'session' }],
  });
  hook('SubagentStop', { agent_id: 'explore-1', agent_type: 'Explore' });
  await wait(3000);
  hook('SubagentStop', { agent_id: 'plan-1', agent_type: 'Plan' });
  await wait(2000);
  busy = false;
  hook('Stop', {});
  session.inject({ type: 'busy', busy: false });
}
