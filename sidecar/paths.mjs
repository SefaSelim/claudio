// Köprü ile bekçinin paylaştığı ayarlar.

import os from 'node:os';
import path from 'node:path';

// CLAUDIO_BRIDGE_PORT exists for the test suite, so it never collides with a running office.
export const BRIDGE_PORT = Number(process.env.CLAUDIO_BRIDGE_PORT) || 47821;

export const appDir = () => path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'com.sefaselim.claudio');

/** Köprü belirtecinin tutulduğu dosya (Tauri uygulamasının veri klasöründe). */
export function tokenFile() {
  return path.join(appDir(), 'bridge.json');
}

/** Ofisten gönderilen eklerin kaydedildiği klasör. */
export function attachmentsDir() {
  return path.join(appDir(), 'attachments');
}
