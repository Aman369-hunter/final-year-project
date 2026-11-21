// One login, three dashboards (project requirement). A single account may hold
// several roles and swap the ACTIVE one on its access token. The point of these
// tests is that switching grants nothing: the active role is still filtered by
// Section 6.4 r5, so the same account acting as a patient still cannot see a
// risk score it can see as a doctor.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { Patient } from '../src/models/Patient.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/services/tokens.js';
import { FACILITY, PASSWORD, allKeys, caseInState, startHarness } from './helpers.js';

const PRED_KEYS = ['predictions', 'factors', 'category_scores', 'risk_level'];

describe('one login, several roles', () => {
  let h;
  let token;

  before(async () => {
    h = await startHarness();
    // The project account: one login that may act as patient, lab or doctor.
    const user = await User.create({
      name: 'Project Account',
      email: 'project@t.test',
      role: 'patient',
      roles: ['patient', 'lab', 'doctor'],
      facility: FACILITY,
      passwordHash: await hashPassword(PASSWORD),
    });
    await Patient.create({
      user: user._id, name: 'Project Account', date_of_birth: new Date('2000-05-05'), sex: 'female', facility: FACILITY,
    });
    const res = await request(h.app).post('/api/auth/login').send({ email: 'project@t.test', password: PASSWORD });
    assert.equal(res.status, 200);
    token = res.body.token;
  });
  after(() => h.stop());

  const as = (t) => ({
    get: (url) => request(h.app).get(url).set('Authorization', `Bearer ${t}`),
    post: (url, body = {}) => request(h.app).post(url).set('Authorization', `Bearer ${t}`).send(body),
  });
  const switchTo = async (role, t = token) => {
    const res = await as(t).post('/api/auth/switch-role', { role });
    return res;
  };

  it('login reports every role the account may use', async () => {
    const res = await request(h.app).post('/api/auth/login').send({ email: 'project@t.test', password: PASSWORD });
    assert.deepEqual(res.body.user.roles.sort(), ['doctor', 'lab', 'patient']);
    assert.equal(res.body.user.role, 'patient', 'starts on its primary role');
  });

  it('switches to a held role and the new token acts as it', async () => {
    const res = await switchTo('doctor');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.role, 'doctor');
    // A doctor-only endpoint now answers for the same account.
    const work = await as(res.body.token).get('/api/cases?state=DOCTOR_REVIEW');
    assert.equal(work.status, 200);
  });

  it('refuses a role the account does not hold', async () => {
    const res = await switchTo('admin');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'role_not_permitted');
  });

  it('a single-role account cannot switch at all', async () => {
    const res = await h.api('lab').post('/api/auth/switch-role', { role: 'doctor' });
    assert.equal(res.status, 403);
  });

  // The whole point: one login must not become one god-mode role.
  it('acting as patient still cannot see scores it can see as doctor', async () => {
    const id = await caseInState(h, 'DOCTOR_REVIEW');

    const docToken = (await switchTo('doctor')).body.token;
    const docView = await as(docToken).get(`/api/cases/${id}`);
    assert.equal(docView.status, 200);
    assert.ok(allKeys(docView.body).has('risk_level'), 'doctor sees the score');

    // Same account, patient role: the case is not even theirs, and no score leaks.
    const patToken = (await switchTo('patient', docToken)).body.token;
    const patView = await as(patToken).get(`/api/cases/${id}`);
    assert.ok([403, 404].includes(patView.status), `expected not-visible, got ${patView.status}`);

    const labToken = (await switchTo('lab', patToken)).body.token;
    const labView = await as(labToken).get(`/api/cases/${id}`);
    assert.equal(labView.status, 200, 'the lab may read the case');
    const leaked = PRED_KEYS.filter((k) => allKeys(labView.body).has(k));
    assert.deepEqual(leaked, [], `lab role leaked ${leaked.join(', ')} after switching from doctor`);
  });

  it('refresh keeps the role the client was acting as', async () => {
    const agent = request.agent(h.app);
    const login = await agent.post('/api/auth/login').send({ email: 'project@t.test', password: PASSWORD });
    assert.equal(login.body.user.role, 'patient');
    const refreshed = await agent.post('/api/auth/refresh').send({ role: 'doctor' });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.user.role, 'doctor', 'the active role survives a silent refresh');
  });

  it('refresh will not hand out a role the account lacks', async () => {
    const agent = request.agent(h.app);
    await agent.post('/api/auth/login').send({ email: 'project@t.test', password: PASSWORD });
    const refreshed = await agent.post('/api/auth/refresh').send({ role: 'admin' });
    assert.equal(refreshed.body.user.role, 'patient', 'falls back to the primary role');
  });
});
