// The demo implementation of the api object: same method names, same response
// shapes, answered from the in-memory store. No fetch is ever made here, so nothing
// can reach the real database. Every payload passes through `shape`, which applies
// the backend's own prediction filter for non-doctor roles.
import * as store from './store.js';
import { DemoError } from './store.js';
// Static reference data, bundled read-only at build time. The live /api/reference/*
// routes need a signed-in user, and demo mode must work with no network at all.
import symptomCatalog from '../../../data/symptom-catalog.json';

const VARIANT_FILES = import.meta.glob('../../../data/variants/autocomplete/*.json', { import: 'default' });
const variantFile = (name) => VARIANT_FILES[`../../../data/variants/autocomplete/${name}.json`];


// Small artificial latency so loading skeletons are visible and the demo feels like
// the real thing. Tests set it to 0.
export const demoConfig = { latencyMs: 140 };

// The role comes from which dashboard is open, the same way a real session's token
// would pin it. The live session is never read or changed.
export function currentRole() {
  const seg = (typeof window === 'undefined' ? '' : window.location.pathname).split('/')[1];
  return seg === 'lab' ? 'lab' : seg === 'doctor' ? 'doctor' : 'patient';
}

const later = (fn) =>
  new Promise((resolve, reject) => {
    const run = () => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      }
    };
    if (demoConfig.latencyMs > 0) setTimeout(run, demoConfig.latencyMs);
    else queueMicrotask(run);
  });

const run = (fn) => later(() => {
  const role = currentRole();
  return store.shape(fn(role), role);
});

const parseQuery = (q = '') => Object.fromEntries(new URLSearchParams(q.replace(/^\?/, '')));

export const demoApi = {
  me: () => later(() => store.personaUser(currentRole())),
  listCases: (query) => run((role) => {
    const q = parseQuery(query);
    return store.listCases(role, { state: q.state, page: q.page ? +q.page : 1, limit: q.limit ? +q.limit : 20 });
  }),
  getCase: (id) => run((role) => store.getCase(role, id)),
  createCase: (symptoms) => run((role) => store.createCase(role, symptoms ? { symptoms } : {})),
  transition: (id, to, reason) => run((role) => store.transition(role, id, to, reason)),
  release: (id, note) => run((role) => (role === 'doctor' ? store.release(id, note) : (() => { throw new store.DemoError(403, 'role_not_permitted', 'Only a doctor can release results.'); })())),
  patchSymptoms: (id, symptoms) => run((role) => store.patchSymptoms(role, id, symptoms)),
  patchVitals: (id, vitals) => run((role) => store.patchVitals(role, id, vitals)),
  patchLabs: (id, labs) => run((role) => store.patchLabs(role, id, labs)),
  profile: () => run((role) => store.profile(role)),
  updateProfile: (patch) => run((role) => store.updateProfile(role, patch)),
  symptomCatalog: () => later(() => structuredClone(symptomCatalog)),
  variantGenes: () => variantFile('index')(),
  variantsFor: async (gene) => {
    const load = variantFile(String(gene).toUpperCase());
    if (!load) throw new DemoError(404, 'unknown_gene', 'No variant table for that gene.');
    return load();
  },
};

// Test seam: lets demo.test.js push a deliberately leaky payload through the exact
// role-shaping path every adapter call uses.
export const _run = run;
