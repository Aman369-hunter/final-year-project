// Role-shaped case payloads (Section 3.3 "role-filtered payload").
//  patient → their symptoms + friendly status. No lab values, no assessment, ever.
//            Only the doctor's released note after REPORTED (Section 6.1).
//  lab     → what's needed to measure: patient age/sex, symptoms, vitals, labs. No assessment (6.2).
//  doctor  → everything, including the stored assessment (6.3).
// predictionFilter strips prediction keys again for every non-doctor response.
import { PATIENT_STATUS_LABELS } from '../domain.js';
import { Assessment } from '../models/Assessment.js';
import { Patient } from '../models/Patient.js';
import { allowedTransitions } from './caseStateMachine.js';
import { readGenetics } from './caseService.js';

const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const iso = (d) => (d ? new Date(d).toISOString() : null);

function patientSummary(p) {
  return p ? { id: p.id, age_years: p.ageYears(), sex: p.sex } : null;
}

function patientFull(p) {
  if (!p) return null;
  return {
    ...patientSummary(p),
    name: p.name,
    date_of_birth: iso(p.date_of_birth),
    father_name: p.father_name ?? null,
    mother_name: p.mother_name ?? null,
    consanguinity: p.consanguinity ?? null,
    ethnicity: p.ethnicity ?? null,
    family_history: plain(p.family_history),
  };
}

function labsFor(c) {
  if (!c.labs) return null;
  const { genetics_enc, ...rest } = plain(c.labs);
  return { ...rest, genetics: readGenetics(c) };
}

async function loadPatient(c) {
  if (c.patient && typeof c.patient.ageYears === 'function') return c.patient;
  return Patient.findById(c.patient);
}

export async function presentCase(c, user) {
  const base = {
    id: c.id,
    state: c.state,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
    allowed_transitions: allowedTransitions(c.state, user.role),
  };

  if (user.role === 'patient') {
    return {
      ...base,
      status_label: PATIENT_STATUS_LABELS[c.state],
      timeline: c.history.map((h) => ({ state: h.to, at: iso(h.at) })),
      symptoms: plain(c.symptoms),
      rejection_reason: c.state === 'LAB_REJECTED' ? c.rejection?.reason ?? null : null,
      release: c.release?.released ? { released_at: iso(c.release.at), note: c.release.note ?? null } : null,
    };
  }

  const patient = await loadPatient(c);
  const history = c.history.map((h) => ({ from: h.from, to: h.to, at: iso(h.at), actor: String(h.actor), role: h.role, reason: h.reason ?? null }));

  if (user.role === 'lab') {
    return {
      ...base,
      facility: c.facility,
      patient: patientSummary(patient),
      history,
      symptoms: plain(c.symptoms),
      vitals: plain(c.vitals),
      labs: labsFor(c),
      assigned_lab: c.assignedLab ? String(c.assignedLab) : null,
      rejection: c.rejection?.reason ? { reason: c.rejection.reason, at: iso(c.rejection.at) } : null,
    };
  }

  // doctor
  const assessment = c.latestAssessment ? await Assessment.findById(c.latestAssessment) : null;
  return {
    ...base,
    facility: c.facility,
    patient: patientFull(patient),
    history,
    symptoms: plain(c.symptoms),
    vitals: plain(c.vitals),
    labs: labsFor(c),
    assigned_lab: c.assignedLab ? String(c.assignedLab) : null,
    assigned_doctor: c.assignedDoctor ? String(c.assignedDoctor) : null,
    rejection: c.rejection?.reason ? { reason: c.rejection.reason, at: iso(c.rejection.at) } : null,
    risk_level: c.risk_level ?? null,
    assessment: assessment
      ? { id: assessment.id, created_at: iso(assessment.createdAt), trigger: assessment.trigger, response: assessment.response }
      : null,
    release: c.release?.released ? { released_at: iso(c.release.at), note: c.release.note ?? null } : null,
  };
}

// Worklist rows. `c.patient` is populated by the caller.
export function presentCaseSummary(c, user) {
  const row = { id: c.id, state: c.state, created_at: iso(c.createdAt), updated_at: iso(c.updatedAt) };
  if (user.role === 'patient') return { ...row, status_label: PATIENT_STATUS_LABELS[c.state] };
  row.patient = patientSummary(c.patient);
  if (user.role === 'doctor') row.risk_level = c.risk_level ?? null;
  return row;
}
