// Köprü ile bekçinin paylaştığı ayarlar.

import os from 'node:os';
import path from 'node:path';

export const BRIDGE_PORT = 47821;

/** Köprü belirtecinin tutulduğu dosya (Tauri uygulamasının veri klasöründe). */
export function tokenFile() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'com.sefaselim.claudio', 'bridge.json');
}
