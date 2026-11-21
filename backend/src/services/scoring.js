// Engine client. Node proxies to the Python engine on an internal address
// (Section 2); the browser never talks to it. Every response is checked against
// the Section 3.1 contract before anyone sees or stores it.
import { config } from '../config.js';
import { HttpError } from '../middleware/errors.js';
import { contractViolations } from './engineContract.js';

async function callEngine(path, body) {
  let res;
  try {
    res = await fetch(new URL(path, config.engineUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.engineTimeoutMs),
    });
  } catch {
    throw new HttpError(503, 'engine_unavailable', 'The scoring engine is not reachable.');
  }
  if (!res.ok) throw new HttpError(502, 'engine_error', `The scoring engine returned HTTP ${res.status}.`);
  return res.json();
}

export async function runPrediction(request) {
  const response = await callEngine('/predict', request);
  const violations = contractViolations(response);
  if (violations.length) {
    // Field paths only; never values (they can carry patient data).
    console.error('[engine] contract violation:', violations.map((v) => v.split(':')[0]).join(', '));
    const err = new HttpError(502, 'engine_contract_violation', 'The scoring engine response does not match the API contract.');
    err.violations = violations;
    throw err;
  }
  return response;
}

// Section 3.3: { mode, mother, father } -> probabilities.
export async function runPunnett({ mode, mother, father, child_sex }) {
  const r = await callEngine('/punnett', { mode, mother_genotype: mother, father_genotype: father, child_sex });
  return { mode: r.mode, mother: r.mother_genotype, father: r.father_genotype, probabilities: r.probabilities, grid: r.grid, note: r.note };
}

const clean = (obj) => JSON.parse(JSON.stringify(obj ?? null)); // drops undefined + Mongoose wrappers

// Builds a Section 3.1 request from a case. Every block except patient.age_years
// and patient.sex is optional and left out when absent.
export function buildPredictRequest(caseDoc, patient, genetics) {
  const req = {
    patient: {
      age_years: patient.ageYears(),
      sex: patient.sex,
      consanguinity: patient.consanguinity,
      ethnicity: patient.ethnicity,
      family_history: clean(patient.family_history) || undefined,
    },
  };
  const symptoms = (caseDoc.symptoms || []).filter((s) => s.present !== null && s.present !== undefined);
  if (symptoms.length) {
    req.symptoms = symptoms.map((s) => ({ hpo_id: s.hpo_id, label: s.label, present: s.present, severity: s.severity }));
  }
  const labs = caseDoc.labs;
  if (labs && (labs.enzymes?.length || labs.biomarkers?.length || labs.routine)) {
    req.labs = clean({ enzymes: labs.enzymes, biomarkers: labs.biomarkers, routine: labs.routine });
  }
  if (genetics) req.genetics = genetics;
  if (caseDoc.vitals) {
    const { ecg_segment, recorded_at, recorded_by, ...summary } = clean(caseDoc.vitals);
    req.vitals = summary;
  }
  return clean(req);
}
