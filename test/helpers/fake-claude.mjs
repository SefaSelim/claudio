// Stands in for `claude -p ... --output-format stream-json` in the tests.
// It logs each call to CLAUDIO_FAKE_LOG and answers in the same event format.
// Prompt words steer it: SLOW waits 1.5 s before answering, TOOL runs one fake tool call.

import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const prompt = opt('-p') ?? '';
const sessionId = opt('--session-id') ?? opt('--resume');
const agent = opt('--agent');
if (process.env.CLAUDIO_FAKE_LOG) {
  fs.appendFileSync(process.env.CLAUDIO_FAKE_LOG, JSON.stringify({ prompt, sessionId, resume: args.includes('--resume'), agent, mode: opt('--permission-mode'), agents: JSON.parse(opt('--agents') ?? '{}') }) + '\n');
}
const out = (o) => process.stdout.write(JSON.stringify({ session_id: sessionId, ...o }) + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

out({ type: 'system', subtype: 'init', cwd: process.cwd() });
if (/TOOL/.test(prompt)) {
  out({ type: 'assistant', message: { id: 'm-tool', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.js' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
}
if (/SLOW/.test(prompt)) await wait(1500);
const firstLine = prompt.split('\n').find((l) => l.trim()) ?? '';
const text = /Toplantı özeti/.test(prompt) ? '## Toplantı özeti\n- Karar: devam' : `${agent} dedi: ${firstLine.slice(0, 80)}`;
out({ type: 'assistant', message: { id: `m-${Date.now()}`, content: [{ type: 'text', text }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 1, duration_ms: 10, total_cost_usd: 0.001, usage: { input_tokens: 100, output_tokens: 20 } });
