import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnTracker, formatRecap, formatDuration } from '../src/turns.js';

test('a turn recap counts tools, failures, subagents and edited files', () => {
  let t = 1000;
  const tr = createTurnTracker(() => t);
  tr.hook({ event: 'UserPromptSubmit' });
  tr.hook({ event: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'a.js' } });
  tr.hook({ event: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\x\\src\\ui.js' } });
  tr.hook({ event: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\x\\src\\ui.js' } });
  tr.hook({ event: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  tr.hook({ event: 'PostToolUseFailure', tool_name: 'Bash', error: 'Exit code 1' });
  tr.hook({ event: 'PostToolUseFailure', tool_name: 'Bash', error: 'Interrupted by user' });
  tr.hook({ event: 'SubagentStart', agent_id: 'e1' });
  t += 95_000;
  const r = tr.finish();
  assert.deepEqual(r, { ms: 95_000, tools: 4, failures: 1, files: ['C:\\x\\src\\ui.js'], agents: 1 });
  assert.equal(formatRecap(r), 'Tur bitti · 1 dk 35 sn · 4 araç · 1 başarısız · 1 alt ajan · 1 dosya düzenlendi (ui.js)');
  assert.equal(tr.finish(), null);
});

test('a turn without tools has no recap; durations read naturally', () => {
  const tr = createTurnTracker(() => 0);
  tr.hook({ event: 'UserPromptSubmit' });
  assert.equal(tr.finish(), null);
  assert.equal(formatDuration(4_400), '4 sn');
  assert.equal(formatDuration(120_000), '2 dk');
  assert.equal(formatDuration(3_900_000), '1 sa 5 dk');
});
