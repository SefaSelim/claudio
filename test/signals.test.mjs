import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, segments, outcome, errorLine } from '../sidecar/signals.mjs';

const kinds = (cmd) => classify(cmd).map((s) => `${s.kind}:${s.target}`);

test('segments split outside quotes', () => {
  assert.deepEqual(segments('cd app && npm test | tail -5; echo "a && b"').map((s) => [s.text, s.sep]), [
    ['cd app', '&&'], ['npm test', '|'], ['tail -5', ';'], ['echo "a && b"', null],
  ]);
  assert.equal(segments('npm run build 2>&1').length, 1);
});

test('ordinary commands are not signals', () => {
  for (const cmd of ['ls -la', 'git status', 'cat package.json', 'npm install', 'git push --dry-run origin main', 'npm test --help', 'make clean', 'docker ps', 'echo deploy']) {
    assert.deepEqual(classify(cmd), [], cmd);
  }
});

test('deploys', () => {
  assert.deepEqual(kinds('vercel --prod'), ['deploy:vercel']);
  assert.deepEqual(kinds('npx wrangler deploy'), ['deploy:cloudflare']);
  assert.deepEqual(kinds('kubectl apply -f k8s/'), ['deploy:kubernetes']);
  assert.deepEqual(kinds('gh release create v1.2.0 --notes-file n.md'), ['deploy:GitHub release']);
  assert.deepEqual(kinds('git push origin v0.7.0'), ['deploy:tag']);
  assert.deepEqual(kinds('npm publish --access public'), ['deploy:npm publish']);
  assert.deepEqual(kinds('terraform apply -auto-approve'), ['deploy:terraform']);
});

test('builds and tests, through wrappers and Windows names', () => {
  assert.deepEqual(kinds('npm run build'), ['build:build']);
  assert.deepEqual(kinds('pnpm build:web'), ['build:build:web']);
  assert.deepEqual(kinds('npx vite build'), ['build:vite']);
  assert.deepEqual(kinds('NODE_ENV=production timeout 300 npm.cmd run build'), ['build:build']);
  assert.deepEqual(kinds('npx tauri build'), ['build:tauri']);
  assert.deepEqual(kinds('cargo build --release'), ['build:cargo']);
  assert.deepEqual(kinds('npm test'), ['test:npm']);
  assert.deepEqual(kinds('yarn test:unit'), ['test:test:unit']);
  assert.deepEqual(kinds('python -m pytest -q'), ['test:pytest']);
  assert.deepEqual(kinds('node --test test/'), ['test:node']);
  assert.deepEqual(kinds('C:\\tools\\vitest.cmd run'), ['test:vitest']);
});

test('git push target and default branch', () => {
  const [p] = classify('git push origin main');
  assert.equal(p.kind, 'push');
  assert.equal(p.toDefault, true);
  assert.equal(classify('git push -u origin feat/x')[0].toDefault, false);
  assert.equal(classify('git push origin HEAD:master')[0].toDefault, true);
  assert.equal(classify('git push')[0].target, null);
});

test('decides: piped, || and ; segments do not decide the exit status', () => {
  const sigs = classify('npm test | tail -20');
  assert.equal(sigs[0].decides, false);
  assert.equal(classify('npm run build && npm test')[1].decides, true);
  assert.equal(classify('npm test || true')[0].decides, false);
  assert.equal(classify('npm test; echo done')[0].decides, false);
});

test('outcome: success, failure blame and output judging', () => {
  const sigs = classify('npm run build && npm test');
  const ok = outcome(sigs, { ok: true, output: '12 passing' });
  assert.deepEqual(ok.map((s) => s.result), ['ok', 'ok']);
  const bad = outcome(sigs, { ok: false, error: 'Exit code 1\n  3 failing\n  Error: expected 2 to equal 3' });
  assert.deepEqual(bad.map((s) => s.result), [null, 'fail']);
  assert.equal(bad[1].detail, '3 başarısız');
  const piped = outcome(classify('npm test | tail'), { ok: true, output: 'Tests: 2 failed, 10 passed' });
  assert.equal(piped[0].result, 'fail');
  const silent = outcome(classify('npm test | tail'), { ok: true, output: '' });
  assert.equal(silent[0].result, null);
  const zero = outcome(classify('npm test'), { ok: true, output: '0 failing\n 5 passing' });
  assert.equal(zero[0].result, 'ok');
});

test('errorLine picks the meaningful line', () => {
  assert.equal(errorLine('\n> app@1.0 build\nsrc/a.ts(3,1): error TS2304: Cannot find name x\n    at foo'), 'src/a.ts(3,1): error TS2304: Cannot find name x');
  assert.equal(errorLine('Error: 503 Service Unavailable'), '503 Service Unavailable');
});
