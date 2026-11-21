// Phase 5: /api/predict and /api/punnett proxy to the engine; the contract
// guard and role filtering sit between the engine and the browser.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PREDICTION_KEYS } from '../src/middleware/predictionFilter.js';
import { contractViolations } from '../src/services/engineContract.js';
import { GAUCHER_FIXTURE, allKeys, caseInState, fakeEngine, startHarness } from './helpers.js';

const REQ = { patient: { age_years: 7.5, sex: 'male' }, symptoms: [{ hpo_id: 'HP:0001744', label: 'Splenomegaly', present: true, severity: 3 }] };

let h;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.stop();
});
beforeEach(() => {
  fakeEngine.mode = 'ok';
  fakeEngine.requests.length = 0;
});

describe('/api/predict proxies to the engine', () => {
  test('forwards the request body unchanged and returns the engine response to a doctor', async () => {
    const res = await h.api('doctor').post('/api/predict', REQ);
    assert.equal(res.status, 200);
    assert.deepEqual(fakeEngine.requests[0], { path: '/predict', body: REQ });
    assert.deepEqual(res.body, GAUCHER_FIXTURE);
  });

  test('still strips prediction data for patient and lab tokens', async () => {
    for (const who of ['patient', 'lab']) {
      const res = await h.api(who).post('/api/predict', REQ);
      assert.equal(res.status, 200);
      const keys = allKeys(res.body);
      for (const k of PREDICTION_KEYS) assert.ok(!keys.has(k), `${who} must not get "${k}"`);
      assert.ok(res.body.disclaimer);
    }
  });

  test('a contract-breaking engine response is a 502 that names the fields, and nothing leaks', async () => {
    fakeEngine.mode = 'violate';
    const res = await h.api('doctor').post('/api/predict', REQ);
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'engine_contract_violation');
    assert.ok(res.body.violations.some((v) => v.startsWith('predictions')));
    assert.ok(res.body.violations.some((v) => v.startsWith('disclaimer')));
    assert.equal(res.body.predictions, undefined);
  });

  test('an engine failure is a 502, an unreachable engine a 503', async () => {
    fakeEngine.mode = 'down';
    assert.equal((await h.api('doctor').post('/api/predict', REQ)).status, 502);
    const saved = process.env.ENGINE_URL;
    process.env.ENGINE_URL = 'http://127.0.0.1:9'; // nothing listens on the discard port
    try {
      const res = await h.api('doctor').post('/api/predict', REQ);
      assert.equal(res.status, 503);
      assert.equal(res.body.error, 'engine_unavailable');
    } finally {
      process.env.ENGINE_URL = saved;
    }
  });

  test('entering DOCTOR_REVIEW scores the case through the engine', async () => {
    const id = await caseInState(h, 'DOCTOR_REVIEW');
    const sent = fakeEngine.requests.find((r) => r.path === '/predict').body;
    assert.equal(sent.patient.sex, 'female');
    assert.equal(sent.labs.enzymes[0].analyte, 'GBA');
    assert.equal(sent.genetics.findings[0].gene, 'GBA1');
    const doctor = await h.api('doctor').get(`/api/cases/${id}`);
    assert.equal(doctor.body.case.assessment.response.request_id, GAUCHER_FIXTURE.request_id);
  });

  test('a case does not enter DOCTOR_REVIEW if the engine breaks the contract', async () => {
    const id = await caseInState(h, 'LAB_PENDING');
    await h.api('lab').patch(`/api/cases/${id}/labs`, { routine: { hemoglobin_g_dl: 9 } });
    fakeEngine.mode = 'violate';
    const res = await h.api('lab').post(`/api/cases/${id}/transition`, { to_state: 'DOCTOR_REVIEW' });
    assert.equal(res.status, 502);
    assert.equal((await h.api('lab').get(`/api/cases/${id}`)).body.case.state, 'LAB_PENDING');
  });
});

describe('/api/punnett proxies to the engine', () => {
  test('maps { mode, mother, father } onto the engine and returns probabilities', async () => {
    const res = await h.api('patient').post('/api/punnett', { mode: 'autosomal_recessive', mother: 'carrier', father: 'carrier' });
    assert.equal(res.status, 200);
    assert.deepEqual(fakeEngine.requests[0].body, { mode: 'autosomal_recessive', mother_genotype: 'carrier', father_genotype: 'carrier' });
    assert.deepEqual(res.body.probabilities, { affected_pct: 25, carrier_pct: 50, unaffected_pct: 25 });
  });

  test('rejects bad input before it reaches the engine', async () => {
    const res = await h.api('doctor').post('/api/punnett', { mode: 'dominant', mother: 'carrier', father: 'carrier' });
    assert.equal(res.status, 400);
    assert.equal(fakeEngine.requests.length, 0);
  });
});

describe('the contract guard', () => {
  test('all four fixtures conform', async () => {
    for (const name of ['gaucher', 'fabry_female', 'ambiguous', 'healthy']) {
      const { default: fx } = await import(`../../fixtures/predict.${name}.json`, { with: { type: 'json' } });
      assert.deepEqual(contractViolations(fx), [], name);
    }
  });
});

describe('Section 3.1a: lab values must carry a reference range', () => {
  test('an enzyme with no reference interval is rejected before it is stored', async () => {
    const id = await caseInState(h, 'LAB_PENDING');
    const res = await h.api('lab').patch(`/api/cases/${id}/labs`, {
      enzymes: [{ analyte: 'GBA', value: 0.8, unit: 'nmol/h/mL', assay: 'DBS' }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'validation_failed');
  });

  test('a biomarker with no upper limit of normal is rejected', async () => {
    const id = await caseInState(h, 'LAB_PENDING');
    const res = await h.api('lab').patch(`/api/cases/${id}/labs`, {
      biomarkers: [{ analyte: 'lyso_Gb1', value: 210, unit: 'ng/mL' }],
    });
    assert.equal(res.status, 400);
  });

  test('each accepted form of reference range is stored and forwarded to the engine', async () => {
    const id = await caseInState(h, 'LAB_PENDING');
    const enzymes = [
      { analyte: 'GBA', value: 0.8, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 4.5, reference_high: 20.0 },
      { analyte: 'alpha_Gal_A', value: 2.9, unit: 'nmol/h/mL', assay: 'DBS', reference_mean: 9.1 },
      { analyte: 'GAA', value: 14.2, unit: 'nmol/h/mL', assay: 'DBS', pct_of_normal: 91 },
    ];
    const ok = await h.api('lab').patch(`/api/cases/${id}/labs`, { enzymes });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.case.labs.enzymes, enzymes);
    await h.api('lab').post(`/api/cases/${id}/transition`, { to_state: 'DOCTOR_REVIEW' });
    const sent = fakeEngine.requests.findLast((r) => r.path === '/predict').body;
    assert.deepEqual(sent.labs.enzymes, enzymes);
  });
});
