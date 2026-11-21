// Proof that demo mode is write-isolated, label-safe and rule-faithful.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREDICTION_KEYS } from '../../../backend/src/middleware/predictionFilter.js';
import { _live, api, getToken } from '../lib/api.js';
import { _run, demoConfig } from './adapter.js';
import { isDemo, setDemo } from './mode.js';
import * as store from './store.js';
import scenarioFile from './scenarios.generated.json';
import { buildReportPdf } from '../lib/reportPdf.js';

const asRole = (role) => {
  globalThis.window = { location: { pathname: `/${role}` } };
};

// Every key anywhere in a payload.
function keysDeep(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keysDeep(x, out));
  return out;
}

let fetchMock;
beforeEach(() => {
  demoConfig.latencyMs = 0;
  store.reset();
  fetchMock = vi.fn(async () => {
    throw new Error('network must not be touched in demo mode');
  });
  vi.stubGlobal('fetch', fetchMock);
  setDemo(true);
  asRole('patient');
});
afterEach(() => {
  setDemo(false);
  vi.unstubAllGlobals();
  delete globalThis.window;
});

describe('write isolation', () => {
  it('makes ZERO network calls across every api method, reads and writes', async () => {
    // patient
    asRole('patient');
    await api.listCases();
    const created = await api.createCase();
    const id = created.case.id;
    await api.getCase(id);
    await api.patchSymptoms(id, [{ hpo_id: 'HP:0001744', label: 'Splenomegaly', present: true, severity: 2 }]);
    await api.transition(id, 'SUBMITTED');
    await api.profile();
    await api.updateProfile({ consanguinity: true, ethnicity: 'other', family_history: { affected_relative: true, relationship: 'cousin' } });
    await api.symptomCatalog();
    await api.variantGenes();
    await api.variantsFor('GBA1').catch(() => {});
    await api.me();
    // lab
    asRole('lab');
    await api.listCases('?state=SUBMITTED');
    await api.transition('demo-healthy', 'LAB_PENDING');
    await api.patchVitals('demo-healthy', { source: 'device', heart_rate_bpm: 80 });
    await api.patchLabs('demo-healthy', { routine: { hemoglobin_g_dl: 13 } });
    await api.transition('demo-healthy', 'DOCTOR_REVIEW');
    asRole('doctor');
    await api.release('demo-gaucher', 'n').catch(() => {}); // not REPORTED yet: rejected in memory, never sent
    // auth never runs
    expect(await api.tryResume()).toBeNull();
    await api.logout();
    expect(() => api.login('a@b.c', 'x')).toThrow(/Demo mode blocked/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the raw() hard guard blocks the REAL backend implementations if anything routes around the adapter', async () => {
    // Call the live (real-network) methods directly, in demo mode. Only the guard inside
    // raw() stands between these and a real request.
    const real = [
      () => _live.listCases(),
      () => _live.getCase('x'),
      () => _live.createCase(),
      () => _live.transition('x', 'SUBMITTED'),
      () => _live.patchSymptoms('x', []),
      () => _live.patchVitals('x', {}),
      () => _live.patchLabs('x', {}),
      () => _live.updateProfile({}),
      () => _live.symptomCatalog(),
      () => _live.login('a@b.c', 'pw'),
      () => _live.tryResume(),
    ];
    for (const call of real) await expect(call()).rejects.toThrow(/Demo mode blocked a real/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the live session survives demo mode', () => {
  it('keeps the live token through on → actions → sign-out attempt → off, with no extra requests', async () => {
    setDemo(false);
    fetchMock.mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: 'LIVE-TOKEN', user: { id: 'u1', name: 'Real Clinician', role: 'doctor' } }),
    }));
    await api.login('real@lsd.test', 'pw');
    expect(getToken()).toBe('LIVE-TOKEN');
    const callsAfterLogin = fetchMock.mock.calls.length;

    setDemo(true);
    asRole('doctor');
    await api.listCases();
    await api.logout(); // a demo "sign out" must not clear the real token
    await api.tryResume();
    expect(getToken()).toBe('LIVE-TOKEN');

    setDemo(false);
    expect(getToken()).toBe('LIVE-TOKEN');
    expect(fetchMock.mock.calls.length).toBe(callsAfterLogin); // nothing was sent while demo was on
  });

  it('demo edits never leak into the live path: switching off sends nothing and shows live data', async () => {
    asRole('lab');
    await api.transition('demo-healthy', 'LAB_PENDING');
    setDemo(false);
    expect(isDemo()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('safety rule: patients and labs never see risk scores (spec 6.4 r5)', () => {
  it('the prediction keys under test are exactly the backend filter keys', () => {
    expect([...PREDICTION_KEYS].sort()).toEqual(['category_scores', 'factors', 'predictions', 'risk_level']);
  });

  it.each(['patient', 'lab'])('%s payloads contain no prediction data, at any depth, for any case/state', async (role) => {
    asRole(role);
    // exercise the lifecycle so scored cases exist
    store.setPersona('gaucher');
    const seen = [];
    seen.push(await api.listCases());
    for (const c of store.doctorCases()) seen.push(await api.getCase(c.id).catch(() => null));
    for (const st of ['SUBMITTED', 'LAB_PENDING', 'DOCTOR_REVIEW', 'REPORTED']) seen.push(await api.listCases(`?state=${st}`));
    for (const payload of seen.filter(Boolean)) {
      const keys = keysDeep(payload);
      for (const forbidden of PREDICTION_KEYS) expect(keys.has(forbidden), `${role} saw "${forbidden}"`).toBe(false);
      expect(keys.has('assessment'), `${role} saw an assessment`).toBe(false);
    }
  });

  it('the strip filter itself works: a leaky payload is cleaned for patient and lab but not doctor', async () => {
    // The presenters already omit predictions (like the backend's serializers), so the
    // filter is a backstop. Push a deliberately leaky payload through the adapter's
    // role-shaping path to prove the backstop works on its own.
    const leaky = () => ({
      case: { id: 'x', risk_level: 'HIGH', assessment: { response: { predictions: [1], factors: [1], category_scores: {}, risk_level: 'HIGH', disclaimer: 'keep me' } } },
      items: [{ id: 'y', predictions: [{ disease: 'gaucher' }], note: 'keep me too' }],
    });
    for (const role of ['patient', 'lab']) {
      asRole(role);
      const out = await _run(leaky);
      const keys = keysDeep(out);
      for (const k of PREDICTION_KEYS) expect(keys.has(k), `${role} leaked ${k}`).toBe(false);
      expect(out.case.assessment.response.disclaimer).toBe('keep me'); // non-prediction data survives
      expect(out.items[0].note).toBe('keep me too');
    }
    asRole('doctor');
    const doc = await _run(leaky);
    for (const k of PREDICTION_KEYS) expect(keysDeep(doc).has(k)).toBe(true);
  });

  it('the doctor DOES get the scores (positive control: the filter is not stripping everything)', async () => {
    asRole('doctor');
    const { case: c } = await api.getCase('demo-gaucher');
    const keys = keysDeep(c);
    for (const k of PREDICTION_KEYS) expect(keys.has(k)).toBe(true);
    expect(c.risk_level).toBe('HIGH');
  });

  it('a lab that submits a case to the doctor still never sees the result it triggered', async () => {
    asRole('lab');
    await api.transition('demo-healthy', 'LAB_PENDING');
    const res = await api.transition('demo-healthy', 'DOCTOR_REVIEW');
    const keys = keysDeep(res);
    for (const k of PREDICTION_KEYS) expect(keys.has(k)).toBe(false);
    expect(keys.has('assessment')).toBe(false);
  });
});

describe('initial lifecycle spread (all three dashboards have work)', () => {
  it('has 1 SUBMITTED, 1 LAB_PENDING, 2 DOCTOR_REVIEW', async () => {
    asRole('lab');
    expect((await api.listCases('?state=SUBMITTED')).total).toBe(1);
    expect((await api.listCases('?state=LAB_PENDING')).total).toBe(1);
    asRole('doctor');
    expect((await api.listCases('?state=DOCTOR_REVIEW')).total).toBe(2);
  });

  it('doctor worklist is ordered by risk (HIGH before MODERATE)', async () => {
    asRole('doctor');
    const { items } = await api.listCases('?state=DOCTOR_REVIEW');
    expect(items.map((i) => i.risk_level)).toEqual(['HIGH', 'MODERATE']);
  });
});

describe('full lifecycle on the real state machine', () => {
  it('SUBMITTED → LAB_PENDING → DOCTOR_REVIEW (scripted assessment) → REPORTED → released to patient', async () => {
    asRole('lab');
    await api.transition('demo-healthy', 'LAB_PENDING');
    await api.transition('demo-healthy', 'DOCTOR_REVIEW');

    asRole('doctor');
    const { case: scored } = await api.getCase('demo-healthy');
    expect(scored.risk_level).toBe('LOW');
    expect(scored.assessment.response.model.engine_version).toBe(scenarioFile.scenarios.find((s) => s.key === 'healthy').engine_version);
    await api.transition('demo-healthy', 'REPORTED');
    store.release('demo-healthy', 'All clear.');

    asRole('patient');
    store.setPersona('healthy');
    const { case: mine } = await api.getCase('demo-healthy');
    expect(mine.status_label).toMatch(/completed the review/);
    expect(mine.release.note).toBe('All clear.');
  });

  it('enforces the backend rules: wrong role, illegal edge, locked edits, missing reason', async () => {
    asRole('patient');
    await expect(api.transition('demo-gaucher', 'REPORTED')).rejects.toMatchObject({ status: 403 });
    asRole('lab');
    await expect(api.transition('demo-healthy', 'DOCTOR_REVIEW')).rejects.toMatchObject({ status: 409 }); // not claimed yet
    await expect(api.patchLabs('demo-healthy', { routine: {} })).rejects.toMatchObject({ status: 409 }); // not LAB_PENDING
    await api.transition('demo-healthy', 'LAB_PENDING');
    await expect(api.transition('demo-healthy', 'LAB_REJECTED')).rejects.toMatchObject({ status: 400 }); // reason required
    asRole('doctor');
    await expect(api.getCase('demo-healthy')).rejects.toMatchObject({ status: 404 }); // not yet at doctor stage
  });

  it('a case a patient just created cannot be scored: no scripted result, no invented one', async () => {
    asRole('patient');
    const { case: c } = await api.createCase();
    await api.transition(c.id, 'SUBMITTED');
    asRole('lab');
    await api.transition(c.id, 'LAB_PENDING');
    await expect(api.transition(c.id, 'DOCTOR_REVIEW')).rejects.toMatchObject({ status: 409, code: 'demo_no_scripted_result' });
  });

  it('Request more tests sends a doctor-stage case back to the lab and keeps its assessment', async () => {
    asRole('doctor');
    await api.transition('demo-gaucher', 'LAB_PENDING', 'repeat enzyme');
    expect(store.doctorCases().find((c) => c.id === 'demo-gaucher').assessment).toBeTruthy();
    asRole('lab');
    await api.transition('demo-gaucher', 'DOCTOR_REVIEW');
    asRole('doctor');
    expect((await api.getCase('demo-gaucher')).case.assessment.trigger).toBe('lab_data_changed');
  });
});

describe('reset', () => {
  it('restores the exact initial state and persona', async () => {
    asRole('lab');
    await api.transition('demo-healthy', 'LAB_PENDING');
    asRole('patient');
    await api.createCase();
    store.setPersona('fabry');
    store.reset();
    asRole('lab');
    expect((await api.listCases('?state=SUBMITTED')).total).toBe(1);
    asRole('patient');
    expect(store.getPersona()).toBe('gaucher');
    expect((await api.listCases()).total).toBe(1);
  });

  it('mutating a returned payload cannot corrupt the store (copies, not references)', async () => {
    asRole('doctor');
    const { case: c } = await api.getCase('demo-gaucher');
    c.risk_level = 'LOW';
    c.assessment.response.predictions.length = 0;
    expect((await api.getCase('demo-gaucher')).case.risk_level).toBe('HIGH');
  });
});

describe('PDF reports made in demo mode can never pass for real ones', () => {
  const MARK = 'DEMO MODE - NOT REAL PATIENT DATA';
  const marks = (doc) => (doc.output().match(new RegExp(MARK, 'g')) ?? []).length;

  it('carries the header on every page, plus a watermark and DEMO document title', () => {
    const doc = buildReportPdf(store.doctorCases()[0]);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(marks(doc)).toBe(doc.getNumberOfPages());
    expect(doc.output()).toContain('(DEMO)'); // the large diagonal watermark text
    expect(doc.output()).toMatch(/DEMO: not real patient data/); // document title metadata
  });

  it('a normal (non-demo) report carries none of it', () => {
    const c = store.doctorCases()[0];
    setDemo(false);
    const doc = buildReportPdf(c);
    expect(marks(doc)).toBe(0);
    expect(doc.output()).not.toContain('(DEMO)');
  });
});
