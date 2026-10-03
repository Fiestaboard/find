// The values this page reads from localStorage, which may be unavailable
// (private window, site data blocked). Everything that interprets them
// lives in discovery.js.

import { RELAY_STORAGE_KEY, STORAGE_KEY } from "./discovery.js";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Boards opened from this page before. */
export function readRemembered(): string | null {
  return read(STORAGE_KEY);
}

/** Boards the sign-in relay at fiestaboard.app/auth remembers. Read only. */
export function readRelayRemembered(): string | null {
  return read(RELAY_STORAGE_KEY);
}

/** Returns whether the value was stored. */
export function writeRemembered(raw: string): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
