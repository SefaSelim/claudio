// Claude Code'un asyncRewake hook'u olarak çalışır (SessionStart ve Stop'ta yeniden kurulur).
// Ofisten bu oturuma bir mesaj gelene kadar köprüyü bekler. Mesaj gelince stderr'e yazıp
// 2 koduyla çıkar: Claude Code, oturum boşta olsa bile Claude'u uyandırır ve metni ona gösterir.
// Ofis kapalıysa ya da daha yeni bir bekçi geldiyse sessizce 0 ile çıkar.

import fs from 'node:fs';
import http from 'node:http';
import { tokenFile, BRIDGE_PORT } from './paths.mjs';

const readStdin = () =>
  new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (d) => (data += d)).on('end', () => resolve(data));
  });

function request(sessionId, token) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: BRIDGE_PORT, path: `/wait?session=${encodeURIComponent(sessionId)}`, headers: { 'X-Claudio-Token': token } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (body += d)).on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

const input = JSON.parse((await readStdin()) || '{}');
const sessionId = input.session_id;
let token = '';
try {
  token = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')).token;
} catch {
  process.exit(0); // ofis hiç kurulmamış
}
if (!sessionId) process.exit(0);

for (;;) {
  const { status, body } = await request(sessionId, token);
  let reply = {};
  try {
    reply = status === 200 ? JSON.parse(body) : {};
  } catch {
    // bozuk cevap: çık
  }
  if (reply.kind === 'message' && reply.text) {
    process.stderr.write(reply.text);
    process.exit(2);
  }
  // "timeout": tekrar bekle. "superseded", 401 ya da bağlantı hatası (ofis kapalı): çık.
  if (reply.kind !== 'timeout') process.exit(0);
}
