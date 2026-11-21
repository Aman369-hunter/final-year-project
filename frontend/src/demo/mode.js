// The single demo-mode flag. Lives in sessionStorage (every access wrapped: it can
// be blocked) so a reload during a presentation stays in demo mode, while closing the
// tab returns to live. Nothing here touches the network.
import { useSyncExternalStore } from 'react';

const KEY = 'lsd-demo';
let on = false;
try {
  on = sessionStorage.getItem(KEY) === '1';
} catch {
  /* storage unavailable: demo simply starts off */
}

const listeners = new Set();
export const isDemo = () => on;

export function setDemo(next) {
  next = Boolean(next);
  if (next === on) return;
  on = next;
  try {
    sessionStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const subscribeDemo = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useDemo = () => useSyncExternalStore(subscribeDemo, isDemo, () => false);

// Thrown by the api layer's hard guard if ANY request would reach the real backend
// while demo mode is on. The adapter answers every call in memory, so this never
// fires in normal use; it exists so a future code path that forgets to go through the
// adapter fails loudly instead of reading or writing real data.
export class DemoBlockedError extends Error {
  constructor(method, path) {
    super(`Demo mode blocked a real ${method} ${path}: demo mode makes no calls to the live backend.`);
    this.name = 'DemoBlockedError';
    this.status = 0;
  }
}
