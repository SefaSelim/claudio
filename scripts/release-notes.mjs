// Prints the CHANGELOG section of one version, for release notes.
// Usage: node scripts/release-notes.mjs 0.9.0

import fs from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>');
  process.exit(2);
}
const text = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = text.indexOf(`## [${version}]`);
if (start < 0) {
  console.error(`CHANGELOG has no section for ${version}`);
  process.exit(1);
}
const body = text.slice(text.indexOf('\n', start) + 1);
const end = body.search(/^## \[|^\[[^\]]+\]: /m);
process.stdout.write(`${(end < 0 ? body : body.slice(0, end)).trim()}\n`);
