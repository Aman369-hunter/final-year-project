// Case operations shared by the HTTP routes and the seed script.
import { RISK_RANK } from '../domain.js';
import { HttpError } from '../middleware/errors.js';
import { Assessment } from '../models/Assessment.js';
import { Case } from '../models/Case.js';
import { Patient } from '../models/Patient.js';
import { auditCase } from './audit.js';
import { checkTransition } from './caseStateMachine.js';
import { decryptJson, encryptJson } from './fieldCrypto.js';
import { buildPredictRequest, runPrediction } from './scoring.js';

const EDITABLE_BY_PATIENT = ['DRAFT', 'LAB_REJECTED'];

function requireState(caseDoc, states, what) {
  if (!states.includes(caseDoc.state)) {
    throw new HttpError(409, 'case_locked', `${what} can only be changed while the case is ${states.join(' or ')}.`);
  }
}

export function readGenetics(caseDoc) {
  return decryptJson(caseDoc.labs?.genetics_enc, caseDoc._id);
}

export async function createCase(actor, patient, { symptoms = [] } = {}) {
  const c = await Case.create({
    patient: patient._id,
    patientUser: patient.user,
    facility: patient.facility,
    state: 'DRAFT',
    symptoms,
    history: [{ from: null, to: 'DRAFT', actor: actor._id, role: actor.role }],
  });
  await auditCase(actor, 'case.create', c);
  return c;
}

export async function setSymptoms(caseDoc, actor, symptoms) {
  requireState(caseDoc, EDITABLE_BY_PATIENT, 'Symptoms');
  caseDoc.symptoms = symptoms;
  await caseDoc.save();
  await auditCase(actor, 'case.update_symptoms', caseDoc);
  return caseDoc;
}

export async function setVitals(caseDoc, actor, vitals) {
  requireState(caseDoc, ['LAB_PENDING'], 'Vitals');
  caseDoc.vitals = { ...vitals, recorded_at: new Date(), recorded_by: actor._id };
  await caseDoc.save();
  await auditCase(actor, 'case.update_vitals', caseDoc);
  return caseDoc;
}

// Partial update: only the sections present in the body are replaced.
export async function setLabs(caseDoc, actor, labs) {
  const { enzymes, biomarkers, routine, genetics } = labs;
  requireState(caseDoc, ['LAB_PENDING'], 'Lab results');
  if (!caseDoc.labs) caseDoc.labs = {};
  if (enzymes !== undefined) caseDoc.set('labs.enzymes', enzymes);
  if (biomarkers !== undefined) caseDoc.set('labs.biomarkers', biomarkers);
  if (routine !== undefined) caseDoc.set('labs.routine', routine);
  if (genetics !== undefined) caseDoc.set('labs.genetics_enc', encryptJson(genetics, caseDoc._id));
  caseDoc.set('labs.updated_at', new Date());
  caseDoc.set('labs.updated_by', actor._id);
  await caseDoc.save();
  await auditCase(actor, 'case.update_labs', caseDoc, {
    sections: ['enzymes', 'biomarkers', 'routine', 'genetics'].filter((k) => labs[k] !== undefined),
  });
  return caseDoc;
}

async function createAssessment(caseDoc, actor, trigger) {
  const patient = await Patient.findById(caseDoc.patient);
  const request = buildPredictRequest(caseDoc, patient, readGenetics(caseDoc));
  const response = await runPrediction(request);
  return Assessment.create({
    case: caseDoc._id,
    patient: caseDoc.patient,
    response,
    engine_version: response.model?.engine_version,
    engine_mode: response.model?.mode,
    weights_version: response.model?.weights_version,
    trigger,
    created_by: actor._id,
  });
}

export async function transitionCase(caseDoc, actor, to, reason) {
  const from = caseDoc.state;
  const check = checkTransition(from, to, actor.role);
  if (!check.ok) throw new HttpError(check.status, check.code, check.message);
  if (check.rule.requiresReason && !reason?.trim()) {
    throw new HttpError(400, 'reason_required', 'A reason is required for this transition.');
  }

  const set = { state: to };
  const unset = {};
  const key = `${from}>${to}`;
  if (key === 'SUBMITTED>LAB_PENDING') set.assignedLab = actor._id;
  if (key === 'LAB_PENDING>LAB_REJECTED') set.rejection = { reason: reason.trim(), at: new Date() };
  if (key === 'LAB_REJECTED>SUBMITTED') unset.assignedLab = '';
  if (to === 'REPORTED' || to === 'REFERRED') set.assignedDoctor = actor._id;
  if (key === 'LAB_PENDING>DOCTOR_REVIEW') {
    // Section 6.0: scoring runs automatically on entry to DOCTOR_REVIEW.
    // A re-entry after "request more tests" re-scores with the new lab data.
    const trigger = caseDoc.latestAssessment ? 'lab_data_changed' : 'enter_doctor_review';
    const a = await createAssessment(caseDoc, actor, trigger);
    set.latestAssessment = a._id;
    set.risk_level = a.response.risk_level;
    set.risk_rank = RISK_RANK[a.response.risk_level] ?? 0;
  }

  const update = {
    $set: set,
    $push: { history: { from, to, at: new Date(), actor: actor._id, role: actor.role, reason: reason?.trim() || undefined } },
  };
  if (Object.keys(unset).length) update.$unset = unset;

  // Conditional on the state we validated against, so two concurrent transitions can't both win.
  const updated = await Case.findOneAndUpdate({ _id: caseDoc._id, state: from }, update, { new: true });
  if (!updated) throw new HttpError(409, 'state_changed', 'The case changed state meanwhile. Reload and retry.');
  await auditCase(actor, 'case.transition', updated, { from, to });
  return updated;
}

export async function releaseToPatient(caseDoc, actor, note) {
  requireState(caseDoc, ['REPORTED'], 'Release');
  if (caseDoc.release?.released) throw new HttpError(409, 'already_released', 'Results are already released.');
  caseDoc.release = { released: true, at: new Date(), by: actor._id, note };
  await caseDoc.save();
  await auditCase(actor, 'case.release', caseDoc);
  return caseDoc;
}
