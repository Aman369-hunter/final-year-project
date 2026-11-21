// Section 6.0 case lifecycle. This table is the only source of truth for which
// transitions exist and who may perform them; the server rejects everything else.
//
//  SUBMITTED ─► LAB_PENDING ─► DOCTOR_REVIEW ─► REPORTED
//      │             │                │
//    DRAFT      LAB_REJECTED          └─► REFERRED
import { CASE_STATES } from '../domain.js';

export const TRANSITIONS = Object.freeze([
  { from: 'DRAFT', to: 'SUBMITTED', roles: ['patient'] }, // patient submits symptoms + history
  { from: 'SUBMITTED', to: 'LAB_PENDING', roles: ['lab'] }, // lab claims the case
  { from: 'LAB_PENDING', to: 'DOCTOR_REVIEW', roles: ['lab'] }, // lab submits results → scoring runs
  { from: 'LAB_PENDING', to: 'LAB_REJECTED', roles: ['lab'], requiresReason: true }, // bad sample
  { from: 'LAB_REJECTED', to: 'SUBMITTED', roles: ['lab', 'patient'] }, // re-collection (table: "Lab, Patient")
  { from: 'DOCTOR_REVIEW', to: 'REPORTED', roles: ['doctor'] },
  { from: 'DOCTOR_REVIEW', to: 'REFERRED', roles: ['doctor'] },
  { from: 'DOCTOR_REVIEW', to: 'LAB_PENDING', roles: ['doctor'] }, // Section 6.3 "Request more tests"
]);

export const TERMINAL_STATES = Object.freeze(['REPORTED', 'REFERRED']);

export function checkTransition(from, to, role) {
  if (!CASE_STATES.includes(to)) {
    return { ok: false, status: 400, code: 'unknown_state', message: 'Unknown target state.' };
  }
  const rule = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!rule) {
    return { ok: false, status: 409, code: 'illegal_transition', message: `Cannot move a case from ${from} to ${to}.` };
  }
  if (!rule.roles.includes(role)) {
    return { ok: false, status: 403, code: 'role_not_permitted', message: `The ${role} role cannot move a case from ${from} to ${to}.` };
  }
  return { ok: true, rule };
}

export function allowedTransitions(from, role) {
  return TRANSITIONS.filter((t) => t.from === from && t.roles.includes(role)).map((t) => t.to);
}
