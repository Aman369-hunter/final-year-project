// Doctor data source. Live mode reads and writes the real backend (GET /api/cases,
// GET /api/cases/:id, POST .../transition, POST .../release) as the signed-in doctor;
// demo mode reads and writes the in-memory demo store and never touches the network.
// Both expose the same hooks, so the doctor pages do not know which they are on.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import * as demo from '../demo/store.js';
import { isDemo, useDemo } from '../demo/mode.js';
import { api } from '../lib/api.js';
import { compareByRisk } from '../lib/risk.js';

const DOCTOR_STATES = ['DOCTOR_REVIEW', 'REPORTED', 'REFERRED'];

// ---- live cache ----
let live = { cases: [], status: 'idle', error: null }; // status: idle | loading | ok | error
const listeners = new Set();
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const set = (next) => {
  live = { ...live, ...next };
  listeners.forEach((l) => l());
};

let lastLoadAt = 0;

export async function loadLive() {
  if (live.status === 'loading') return; // never run two fetches at once
  lastLoadAt = Date.now();
  set({ status: 'loading', error: null });
  try {
    const lists = await Promise.all(DOCTOR_STATES.map((s) => api.listCases(`?state=${s}&limit=100`)));
    const ids = lists.flatMap((l) => l.items.map((i) => i.id));
    const cases = (await Promise.all(ids.map((id) => api.getCase(id)))).map((r) => r.case);
    set({ cases, status: 'ok' });
  } catch (e) {
    set({ status: 'error', error: e.message });
  }
}

export function resetLive() {
  live = { cases: [], status: 'idle', error: null }; // e.g. on sign-out, so the next doctor never sees stale cases
  listeners.forEach((l) => l());
}

function upsert(c) {
  const exists = live.cases.some((x) => x.id === c.id);
  set({ cases: exists ? live.cases.map((x) => (x.id === c.id ? c : x)) : [...live.cases, c] });
}

// { cases, status, error, reload }
export function useDoctorData() {
  const on = useDemo();
  const snap = useSyncExternalStore(subscribe, () => live);
  const demoVersion = useSyncExternalStore(demo.subscribe, demo.getVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const demoCases = useMemo(() => (on ? demo.doctorCases() : null), [on, demoVersion]);
  useEffect(() => {
    if (!on && snap.status === 'idle') loadLive();
  }, [on, snap.status]);

  // The lab usually works in another tab. Without this, a doctor who left this
  // page open never sees a case that reached DOCTOR_REVIEW in the meantime --
  // the list is only fetched once, on mount. Refetch when the tab comes back to
  // the front, throttled so flicking between tabs doesn't hammer the API.
  useEffect(() => {
    if (on) return undefined;
    const refetch = () => {
      if (document.visibilityState !== 'visible') return;
      if (live.status === 'loading' || Date.now() - lastLoadAt < 3000) return;
      loadLive();
    };
    document.addEventListener('visibilitychange', refetch);
    window.addEventListener('focus', refetch);
    return () => {
      document.removeEventListener('visibilitychange', refetch);
      window.removeEventListener('focus', refetch);
    };
  }, [on]);
  const reload = useCallback(() => (isDemo() ? undefined : loadLive()), []);
  return on ? { cases: demoCases, status: 'ok', error: null, reload } : { ...snap, reload };
}

export const useDoctorCases = () => useDoctorData().cases;

export function worklist(all) {
  return all.filter((c) => c.state === 'DOCTOR_REVIEW').sort(compareByRisk);
}

// Both return the updated case (so the caller can build the PDF from it).
export async function transition(id, to, reason) {
  if (isDemo()) return demo.transition('doctor', id, to, reason).case;
  const { case: c } = await api.transition(id, to, reason);
  upsert(c);
  return c;
}

export async function release(id, note) {
  if (isDemo()) return demo.release(id, note).case;
  const { case: c } = await api.release(id, note);
  upsert(c);
  return c;
}
