import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

// Windows notifications and a soft chime for things that need the user:
// permission prompts, questions, and long turns finishing.

const PREFS_KEY = 'claudio.alerts';
const defaults = { notify: true, sound: false };

export function loadAlertPrefs() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export function saveAlertPrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: prefs only last for this run.
  }
}

const inTauri = '__TAURI_INTERNALS__' in window;
let permission = null;

async function canNotify() {
  if (!inTauri) return false;
  if (permission === null) {
    permission = await isPermissionGranted();
    if (!permission) permission = (await requestPermission()) === 'granted';
  }
  return permission;
}

let audio = null;
function chime() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    // Two soft notes, like a desk bell.
    for (const [freq, at] of [[880, 0], [1320, 0.12]]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.07, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.4);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.45);
    }
  } catch {
    // Audio unavailable.
  }
}

/** Notify the user. Silently does nothing when both alerts are off. */
export async function alertUser(title, body) {
  const prefs = loadAlertPrefs();
  if (prefs.sound) chime();
  if (prefs.notify && (await canNotify())) sendNotification({ title, body });
}

export { chime as playChime };
