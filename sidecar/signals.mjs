// Reads what a shell command means: a deploy, a build, a test run or a git push.
// The office uses it to put a small prop over the agent that runs it and to notice when
// things break. Only well-known programs count; anything else costs one regex test.

const WRAPPERS = new Set(['sudo', 'npx', 'bunx', 'pnpx', 'time', 'nice', 'nohup', 'env', 'cross-env', 'command', 'exec', 'call', '&']);
const NEVER = new Set(['--dry-run', '-n', '--help', '-h', '--version', '-v', '-V', '--what-if', '-WhatIf']);
const PRE = /\b(vercel|netlify|fly|flyctl|railway|heroku|gcloud|aws|sam|serverless|sls|kubectl|helm|terraform|tofu|pulumi|cdk|wrangler|firebase|gh|docker|podman|npm|pnpm|yarn|bun|vite|next|tsc|vue-tsc|cargo|go|make|gmake|gradle|gradlew|mvn|mvnw|docker|webpack|esbuild|dotnet|deno|vitest|jest|mocha|pytest|python3?|py|rspec|phpunit|playwright|git|node|tauri)\b/;

/** Split on && || ; | & and newlines, outside quotes. Each part keeps the separator after it. */
export function segments(command) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(command ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    const two = s.slice(i, i + 2);
    let sep = null;
    if (two === '&&' || two === '||') sep = two;
    else if (c === ';' || c === '\n' || c === '|' || (c === '&' && s[i + 1] !== '>' && s[i - 1] !== '>')) sep = c === '\n' ? ';' : c;
    if (sep) {
      out.push({ text: cur.trim(), sep });
      cur = '';
      if (sep.length === 2) i++;
      continue;
    }
    cur += c;
  }
  out.push({ text: cur.trim(), sep: null });
  return out.filter((x) => x.text);
}

function words(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Program name without a path or a Windows extension. */
const prog = (w) => String(w).split(/[\\/]/).pop().replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase();

/** Drop env assignments, wrappers and their arguments (timeout 60, nice -n 5). */
function core(ws) {
  let i = 0;
  while (i < ws.length) {
    const w = ws[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue; }
    const p = prog(w);
    if (p === 'timeout' || p === 'nice') { i += /^\d/.test(ws[i + 1] ?? '') || /^-/.test(ws[i + 1] ?? '') ? 2 : 1; continue; }
    if (WRAPPERS.has(p)) { i++; continue; }
    if (p === 'pnpm' && ws[i + 1] === 'dlx') { i += 2; continue; }
    break;
  }
  return ws.slice(i);
}

const isScript = (name, kind) =>
  kind === 'build' ? /^(build|compile|typecheck|tsc)([:-].*)?$/.test(name) : /^(test|tests|e2e|unit|spec)([:-].*)?$/.test(name);

/** One segment: { kind, target } or null. */
export function classifySegment(text) {
  const ws = core(words(text));
  if (!ws.length) return null;
  if (ws.some((w) => NEVER.has(w))) return null;
  const p = prog(ws[0]);
  const args = ws.slice(1);
  const a0 = args[0];
  const has = (...xs) => args.some((w) => xs.includes(w));
  switch (p) {
    case 'vercel': return a0 === 'deploy' || has('--prod', '--production') ? { kind: 'deploy', target: 'vercel' } : null;
    case 'netlify': return a0 === 'deploy' ? { kind: 'deploy', target: 'netlify' } : null;
    case 'fly': case 'flyctl': return a0 === 'deploy' ? { kind: 'deploy', target: 'fly' } : null;
    case 'railway': return a0 === 'up' ? { kind: 'deploy', target: 'railway' } : null;
    case 'gcloud': return args.includes('deploy') && ['run', 'app', 'functions'].includes(a0) ? { kind: 'deploy', target: `gcloud ${a0}` } : null;
    case 'aws': case 'sam': case 'serverless': case 'sls': case 'cdk': case 'firebase':
      return args.includes('deploy') ? { kind: 'deploy', target: p } : null;
    case 'kubectl': return ['apply', 'rollout'].includes(a0) ? { kind: 'deploy', target: 'kubernetes' } : null;
    case 'helm': return ['upgrade', 'install'].includes(a0) ? { kind: 'deploy', target: 'helm' } : null;
    case 'terraform': case 'tofu': return a0 === 'apply' ? { kind: 'deploy', target: p } : null;
    case 'pulumi': return a0 === 'up' ? { kind: 'deploy', target: 'pulumi' } : null;
    case 'wrangler': return ['deploy', 'publish'].includes(a0) ? { kind: 'deploy', target: 'cloudflare' } : null;
    case 'gh': return a0 === 'release' && args[1] === 'create' ? { kind: 'deploy', target: 'GitHub release' } : null;
    case 'docker': case 'podman':
      if (a0 === 'push') return { kind: 'deploy', target: 'image' };
      if (a0 === 'build' || (a0 === 'buildx' && args[1] === 'build')) return { kind: 'build', target: p };
      return null;
    case 'npm': case 'pnpm': case 'yarn': case 'bun': {
      if (['publish'].includes(a0)) return { kind: 'deploy', target: `${p} publish` };
      if (['test', 't', 'tst'].includes(a0)) return { kind: 'test', target: p };
      const script = ['run', 'run-script'].includes(a0) ? args[1] : p !== 'npm' ? a0 : null;
      if (!script) return null;
      if (isScript(script, 'test')) return { kind: 'test', target: script };
      if (isScript(script, 'build')) return { kind: 'build', target: script };
      if (script === 'tauri' && args.includes('build')) return { kind: 'build', target: 'tauri' };
      return null;
    }
    case 'tauri': return a0 === 'build' ? { kind: 'build', target: 'tauri' } : null;
    case 'vite': case 'next': return a0 === 'build' ? { kind: 'build', target: p } : null;
    case 'tsc': case 'vue-tsc': case 'webpack': case 'esbuild': return { kind: 'build', target: p };
    case 'cargo':
      if (a0 === 'build') return { kind: 'build', target: 'cargo' };
      if (a0 === 'test' || a0 === 'nextest') return { kind: 'test', target: 'cargo' };
      return null;
    case 'go': return a0 === 'build' ? { kind: 'build', target: 'go' } : a0 === 'test' ? { kind: 'test', target: 'go' } : null;
    case 'dotnet': return a0 === 'build' ? { kind: 'build', target: 'dotnet' } : a0 === 'test' ? { kind: 'test', target: 'dotnet' } : null;
    case 'deno': return a0 === 'test' ? { kind: 'test', target: 'deno' } : null;
    case 'make': case 'gmake': {
      const target = args.find((w) => !w.startsWith('-') && !w.includes('=')) ?? 'all';
      if (['test', 'check', 'tests'].includes(target)) return { kind: 'test', target: `make ${target}` };
      if (['deploy', 'release', 'publish'].includes(target)) return { kind: 'deploy', target: `make ${target}` };
      if (['clean', 'help', 'fmt', 'format', 'lint', 'install'].includes(target)) return null;
      return { kind: 'build', target: `make ${target}` };
    }
    case 'gradle': case 'gradlew':
      if (has('test', 'check')) return { kind: 'test', target: 'gradle' };
      if (has('build', 'assemble')) return { kind: 'build', target: 'gradle' };
      return null;
    case 'mvn': case 'mvnw':
      if (has('deploy')) return { kind: 'deploy', target: 'maven' };
      if (has('test')) return { kind: 'test', target: 'maven' };
      if (has('package', 'install', 'compile', 'verify')) return { kind: 'build', target: 'maven' };
      return null;
    case 'vitest': case 'jest': case 'mocha': case 'pytest': case 'rspec': case 'phpunit':
      return a0 === 'init' ? null : { kind: 'test', target: p };
    case 'playwright': return a0 === 'test' ? { kind: 'test', target: 'playwright' } : null;
    case 'python': case 'python3': case 'py':
      return a0 === '-m' && ['pytest', 'unittest'].includes(args[1]) ? { kind: 'test', target: args[1] } : null;
    case 'node': return a0 === '--test' ? { kind: 'test', target: 'node' } : null;
    case 'git': {
      if (a0 !== 'push') return null;
      const rest = args.slice(1).filter((w) => !w.startsWith('-'));
      if (has('--tags') || rest.some((w) => /^(refs\/tags\/)?v\d+(\.\d+)*/.test(w))) return { kind: 'deploy', target: 'tag' };
      if (rest[0] === 'heroku') return { kind: 'deploy', target: 'heroku' };
      const ref = rest[1] ? rest[1].split(':').pop() : null;
      return { kind: 'push', target: ref, toDefault: ref === 'main' || ref === 'master' };
    }
    default: return null;
  }
}

/**
 * Every signal in a command. `decides` is true when the segment's exit status is the
 * command's: it is not piped, not followed by `;` or `||`, and not after a `||`.
 */
export function classify(command) {
  if (!PRE.test(String(command ?? ''))) return [];
  const parts = segments(command);
  const out = [];
  parts.forEach((part, i) => {
    if (/^cd\b|^Set-Location\b|^pushd\b/i.test(part.text)) return;
    const sig = classifySegment(part.text);
    if (!sig) return;
    const prev = parts[i - 1]?.sep;
    const decides = (part.sep === null || part.sep === '&&') && prev !== '||' && prev !== '|';
    out.push({ ...sig, command: part.text.slice(0, 160), decides });
  });
  return out;
}

const FAIL_COUNT = /(\d+)\s+(failing|failed|failures?|errors?)\b/i;
const PASS_COUNT = /(\d+)\s+(passing|passed|tests? passed|ok)\b/i;
const FAIL_WORDS = /\b(build failed|failed to compile|compilation failed|error TS\d+|error\[E\d+\]|\[rejected\]|FAILED|npm ERR!|ERR_PNPM|deploy(ment)? failed)\b/;
const ERROR_LINE = /error|fail|fatal|denied|not found|cannot|could not|unable|refused|rejected|exception|panic|timed out/i;

/** First meaningful line of an error, for the chat row. */
export function errorLine(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => ERROR_LINE.test(l) && !/^at\s/.test(l)) ?? lines[0] ?? '';
  return line.replace(/^Error:\s*/, '').slice(0, 160);
}

function judgeOutput(sig, output) {
  const fail = FAIL_COUNT.exec(output);
  if (fail && Number(fail[1]) > 0 && !/\b0\s+(failing|failed)/i.test(fail[0])) return { result: 'fail', detail: `${fail[1]} ${/error/i.test(fail[2]) ? 'hata' : 'başarısız'}` };
  if (FAIL_WORDS.test(output)) return { result: 'fail', detail: null };
  if ((sig.kind === 'test' || sig.kind === 'build') && PASS_COUNT.test(output)) return { result: 'ok', detail: null };
  return null;
}

/**
 * Outcome of each signal once the call is over.
 * ok: whether the call succeeded (PostToolUse) or not (PostToolUseFailure).
 */
export function outcome(signals, { ok, output = '', error = '' }) {
  const text = `${output}\n${error}`;
  // On a failure, blame the last segment that could have ended the call.
  const blamed = ok ? null : [...signals].reverse().find((s) => s.decides) ?? signals[signals.length - 1];
  return signals.map((sig) => {
    if (ok && sig.decides) {
      // A test runner that exits 0 can still print failures (`|| true` is caught above).
      const judged = judgeOutput(sig, output);
      return { ...sig, result: judged?.result === 'fail' ? 'fail' : 'ok', detail: judged?.detail ?? null, error: judged?.result === 'fail' ? errorLine(output) : null };
    }
    if (!ok && sig === blamed) {
      const judged = judgeOutput(sig, text);
      return { ...sig, result: 'fail', detail: judged?.detail ?? null, error: errorLine(error || output) };
    }
    const judged = judgeOutput(sig, output);
    return { ...sig, result: judged?.result ?? null, detail: judged?.detail ?? null, error: judged?.result === 'fail' ? errorLine(output) : null };
  });
}
