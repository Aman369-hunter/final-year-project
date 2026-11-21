// Shared test harness: in-memory MongoDB, the real Express app, real auth.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Patient } from '../src/models/Patient.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/services/tokens.js';

// Config is read lazily, so setting these here (before any request) is enough.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');
process.env.GENETICS_ENC_KEY = randomBytes(32).toString('base64');

export const PASSWORD = 'test-password-123';
export const FACILITY = 'fac-1';
export const OTHER_FACILITY = 'fac-2';

export const GAUCHER_FIXTURE = JSON.parse(readFileSync(new URL('../../fixtures/predict.gaucher.json', import.meta.url), 'utf8'));

// A stand-in for the Python engine over real HTTP, so the proxy code path runs.
// fakeEngine.mode: 'ok' (Gaucher fixture) | 'violate' (contract-breaking body) | 'down' (HTTP 500).
export const fakeEngine = { mode: 'ok', requests: [] };
async function startFakeEngine() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      fakeEngine.requests.push({ path: req.url, body: body ? JSON.parse(body) : null });
      if (fakeEngine.mode === 'down') {
        res.writeHead(500).end();
        return;
      }
      let out;
      if (req.url === '/punnett') {
        out = { mode: 'autosomal_recessive', mother_genotype: 'carrier', father_genotype: 'carrier',
          probabilities: { affected_pct: 25, carrier_pct: 50, unaffected_pct: 25 }, grid: [], note: 'n' };
      } else if (fakeEngine.mode === 'violate') {
        out = { ...GAUCHER_FIXTURE, predictions: GAUCHER_FIXTURE.predictions.slice(0, 1), disclaimer: '' };
      } else {
        out = GAUCHER_FIXTURE;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.ENGINE_URL = `http://127.0.0.1:${server.address().port}`;
  return server;
}

export async function startHarness() {
  const engine = await startFakeEngine();
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const app = createApp();

  const passwordHash = await hashPassword(PASSWORD); // one bcrypt-12 hash shared by all test users
  const mk = (role, email, facility) => User.create({ name: `${role} user`, email, role, facility, passwordHash });
  const users = {
    admin: await mk('admin', 'admin@t.test'),
    patient: await mk('patient', 'patient@t.test', FACILITY),
    otherPatient: await mk('patient', 'patient2@t.test', FACILITY),
    lab: await mk('lab', 'lab@t.test', FACILITY),
    otherLab: await mk('lab', 'lab2@t.test', OTHER_FACILITY),
    doctor: await mk('doctor', 'doctor@t.test', FACILITY),
  };
  for (const key of ['patient', 'otherPatient']) {
    await Patient.create({
      user: users[key]._id,
      name: `Test ${key}`,
      date_of_birth: new Date('2018-01-01'),
      sex: 'female',
      facility: FACILITY,
    });
  }

  const tokens = {};
  for (const [key, u] of Object.entries(users)) {
    const res = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed for ${key}: ${res.status}`);
    tokens[key] = res.body.token;
  }

  const api = (who) => {
    const auth = (req) => req.set('Authorization', `Bearer ${tokens[who]}`);
    return {
      get: (url) => auth(request(app).get(url)),
      post: (url, body = {}) => auth(request(app).post(url)).send(body),
      patch: (url, body = {}) => auth(request(app).patch(url)).send(body),
    };
  };

  async function stop() {
    await mongoose.disconnect();
    await mongod.stop();
    await new Promise((r) => engine.close(r));
  }

  return { app, users, tokens, api, stop };
}

const SAMPLE_LABS = {
  // Section 3.1a: a result with no reference interval is rejected.
  enzymes: [{ analyte: 'GBA', value: 0.8, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 4.5, reference_high: 20.0 }],
  biomarkers: [{ analyte: 'lyso_Gb1', value: 210, unit: 'ng/mL', reference_high: 9.0 }],
  genetics: {
    tested: true,
    findings: [{ gene: 'GBA1', variant: 'c.1226A>G', zygosity: 'homozygous', classification: 'pathogenic' }],
  },
};

// Drives a fresh case to `target` through the real HTTP API, using the legal path.
export async function caseInState(h, target, owner = 'patient') {
  const created = await h.api(owner).post('/api/cases', {
    symptoms: [{ hpo_id: 'HP:0001744', label: 'Enlarged belly or spleen', present: true, severity: 2 }],
  });
  if (created.status !== 201) throw new Error(`create failed: ${created.status}`);
  const id = created.body.case.id;

  const move = async (who, to_state, extra = {}) => {
    const res = await h.api(who).post(`/api/cases/${id}/transition`, { to_state, ...extra });
    if (res.status !== 200) throw new Error(`${who} → ${to_state} failed: ${res.status} ${JSON.stringify(res.body)}`);
  };

  const path = {
    DRAFT: [],
    SUBMITTED: [['patient', 'SUBMITTED']],
    LAB_PENDING: [['patient', 'SUBMITTED'], ['lab', 'LAB_PENDING']],
    LAB_REJECTED: [['patient', 'SUBMITTED'], ['lab', 'LAB_PENDING'], ['lab', 'LAB_REJECTED', { reason: 'Haemolysed sample' }]],
    DOCTOR_REVIEW: [['patient', 'SUBMITTED'], ['lab', 'LAB_PENDING'], ['labs'], ['lab', 'DOCTOR_REVIEW']],
    REPORTED: [['patient', 'SUBMITTED'], ['lab', 'LAB_PENDING'], ['labs'], ['lab', 'DOCTOR_REVIEW'], ['doctor', 'REPORTED']],
    REFERRED: [['patient', 'SUBMITTED'], ['lab', 'LAB_PENDING'], ['labs'], ['lab', 'DOCTOR_REVIEW'], ['doctor', 'REFERRED']],
  }[target];

  for (const [who, to, extra] of path) {
    if (who === 'labs') {
      const res = await h.api('lab').patch(`/api/cases/${id}/labs`, SAMPLE_LABS);
      if (res.status !== 200) throw new Error(`labs failed: ${res.status}`);
      continue;
    }
    await move(who === 'patient' ? owner : who, to, extra);
  }
  return id;
}

// Every key anywhere in a JSON value, at any depth.
export function allKeys(value, acc = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, acc));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}
