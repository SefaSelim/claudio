import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageTail, contextWindow, lastUsage } from '../sidecar/sessions.mjs';

const line = (id, model, input, cacheRead, output, at, extra = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, model, usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, output_tokens: output } }, ...extra }) + '\n';

test('context windows', () => {
  assert.equal(contextWindow('claude-opus-5-5').size, 1_000_000);
  assert.equal(contextWindow('claude-sonnet-4-5-20250929').size, 200_000);
  assert.equal(contextWindow('claude-sonnet-4-5[1m]').size, 1_000_000);
  assert.equal(contextWindow('us.anthropic.claude-haiku-5-5').size, 1_000_000);
  assert.deepEqual(contextWindow('something-new'), { size: 200_000, approximate: true });
  assert.deepEqual(contextWindow('something-new', 300_000), { size: 1_000_000, approximate: true });
});

test('usage tail: dedupes streamed replies, skips sidechains, follows appends', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-usage-')), 't.jsonl');
  const now = Date.parse('2026-10-18T10:05:00Z');
  fs.writeFileSync(file, line('m1', 'claude-sonnet-4-5', 1000, 9000, 50, now - 120_000) + line('m1', 'claude-sonnet-4-5', 1000, 9000, 200, now - 119_000) + '{"type":"user"}\n');
  const tail = new UsageTail(file);
  assert.equal(tail.poll(now), true);
  let snap = tail.snapshot(now);
  assert.equal(snap.context, 10_200);
  assert.equal(snap.window, 200_000);
  assert.equal(snap.percent, 5);
  fs.appendFileSync(file, line('s1', 'claude-haiku-5-5', 5, 5, 5, now - 1000, { isSidechain: true }) + line('m2', 'claude-sonnet-4-5', 2000, 98_000, 100, now - 1000));
  tail.poll(now);
  snap = tail.snapshot(now);
  assert.equal(snap.context, 100_100);
  assert.equal(snap.percent, 50);
  assert.equal(snap.perMinute, Math.round((10_050 + 100_100) / 2));
  assert.equal(lastUsage(file).context, 100_100);
});
