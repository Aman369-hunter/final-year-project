// Section 5 + 6.4 rule 5: prediction data reaches doctors only, enforced on the server.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PREDICTION_KEYS, stripPredictionData } from '../src/middleware/predictionFilter.js';
import { allKeys, caseInState, startHarness } from './helpers.js';

const SCORE_FIELDS = [...PREDICTION_KEYS, 'absolute_risk', 'relative_probability', 'raw_score'];
const MINIMAL_PREDICT = { patient: { age_years: 7.5, sex: 'male' } };

let h;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.stop();
});

function assertNoPredictionData(res) {
  const keys = allKeys(res.body);
  for (const k of SCORE_FIELDS) assert.ok(!keys.has(k), `response must not contain "${k}"`);
  // Match the key form ("k":) — risk_basis legitimately has the *value* "absolute_risk".
  for (const k of SCORE_FIELDS) assert.ok(!res.text.includes(`"${k}":`), `raw body must not contain key "${k}"`);
}

describe('a patient token cannot see prediction data', () => {
  test('case detail, once the case has been scored', async () => {
    const id = await caseInState(h, 'DOCTOR_REVIEW');

    const doctor = await h.api('doctor').get(`/api/cases/${id}`);
    assert.equal(doctor.status, 200);
    assert.ok(doctor.body.case.assessment.response.predictions.length === 6, 'doctor sees the scored assessment');
    assert.ok(doctor.body.case.risk_level);

    const patient = await h.api('patient').get(`/api/cases/${id}`);
    assert.equal(patient.status, 200);
    assert.equal(patient.body.case.state, 'DOCTOR_REVIEW');
    assertNoPredictionData(patient);
    assert.equal(patient.body.case.assessment, undefined);
  });

  test('case list', async () => {
    await caseInState(h, 'DOCTOR_REVIEW');
    const res = await h.api('patient').get('/api/cases');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length > 0);
    assertNoPredictionData(res);
  });

  test('still none after the doctor reports and releases results', async () => {
    const id = await caseInState(h, 'REPORTED');
    const release = await h.api('doctor').post(`/api/cases/${id}/release`, { note: 'Please book a follow-up visit.' });
    assert.equal(release.status, 200);

    const res = await h.api('patient').get(`/api/cases/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.case.release.note, 'Please book a follow-up visit.');
    assertNoPredictionData(res);
  });

  test('POST /api/predict', async () => {
    const res = await h.api('patient').post('/api/predict', MINIMAL_PREDICT);
    assert.equal(res.status, 200);
    assertNoPredictionData(res);
    assert.ok(res.body.disclaimer, 'the disclaimer still ships');
  });

  test('cannot read another patient’s case at all', async () => {
    const id = await caseInState(h, 'DOCTOR_REVIEW');
    const res = await h.api('otherPatient').get(`/api/cases/${id}`);
    assert.equal(res.status, 404);
  });
});

describe('the other roles', () => {
  test('a lab token sees no prediction data on a scored case or from /api/predict', async () => {
    const id = await caseInState(h, 'DOCTOR_REVIEW');
    const detail = await h.api('lab').get(`/api/cases/${id}`);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.case.labs.genetics, 'lab still sees the values it entered');
    assertNoPredictionData(detail);
    assertNoPredictionData(await h.api('lab').post('/api/predict', MINIMAL_PREDICT));
  });

  test('an admin token sees no prediction data from /api/predict', async () => {
    assertNoPredictionData(await h.api('admin').post('/api/predict', MINIMAL_PREDICT));
  });

  test('a doctor token gets the full Section 3.1 response', async () => {
    const res = await h.api('doctor').post('/api/predict', MINIMAL_PREDICT);
    assert.equal(res.status, 200);
    assert.equal(res.body.predictions.length, 6);
    for (const k of PREDICTION_KEYS) assert.ok(k in res.body, `doctor response has "${k}"`);
  });

  test('no token at all is a 401', async () => {
    const res = await (await import('supertest')).default(h.app).post('/api/predict').send(MINIMAL_PREDICT);
    assert.equal(res.status, 401);
  });
});

describe('stripPredictionData', () => {
  test('removes the keys at any depth and leaves everything else', () => {
    const input = {
      risk_level: 'HIGH',
      disclaimer: 'd',
      a: [{ predictions: [1], keep: 1, nested: { factors: [], category_scores: {}, ok: true } }],
    };
    assert.deepEqual(stripPredictionData(input), { disclaimer: 'd', a: [{ keep: 1, nested: { ok: true } }] });
  });
});
