// Patient self-enrolment (Section 6.1). Each patient gets their own account, so
// their cases carry their own name instead of landing on one shared login.
// What matters here: the endpoint cannot be used to mint staff accounts, the new
// patient is scoped to the clinic's facility so their cases reach the lab, and
// the parent names reach the doctor but never the lab.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { Patient } from '../src/models/Patient.js';
import { User } from '../src/models/User.js';
import { FACILITY, allKeys, startHarness } from './helpers.js';

process.env.DEFAULT_FACILITY = FACILITY; // config is lazy; same facility as the seeded lab/doctor
// The endpoint shares the strict credential rate limit (20 / 15 min), which this
// file's many deliberate rejections would otherwise exhaust.
process.env.AUTH_RATE_LIMIT = '200';

const NEW_PATIENT = {
  name: 'Priya Raman',
  email: 'priya@example.test',
  password: 'a-long-enough-password',
  date_of_birth: '2014-03-09',
  sex: 'female',
  father_name: 'Raman Iyer',
  mother_name: 'Lakshmi Raman',
  ethnicity: 'south_asian',
};

describe('POST /api/auth/register-patient', () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(() => h.stop());

  const register = (body) => request(h.app).post('/api/auth/register-patient').send(body);

  it('creates a signed-in patient with a linked patient record', async () => {
    const res = await register(NEW_PATIENT);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.user.role, 'patient');
    assert.equal(res.body.user.name, 'Priya Raman');
    assert.ok(res.body.token, 'should be signed in straight away');

    const user = await User.findOne({ email: 'priya@example.test' });
    const patient = await Patient.findOne({ user: user._id });
    assert.equal(patient.name, 'Priya Raman');
    assert.equal(patient.father_name, 'Raman Iyer');
    assert.equal(patient.mother_name, 'Lakshmi Raman');
    assert.equal(patient.facility, FACILITY, 'must join the clinic facility or the lab never sees the case');
    assert.equal(patient.sex, 'female');
    assert.equal(patient.date_of_birth.toISOString().slice(0, 10), '2014-03-09');
    assert.ok(patient.ageYears() > 10, 'age is derived from the date of birth');
  });

  it('rejects a second account on the same email', async () => {
    const res = await register({ ...NEW_PATIENT, name: 'Someone Else' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'email_taken');
  });

  it('cannot be used to create a lab, doctor or admin account', async () => {
    for (const role of ['lab', 'doctor', 'admin']) {
      const res = await register({ ...NEW_PATIENT, email: `x-${role}@example.test`, role });
      assert.equal(res.status, 400, `role=${role} must be rejected as an unknown key`);
    }
    // ...and a facility cannot be chosen either.
    const res = await register({ ...NEW_PATIENT, email: 'x-fac@example.test', facility: 'somewhere-else' });
    assert.equal(res.status, 400);
  });

  it('rejects a missing, future or impossible date of birth', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const dob of [undefined, '', future, '1850-01-01', 'not-a-date']) {
      const res = await register({ ...NEW_PATIENT, email: `dob-${dob}@example.test`, date_of_birth: dob });
      assert.equal(res.status, 400, `date_of_birth=${dob} must be rejected`);
    }
  });

  it('rejects a short password and a bad email', async () => {
    assert.equal((await register({ ...NEW_PATIENT, email: 'short@example.test', password: 'short' })).status, 400);
    assert.equal((await register({ ...NEW_PATIENT, email: 'not-an-email' })).status, 400);
  });

  it('creates no login at all when the details are rejected', async () => {
    const res = await register({ ...NEW_PATIENT, email: 'orphan@example.test', sex: 'not-a-sex' });
    assert.equal(res.status, 400);
    assert.equal(await User.countDocuments({ email: 'orphan@example.test' }), 0);
  });

  it("the new patient's own case reaches the lab, and the doctor sees the real name", async () => {
    const reg = await register({ ...NEW_PATIENT, email: 'flow@example.test', name: 'Arjun Mehta', father_name: 'Vikram Mehta', mother_name: 'Sunita Mehta' });
    assert.equal(reg.status, 201);
    const asNew = (method, url, body = {}) =>
      request(h.app)[method](url).set('Authorization', `Bearer ${reg.body.token}`).send(body);

    const created = await asNew('post', '/api/cases', {
      symptoms: [{ hpo_id: 'HP:0001744', label: 'Enlarged belly or spleen', present: true, severity: 2 }],
    });
    assert.equal(created.status, 201);
    const id = created.body.case.id;
    assert.equal((await asNew('post', `/api/cases/${id}/transition`, { to_state: 'SUBMITTED' })).status, 200);

    // The lab can see it (same facility) but gets age/sex only — no names.
    const labView = await h.api('lab').get(`/api/cases/${id}`);
    assert.equal(labView.status, 200);
    assert.equal(labView.body.case.patient.name, undefined);
    const labKeys = allKeys(labView.body);
    assert.ok(!labKeys.has('father_name') && !labKeys.has('mother_name'), 'parent names must not reach the lab');

    // Drive it to the doctor and check the name and parents are there.
    await h.api('lab').post(`/api/cases/${id}/transition`, { to_state: 'LAB_PENDING' });
    await h.api('lab').patch(`/api/cases/${id}/labs`, {
      enzymes: [{ analyte: 'GBA', value: 0.8, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 4.5, reference_high: 20 }],
      biomarkers: [{ analyte: 'lyso_Gb1', value: 210, unit: 'ng/mL', reference_high: 9 }],
    });
    await h.api('lab').post(`/api/cases/${id}/transition`, { to_state: 'DOCTOR_REVIEW' });

    const docView = await h.api('doctor').get(`/api/cases/${id}`);
    assert.equal(docView.status, 200);
    assert.equal(docView.body.case.patient.name, 'Arjun Mehta');
    assert.equal(docView.body.case.patient.father_name, 'Vikram Mehta');
    assert.equal(docView.body.case.patient.mother_name, 'Sunita Mehta');
  });

  it('lets a patient correct the parent names on their own profile, and no other field', async () => {
    const ok = await h.api('patient').patch('/api/patients/me', { father_name: 'Corrected Name', mother_name: '' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.profile.father_name, 'Corrected Name');
    assert.equal(ok.body.profile.mother_name, null);

    for (const patch of [{ name: 'Renamed' }, { date_of_birth: '2000-01-01' }, { sex: 'male' }, { facility: 'other' }]) {
      const res = await h.api('patient').patch('/api/patients/me', patch);
      assert.equal(res.status, 400, `${Object.keys(patch)[0]} must stay read-only here`);
    }
  });
});
