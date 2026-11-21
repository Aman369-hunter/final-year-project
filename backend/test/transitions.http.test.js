// Illegal transitions through the real API are rejected and leave the case untouched.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { caseInState, startHarness } from './helpers.js';

let h;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.stop();
});

async function snapshot(who, id) {
  const res = await h.api(who).get(`/api/cases/${id}`);
  assert.equal(res.status, 200);
  return { state: res.body.case.state, steps: (res.body.case.history ?? res.body.case.timeline).length };
}

async function expectRejected(who, id, to_state, status, code, extra = {}) {
  const viewer = who === 'patient' ? 'patient' : who;
  const beforeSnap = await snapshot(viewer, id);
  const res = await h.api(who).post(`/api/cases/${id}/transition`, { to_state, ...extra });
  assert.equal(res.status, status, `${who} → ${to_state}: ${JSON.stringify(res.body)}`);
  if (code) assert.equal(res.body.error, code);
  assert.deepEqual(await snapshot(viewer, id), beforeSnap, 'case state and history must be unchanged');
}

describe('illegal transitions are rejected server-side', () => {
  test('a lab token cannot move a case to REPORTED (Section 5)', async () => {
    const id = await caseInState(h, 'DOCTOR_REVIEW');
    await expectRejected('lab', id, 'REPORTED', 403, 'role_not_permitted');
    await expectRejected('lab', id, 'REFERRED', 403, 'role_not_permitted');
  });

  test('a patient cannot skip the lab and jump to DOCTOR_REVIEW', async () => {
    const id = await caseInState(h, 'DRAFT');
    await expectRejected('patient', id, 'DOCTOR_REVIEW', 409, 'illegal_transition');
    await expectRejected('patient', id, 'REPORTED', 409, 'illegal_transition');
  });

  test('a lab cannot skip claiming: SUBMITTED → DOCTOR_REVIEW', async () => {
    const id = await caseInState(h, 'SUBMITTED');
    await expectRejected('lab', id, 'DOCTOR_REVIEW', 409, 'illegal_transition');
  });

  test('a patient cannot claim their own case for the lab', async () => {
    const id = await caseInState(h, 'SUBMITTED');
    await expectRejected('patient', id, 'LAB_PENDING', 403, 'role_not_permitted');
  });

  test('a doctor cannot report a case still with the lab', async () => {
    const id = await caseInState(h, 'LAB_PENDING');
    // The doctor can't even see it yet, so it is a 404, not a 403.
    const res = await h.api('doctor').post(`/api/cases/${id}/transition`, { to_state: 'REPORTED' });
    assert.equal(res.status, 404);
    assert.equal((await snapshot('lab', id)).state, 'LAB_PENDING');
  });

  test('REPORTED and REFERRED are terminal', async () => {
    const reported = await caseInState(h, 'REPORTED');
    await expectRejected('doctor', reported, 'DOCTOR_REVIEW', 409, 'illegal_transition');
    await expectRejected('doctor', reported, 'REFERRED', 409, 'illegal_transition');
    const referred = await caseInState(h, 'REFERRED');
    await expectRejected('doctor', referred, 'REPORTED', 409, 'illegal_transition');
  });

  test('moving to the same state is illegal', async () => {
    const id = await caseInState(h, 'LAB_PENDING');
    await expectRejected('lab', id, 'LAB_PENDING', 409, 'illegal_transition');
  });

  test('LAB_REJECTED requires a reason', async () => {
    const id = await caseInState(h, 'LAB_PENDING');
    await expectRejected('lab', id, 'LAB_REJECTED', 400, 'reason_required');
  });

  test('an unknown target state fails validation', async () => {
    const id = await caseInState(h, 'DRAFT');
    await expectRejected('patient', id, 'APPROVED', 400, 'validation_failed');
  });

  test('a lab at another facility cannot act on the case at all', async () => {
    const id = await caseInState(h, 'SUBMITTED');
    const res = await h.api('otherLab').post(`/api/cases/${id}/transition`, { to_state: 'LAB_PENDING' });
    assert.equal(res.status, 404);
    assert.equal((await snapshot('patient', id)).state, 'SUBMITTED');
  });

  test('another patient cannot submit someone else’s draft', async () => {
    const id = await caseInState(h, 'DRAFT');
    const res = await h.api('otherPatient').post(`/api/cases/${id}/transition`, { to_state: 'SUBMITTED' });
    assert.equal(res.status, 404);
    assert.equal((await snapshot('patient', id)).state, 'DRAFT');
  });

  test('an admin token has no access to cases', async () => {
    const id = await caseInState(h, 'DRAFT');
    const res = await h.api('admin').post(`/api/cases/${id}/transition`, { to_state: 'SUBMITTED' });
    assert.equal(res.status, 403);
  });
});

describe('legal transitions', () => {
  test('the full happy path records every step', async () => {
    const id = await caseInState(h, 'REPORTED');
    const res = await h.api('doctor').get(`/api/cases/${id}`);
    assert.deepEqual(
      res.body.case.history.map((s) => s.to),
      ['DRAFT', 'SUBMITTED', 'LAB_PENDING', 'DOCTOR_REVIEW', 'REPORTED'],
    );
  });

  test('a rejected sample can be resubmitted by the patient', async () => {
    const id = await caseInState(h, 'LAB_REJECTED');
    const res = await h.api('patient').post(`/api/cases/${id}/transition`, { to_state: 'SUBMITTED' });
    assert.equal(res.status, 200);
    assert.equal(res.body.case.state, 'SUBMITTED');
  });

  test('a doctor can request more tests, sending the case back to the lab', async () => {
    const id = await caseInState(h, 'DOCTOR_REVIEW');
    const res = await h.api('doctor').post(`/api/cases/${id}/transition`, { to_state: 'LAB_PENDING' });
    assert.equal(res.status, 200);
    assert.equal(res.body.case.state, 'LAB_PENDING');
  });

  test('lab results can only be edited while the case is LAB_PENDING', async () => {
    const id = await caseInState(h, 'SUBMITTED');
    const res = await h.api('lab').patch(`/api/cases/${id}/labs`, { routine: { hemoglobin_g_dl: 12 } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'case_locked');
  });
});
