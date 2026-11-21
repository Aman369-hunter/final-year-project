// In-memory demo database: four scripted patients walked through the real case
// lifecycle. Pure JavaScript state: no fetch, no storage, no files. A page reload
// rebuilds it from scenarios.generated.json, and reset() restores the initial state.
//
// Rules are NOT re-implemented here: the state machine, status labels, risk ranks
// and prediction-stripping filter are imported from the backend modules so the demo
// cannot drift from the real contract (see store.test.js).
import scenarioFile from './scenarios.generated.json';
import { allowedTransitions, checkTransition } from '../../../backend/src/services/caseStateMachine.js';
import { PATIENT_STATUS_LABELS, RISK_RANK } from '../../../backend/src/domain.js';
import { stripPredictionData } from '../../../backend/src/middleware/predictionFilter.js';

export class DemoError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = { error: message, code };
  }
}

const clone = (x) => (x == null ? x : structuredClone(x));
const iso = (ms) => new Date(ms).toISOString();
const EDITABLE_BY_PATIENT = ['DRAFT', 'LAB_REJECTED'];
const DOCTOR_STATES = ['DOCTOR_REVIEW', 'REPORTED', 'REFERRED'];
const ORDER = ['DRAFT', 'SUBMITTED', 'LAB_PENDING', 'DOCTOR_REVIEW'];
export const FACILITY = 'Demo facility (not real)';

const SCRIPTED = new Map(scenarioFile.scenarios.map((s) => [s.id, s]));

let state;
let counter = 0;
let version = 0;
const listeners = new Set();

function buildPatient(s) {
  const r = s.request.patient;
  return {
    id: `demo-patient-${s.key}`,
    name: s.name,
    age_years: r.age_years,
    sex: r.sex,
    date_of_birth: iso(Date.now() - r.age_years * 365.25 * 86_400_000).slice(0, 10),
    father_name: s.father_name ?? null,
    mother_name: s.mother_name ?? null,
    consanguinity: r.consanguinity ?? null,
    ethnicity: r.ethnicity ?? null,
    family_history: { affected_relative: r.family_history?.affected_relative ?? null, relationship: r.family_history?.relationship ?? null },
  };
}

function seedCase(s) {
  const reached = ORDER.indexOf(s.state);
  const t0 = Date.now() - s.minutesAgo * 60_000;
  const steps = [
    { from: null, to: 'DRAFT', role: 'patient' },
    { from: 'DRAFT', to: 'SUBMITTED', role: 'patient' },
    { from: 'SUBMITTED', to: 'LAB_PENDING', role: 'lab' },
    { from: 'LAB_PENDING', to: 'DOCTOR_REVIEW', role: 'lab' },
  ].slice(0, reached + 1);
  const history = steps.map((h, i) => ({ ...h, at: iso(t0 + i * 8 * 60_000), reason: null }));
  const req = s.request;
  const hasLabs = reached >= ORDER.indexOf('LAB_PENDING');
  const inReview = s.state === 'DOCTOR_REVIEW';
  const c = {
    id: s.id,
    ownerKey: s.key,
    state: s.state,
    created_at: history[0].at,
    updated_at: history.at(-1).at,
    facility: FACILITY,
    patient: buildPatient(s),
    history,
    symptoms: clone(req.symptoms ?? []),
    // LAB_PENDING cases arrive with their scripted lab values already entered, so a
    // lab can submit them as-is; the device vitals are left for the lab to capture.
    vitals: inReview ? clone(req.vitals ?? null) : null,
    labs: hasLabs ? { ...clone(req.labs ?? {}), genetics: clone(req.genetics ?? null) } : null,
    assigned_lab: hasLabs ? 'demo-lab' : null,
    assigned_doctor: null,
    rejection: null,
    risk_level: null,
    assessment: null,
    release: null,
  };
  if (inReview) attachAssessment(c, 'enter_doctor_review', history.at(-1).at);
  return c;
}

function attachAssessment(c, trigger, at = iso(Date.now())) {
  const s = SCRIPTED.get(c.id);
  if (!s) return false;
  c.assessment = { id: `asm-${c.id}-${trigger}`, created_at: at, trigger, response: clone(s.response) };
  c.risk_level = s.response.risk_level;
  c._risk_rank = RISK_RANK[c.risk_level] ?? 0;
  return true;
}

function seed() {
  const cases = scenarioFile.scenarios.map(seedCase);
  const patients = Object.fromEntries(cases.map((c) => [c.ownerKey, c.patient]));
  return { cases, patients, persona: cases[0].ownerKey };
}

state = seed();

const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
export const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getVersion = () => version;

export function reset() {
  state = seed();
  counter = 0;
  emit();
}

// ---- personas -------------------------------------------------------------

export const patientsList = () => Object.entries(state.patients).map(([key, p]) => ({ key, name: p.name }));
export const getPersona = () => state.persona;
export function setPersona(key) {
  if (!state.patients[key]) throw new DemoError(404, 'not_found', 'Unknown demo patient.');
  state.persona = key;
  emit();
}
export function personaUser(role) {
  if (role === 'patient') return { id: `demo-user-${state.persona}`, name: state.patients[state.persona].name, role, facility: FACILITY };
  return { id: `demo-user-${role}`, name: role === 'lab' ? 'Demo Lab Technician' : 'Demo Doctor', role, facility: FACILITY };
}

// ---- role scoping + presentation (mirrors caseScope.js / casePresenter.js) ---

function inScope(c, role) {
  if (role === 'patient') return c.ownerKey === state.persona;
  if (role === 'lab') return c.state !== 'DRAFT';
  if (role === 'doctor') return DOCTOR_STATES.includes(c.state);
  return false;
}

const patientSummary = (p) => ({ id: p.id, age_years: p.age_years, sex: p.sex });

function present(c, role) {
  const base = { id: c.id, state: c.state, created_at: c.created_at, updated_at: c.updated_at, allowed_transitions: allowedTransitions(c.state, role) };
  if (role === 'patient') {
    return {
      ...base,
      status_label: PATIENT_STATUS_LABELS[c.state],
      timeline: c.history.map((h) => ({ state: h.to, at: h.at })),
      symptoms: clone(c.symptoms),
      rejection_reason: c.state === 'LAB_REJECTED' ? c.rejection?.reason ?? null : null,
      release: c.release ? { released_at: c.release.released_at, note: c.release.note ?? null } : null,
    };
  }
  const common = {
    ...base,
    facility: c.facility,
    history: clone(c.history),
    symptoms: clone(c.symptoms),
    vitals: clone(c.vitals),
    labs: clone(c.labs),
    assigned_lab: c.assigned_lab,
    rejection: clone(c.rejection),
  };
  if (role === 'lab') return { ...common, patient: patientSummary(c.patient) };
  return {
    ...common,
    patient: clone(c.patient),
    assigned_doctor: c.assigned_doctor,
    risk_level: c.risk_level,
    assessment: clone(c.assessment),
    release: c.release ? { released_at: c.release.released_at, note: c.release.note ?? null } : null,
  };
}

function presentSummary(c, role) {
  const row = { id: c.id, state: c.state, created_at: c.created_at, updated_at: c.updated_at };
  if (role === 'patient') return { ...row, status_label: PATIENT_STATUS_LABELS[c.state] };
  row.patient = patientSummary(c.patient);
  if (role === 'doctor') row.risk_level = c.risk_level;
  return row;
}

// THE SAFETY RULE (spec 6.4 r5). The real backend strips prediction data in
// predictionFilter for every non-doctor response. Demo mode bypasses the backend, so
// it must apply the very same function to every payload it hands back.
export const shape = (payload, role) => (role === 'doctor' ? payload : stripPredictionData(payload));

function find(id, role) {
  const c = state.cases.find((x) => x.id === id && inScope(x, role));
  if (!c) throw new DemoError(404, 'not_found', 'Case not found.');
  return c;
}

const touch = (c) => {
  c.updated_at = iso(Date.now());
};
const requireState = (c, states, what) => {
  if (!states.includes(c.state)) throw new DemoError(409, 'case_locked', `${what} can only be changed while the case is ${states.join(' or ')}.`);
};

// ---- operations -----------------------------------------------------------

export function listCases(role, { state: want, page = 1, limit = 20 } = {}) {
  let rows = state.cases.filter((c) => inScope(c, role) && (!want || c.state === want));
  if (role === 'lab') rows = rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  else if (role === 'patient') rows = rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  else rows = rows.sort((a, b) => (b._risk_rank ?? 0) - (a._risk_rank ?? 0) || a.updated_at.localeCompare(b.updated_at));
  const total = rows.length;
  return { items: rows.slice((page - 1) * limit, page * limit).map((c) => presentSummary(c, role)), page, limit, total };
}

export const getCase = (role, id) => ({ case: present(find(id, role), role) });

export function createCase(role, { symptoms = [] } = {}) {
  if (role !== 'patient') throw new DemoError(403, 'role_not_permitted', 'Only a patient can start a case.');
  const p = state.patients[state.persona];
  const now = iso(Date.now());
  const c = {
    id: `demo-new-${++counter}`,
    ownerKey: state.persona,
    state: 'DRAFT',
    created_at: now,
    updated_at: now,
    facility: FACILITY,
    patient: p,
    history: [{ from: null, to: 'DRAFT', at: now, role: 'patient', reason: null }],
    symptoms: clone(symptoms),
    vitals: null,
    labs: null,
    assigned_lab: null,
    assigned_doctor: null,
    rejection: null,
    risk_level: null,
    assessment: null,
    release: null,
  };
  state.cases.push(c);
  emit();
  return { case: present(c, role) };
}

export function patchSymptoms(role, id, symptoms) {
  if (role !== 'patient') throw new DemoError(403, 'role_not_permitted', 'Only the patient edits symptoms.');
  const c = find(id, role);
  requireState(c, EDITABLE_BY_PATIENT, 'Symptoms');
  c.symptoms = clone(symptoms);
  touch(c);
  emit();
  return { case: present(c, role) };
}

export function patchVitals(role, id, vitals) {
  if (role !== 'lab') throw new DemoError(403, 'role_not_permitted', 'Only the lab records vitals.');
  const c = find(id, role);
  requireState(c, ['LAB_PENDING'], 'Vitals');
  c.vitals = { ...clone(vitals), recorded_at: iso(Date.now()), recorded_by: 'demo-lab' };
  touch(c);
  emit();
  return { case: present(c, role) };
}

export function patchLabs(role, id, labs) {
  if (role !== 'lab') throw new DemoError(403, 'role_not_permitted', 'Only the lab enters results.');
  const c = find(id, role);
  requireState(c, ['LAB_PENDING'], 'Lab results');
  c.labs = c.labs ?? {};
  for (const k of ['enzymes', 'biomarkers', 'routine', 'genetics']) if (labs[k] !== undefined) c.labs[k] = clone(labs[k]);
  c.labs.updated_at = iso(Date.now());
  touch(c);
  emit();
  return { case: present(c, role) };
}

export function transition(role, id, to, reason) {
  const c = find(id, role);
  const from = c.state;
  const check = checkTransition(from, to, role);
  if (!check.ok) throw new DemoError(check.status, check.code, check.message);
  if (check.rule.requiresReason && !reason?.trim()) throw new DemoError(400, 'reason_required', 'A reason is required for this transition.');
  const key = `${from}>${to}`;
  const at = iso(Date.now());

  if (key === 'LAB_PENDING>DOCTOR_REVIEW') {
    // The live backend re-runs the engine here. Demo mode is offline and write-isolated,
    // so it attaches the engine response captured for this scripted patient. A case
    // with no scripted response (one a patient just created) cannot honestly be scored.
    const trigger = c.assessment ? 'lab_data_changed' : 'enter_doctor_review';
    if (!SCRIPTED.has(c.id)) {
      throw new DemoError(409, 'demo_no_scripted_result', 'Demo mode has no scripted result for a newly created case. Use one of the four scripted patients to see a doctor review.');
    }
    const s = SCRIPTED.get(c.id);
    // Manual entries win; only fill what the lab left empty so the doctor's view is complete.
    c.labs = { ...clone(s.request.labs ?? {}), genetics: clone(s.request.genetics ?? null), ...(c.labs ?? {}) };
    if (!c.vitals && s.request.vitals) c.vitals = { ...clone(s.request.vitals), recorded_at: at, recorded_by: 'demo-lab' };
    attachAssessment(c, trigger, at);
  }
  if (key === 'SUBMITTED>LAB_PENDING') c.assigned_lab = 'demo-lab';
  if (key === 'LAB_PENDING>LAB_REJECTED') c.rejection = { reason: reason.trim(), at };
  if (key === 'LAB_REJECTED>SUBMITTED') c.assigned_lab = null;
  if (to === 'REPORTED' || to === 'REFERRED') c.assigned_doctor = 'demo-doctor';

  c.state = to;
  c.history.push({ from, to, at, role, reason: reason?.trim() || null });
  touch(c);
  emit();
  return { case: present(c, role) };
}

export function release(id, note) {
  const c = find(id, 'doctor');
  requireState(c, ['REPORTED'], 'Release');
  if (c.release) throw new DemoError(409, 'already_released', 'Results are already released.');
  c.release = { released_at: iso(Date.now()), note: note || null };
  touch(c);
  emit();
  return { case: present(c, 'doctor') };
}

export function profile(role) {
  if (role !== 'patient') throw new DemoError(403, 'role_not_permitted', 'Only a patient has a profile.');
  const p = state.patients[state.persona];
  return {
    profile: clone({
      id: p.id, name: p.name, date_of_birth: p.date_of_birth, age_years: p.age_years, sex: p.sex,
      father_name: p.father_name, mother_name: p.mother_name,
      consanguinity: p.consanguinity, ethnicity: p.ethnicity, family_history: p.family_history,
    }),
  };
}

export function updateProfile(role, patch) {
  if (role !== 'patient') throw new DemoError(403, 'role_not_permitted', 'Only a patient has a profile.');
  const p = state.patients[state.persona];
  if (patch.father_name !== undefined) p.father_name = patch.father_name;
  if (patch.mother_name !== undefined) p.mother_name = patch.mother_name;
  if (patch.consanguinity !== undefined) p.consanguinity = patch.consanguinity;
  if (patch.ethnicity !== undefined) p.ethnicity = patch.ethnicity;
  if (patch.family_history) p.family_history = { ...p.family_history, ...patch.family_history };
  emit();
  return profile(role);
}

// The doctor dashboard reads one array (worklist + "decided this session"). A case a
// doctor sent back for more tests leaves the doctor's API scope, exactly as on the real
// backend, but this dashboard keeps showing it, so list every case that has been scored.
export const doctorCases = () => state.cases.filter((c) => c.assessment).map((c) => present(c, 'doctor'));
