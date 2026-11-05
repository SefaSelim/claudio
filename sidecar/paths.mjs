// Settings shared by the bridge and the waiter.

import os from 'node:os';
import path from 'node:path';

// CLAUDIO_BRIDGE_PORT exists for the test suite, so it never collides with a running office.
export const BRIDGE_PORT = Number(process.env.CLAUDIO_BRIDGE_PORT) || 47821;

export const appDir = () => path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'com.sefaselim.claudio');

/** The file that holds the bridge token (in the Tauri app's data folder). */
export function tokenFile() {
  return path.join(appDir(), 'bridge.json');
}

/** The folder where attachments sent from the office are saved. */
export function attachmentsDir() {
  return path.join(appDir(), 'attachments');
}
