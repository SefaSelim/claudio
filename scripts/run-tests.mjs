// Runs every test/*.test.mjs with node:test. `node --test test/` stopped accepting a
// directory in Node 22, and shell globs do not expand on Windows, so list them here.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('test').filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `test/${f}`);
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
