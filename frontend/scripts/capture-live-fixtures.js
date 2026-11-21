// Captures the live engine's responses for the four demo patients, through the
// real Node proxy (POST /api/predict as the seeded doctor), into fixtures/live/.
// The dashboard then renders them with VITE_ENGINE_OUTPUT=live.
//
//   npx vite-node scripts/capture-live-fixtures.js
//
// Needs: engine on :8000, backend on :4000 (seeded), SEED_PASSWORD in backend/.env.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MOCK_CASES } from '../src/data/mockCases.js';

const API = process.env.API_URL || 'http://localhost:4000/api';
const ROOT = new URL('../../', import.meta.url);
const NAMES = {
  'demo-case-a': 'gaucher',
  'demo-case-b': 'fabry_female',
  'demo-case-c': 'ambiguous',
  'demo-case-d': 'healthy',
};

const env = readFileSync(new URL('backend/.env', ROOT), 'utf8');
const password = env.match(/^SEED_PASSWORD=(.*)$/m)?.[1];
if (!password) throw new Error('SEED_PASSWORD not set in backend/.env');

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'doctor@lsd.test', password }),
});
if (!login.ok) throw new Error(`doctor login failed: HTTP ${login.status}`);
const { token } = await login.json();

// Same mapping as backend/src/services/scoring.js buildPredictRequest.
function toRequest(c) {
  const req = { patient: { age_years: c.patient.age_years, sex: c.patient.sex } };
  for (const k of ['consanguinity', 'ethnicity', 'family_history']) if (c.patient[k] != null) req.patient[k] = c.patient[k];
  const sx = c.symptoms.filter((s) => s.present !== null && s.present !== undefined);
  if (sx.length) req.symptoms = sx;
  if (c.labs) {
    const { genetics, ...labs } = c.labs;
    if (Object.keys(labs).length) req.labs = labs;
    if (genetics) req.genetics = genetics;
  }
  if (c.vitals) req.vitals = c.vitals;
  return req;
}

const outDir = new URL('fixtures/live/', ROOT);
mkdirSync(outDir, { recursive: true });
for (const c of MOCK_CASES) {
  const name = NAMES[c.id];
  const request = toRequest(c);
  const res = await fetch(`${API}/predict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`${name}: HTTP ${res.status}`, body);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(new URL(`predict.${name}.json`, outDir), JSON.stringify(body, null, 2) + '\n');
  writeFileSync(new URL(`request.${name}.json`, outDir), JSON.stringify(request, null, 2) + '\n');
  const top = body.predictions[0];
  console.log(`${name.padEnd(13)} ${body.risk_level.padEnd(9)} #1 ${top.disease} abs ${top.absolute_risk} rel ${top.relative_probability}`);
}
