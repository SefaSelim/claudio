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
      if (command.text.startsWith(session.MEETING_START)) demoMeeting();
      else if (command.text.startsWith(session.MEETING_END)) demoSummary();
      else session.inject({ type: 'chat', role: 'assistant', text: `(Demo) Mesajını aldım: "${command.text}"` });
    }, 1500);
  }
  if (command.cmd === 'answer') session.inject({ type: 'chat', role: 'system', text: `Demo: istek cevaplandı (${command.behavior}).` });
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
    { id: 'builtin', label: 'Yerleşik', kind: 'builtin', agents: [{ key: 'builtin/genel', name: 'genel', description: 'Her işe bakan genel bir asistan.', source: 'builtin' }] },
    { id: 'project', label: 'Bu proje', kind: 'project', agents: [{ key: 'project/reviewer', name: 'reviewer', description: 'Değişiklikleri hata ve güvenlik açısından inceler.', model: 'sonnet', source: 'project' }] },
    { id: 'donchitos__claude-code-game-studios', label: 'Claude Code Game Studios', kind: 'repo', agents: [
      { key: 'repo:gs/creative-director', name: 'creative-director', description: 'Oyunun vizyonunu ve tonunu korur.', source: 'repo' },
      { key: 'repo:gs/gameplay-programmer', name: 'gameplay-programmer', description: 'Oynanış sistemlerini yazar.', source: 'repo' },
      { key: 'repo:gs/qa-lead', name: 'qa-lead', description: 'Test planı ve hata takibi.', source: 'repo' },
    ] },
  ],
  recommended: [{ url: 'https://github.com/Donchitos/Claude-Code-Game-Studios', label: 'Claude Code Game Studios', note: 'Bir oyun stüdyosunun ekibi.', imported: true }],
};
const demoWorkerList = [];
let wSeq = 0;
const winj = (e) => session.inject(e);
async function demoWorkers(c) {
  if (c.cmd === 'library') return winj(DEMO_LIBRARY);
  if (c.cmd === 'workers') return winj({ type: 'workers', max: 5, available: true, list: demoWorkerList });
  if (c.cmd === 'worker_add') {
    if (demoWorkerList.length >= 5) return winj({ type: 'error', message: 'Ofiste en fazla 5 ajan çalışabilir.' });
    const name = c.key.split('/').pop();
    const w = { id: `d${++wSeq}`, name, title: name, defKey: c.key, description: '', state: 'idle', text: 'Ofise geldi', queued: 0 };
    demoWorkerList.push(w);
    return winj({ type: 'worker_added', worker: w });
  }
  if (c.cmd === 'worker_remove') {
    demoWorkerList.splice(demoWorkerList.findIndex((w) => w.id === c.id), 1);
    return winj({ type: 'worker_removed', id: c.id });
  }
  if (c.cmd === 'worker_send') {
    winj({ type: 'worker_chat', id: c.id, role: 'user', text: c.text, msgId: `x${Date.now()}`, clientId: c.clientId });
    winj({ type: 'worker_state', id: c.id, state: 'working', text: 'Düşünüyor…' });
    await wait(1200);
    winj({ type: 'worker_tool', id: c.id, phase: 'start', tool: 'Read', input: { file_path: 'src/ui.js' }, toolUseId: 't1' });
    await wait(1500);
    winj({ type: 'worker_tool', id: c.id, phase: 'end', toolUseId: 't1' });
    winj({ type: 'worker_chat', id: c.id, role: 'assistant', text: `(Demo) "${c.text}" üzerinde çalıştım, işim bitti.` });
    winj({ type: 'worker_stats', id: c.id, tokens: 18200, costUsd: 0.021 });
    return winj({ type: 'worker_state', id: c.id, state: 'idle', text: 'İşini bitirdi' });
  }
  if (c.cmd === 'meeting_start') {
    winj({ type: 'meeting_started', topic: c.topic, participants: c.participants });
    for (const id of c.participants) {
      winj({ type: 'meeting_turn', speaker: id });
      await wait(1400);
      winj({ type: 'meeting_line', speaker: id, text: `(Demo) "${c.topic}" için kendi alanımdan iki öneri: önce kapsamı daraltalım, sonra test yazalım.` });
    }
    return winj({ type: 'meeting_phase', phase: 'waiting' });
  }
  if (c.cmd === 'meeting_interject') return winj({ type: 'meeting_line', speaker: 'user', text: c.text });
  if (c.cmd === 'meeting_end') {
    winj({ type: 'meeting_phase', phase: 'ending' });
    await wait(1200);
    return winj({ type: 'meeting_summary', summary: '- Karar: kapsam daraltıldı.\n- Her ajan kendi alanında test yazacak.' });
  }
}

const DEMO_ROSTER = {
  type: 'roster',
  cwd: 'C:\\Users\\Selim\\Desktop\\Claudio',
  agents: [
    { name: 'Explore', description: 'Kod tabanında hızlı, salt okunur arama.', source: 'builtin' },
    { name: 'general-purpose', description: 'Karmaşık, çok adımlı işler; arama, okuma ve düzenleme yapabilir.', source: 'builtin' },
    { name: 'Plan', description: 'Uygulama planı çıkarır; dosya değiştirmez.', source: 'builtin' },
    { name: 'reviewer', description: 'Değişiklikleri hata, güvenlik ve okunabilirlik açısından inceler.', model: 'sonnet', source: 'project' },
    { name: 'docs:writer', description: 'README ve kullanım kılavuzlarını yazar.', source: 'plugin:docs' },
  ],
  skills: [{ name: 'release', description: 'Sürüm çıkarır: sürüm numaraları, CHANGELOG, tag.', source: 'project' }],
  commands: [{ name: '/review', description: 'Açık değişiklikleri incele', hint: '[dosya]', source: 'user' }],
};

const DEMO_TASKS = (step) => [
  { id: '1', subject: 'Ajan kartının kodunu bul', status: 'completed', blocked: false },
  { id: '2', subject: 'Sekmeleri planla', activeForm: 'Sekmeler planlanıyor', status: step > 0 ? 'completed' : 'in_progress', blocked: false },
  { id: '3', subject: 'Hızlı komutları ekle', activeForm: 'Hızlı komutlar ekleniyor', status: step > 0 ? 'in_progress' : 'pending', blocked: false },
  { id: '4', subject: 'Derlemeyi çalıştır', status: 'pending', blocked: true },
];

const shell = async (agent, command, ok, output = '', ms = 1200) => {
  const extra = agent ? { agent_id: agent, agent_type: 'Plan' } : {};
  hook('PreToolUse', { ...extra, tool_name: 'Bash', tool_input: { command } });
  session.inject({ type: 'signal', phase: 'start', agentId: agent, signals: [{ kind: /test/.test(command) ? 'test' : /push/.test(command) ? 'push' : 'build', target: null, decides: true }] });
  await wait(ms);
  const kind = /test/.test(command) ? 'test' : /push/.test(command) ? 'push' : 'build';
  if (ok) hook('PostToolUse', { ...extra, tool_name: 'Bash', tool_input: { command } });
  else hook('PostToolUseFailure', { ...extra, tool_name: 'Bash', error: output });
  session.inject({ type: 'signal', phase: 'end', agentId: agent, signals: [{ kind, target: kind === 'push' ? 'main' : 'npm', toDefault: true, decides: true, result: ok ? 'ok' : 'fail', detail: ok ? null : '2 başarısız', error: ok ? null : output }] });
};

async function demoSignals() {
  await shell(null, 'npm run build', true);
  hook('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'plan-1', message: 'Testleri sen de çalıştır' } });
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
  session.inject({ type: 'chat', role: 'assistant', text: 'Toplantıyı açıyorum. Ben: kart sekmeleri hazır, testler geçiyor.' });
  await tool(undefined, undefined, 'SendMessage', { to: 'plan-1', message: 'Durumun ne?' }, 1500);
  session.inject({ type: 'chat', role: 'assistant', text: 'Plan: kart tasarım notları docs/faz3.md içinde, bir karar bekliyor.' });
  await wait(800);
  session.inject({
    type: 'request', requestId: 'mq1', kind: 'question', sessionId: SID, toolName: 'AskUserQuestion', agentId: null,
    input: { questions: [{ question: 'Toplantı odası ilk sürümde olsun mu?', header: 'Kapsam', multiSelect: false, options: [{ label: 'Evet', description: 'Faz 5 ile birlikte' }, { label: 'Sonra', description: 'Önce cila' }] }] },
  });
  busy = false;
  hook('Stop', {});
  session.inject({ type: 'busy', busy: false });
}

async function demoSummary() {
  session.inject({ type: 'busy', busy: true });
  await wait(1500);
  session.inject({ type: 'chat', role: 'assistant', text: '## Toplantı özeti\n- Karar: toplantı odası bu sürümde.\n- Plan ajanı tasarım notlarını tamamlayacak.\n- Sıradaki adım: cila ve paketleme.' });
  hook('Stop', {});
  session.inject({ type: 'busy', busy: false });
}

export async function runDevDemo() {
  session.useDevBridge(devBridge);
  session.inject({ type: 'ready', fake: true, attached: null, answerInOffice: true });
  session.inject({ type: 'hooks_status', installed: true, error: null });
  session.inject({ type: 'sessions', list: [{ sessionId: SID, name: 'Demo · ofis prototipi', cwd: 'C:\\Users\\Selim\\Desktop\\Claudio', status: 'busy', updatedAt: Date.now() }] });
  session.inject({ type: 'attached', sessionId: SID, name: 'Demo · ofis prototipi', cwd: 'C:\\Users\\Selim\\Desktop\\Claudio', busy: true });
  session.inject({ type: 'history', items: [{ role: 'user', text: 'Faz 3 için ajan kartını yap' }, { role: 'assistant', text: 'Önce projeye bakıyorum.' }] });
  session.inject({ type: 'busy', busy: true });
  session.inject(DEMO_ROSTER);
  session.inject({ type: 'tasks', sessionId: SID, tasks: DEMO_TASKS(0) });
  session.inject({ type: 'usage', sessionId: SID, model: 'claude-opus-5-5', context: 312000, window: 1000000, approximate: false, percent: 31, perMinute: 48200 });

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
      hook('PreToolUse', { agent_id: 'explore-1', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'npm test' } });
      await wait(900);
      hook('PostToolUseFailure', { agent_id: 'explore-1', agent_type: 'Explore', tool_name: 'Bash', error: 'Exit code 1: 2 failing' });
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
      { sessionId: SID, name: 'Demo · ofis prototipi', cwd: 'C:\\Users\\Selim\\Desktop\\Claudio', status: 'idle', updatedAt: Date.now(), waiting: null },
      { sessionId: 'demo-other', name: '', cwd: 'C:\\Users\\Selim\\code\\api', status: 'busy', updatedAt: Date.now(), waiting: 'permission' },
    ],
  });
}
