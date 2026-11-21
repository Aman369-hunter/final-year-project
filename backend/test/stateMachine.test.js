// Exhaustive check of the Section 6.0 transition table: every (from, to, role)
// combination is tried, and only the ones listed in the spec are allowed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASE_STATES, ROLES } from '../src/domain.js';
import { checkTransition, TERMINAL_STATES } from '../src/services/caseStateMachine.js';

// Written out independently of the implementation's table, straight from the spec.
const LEGAL = new Set([
  'DRAFT>SUBMITTED:patient',
  'SUBMITTED>LAB_PENDING:lab',
  'LAB_PENDING>DOCTOR_REVIEW:lab',
  'LAB_PENDING>LAB_REJECTED:lab',
  'LAB_REJECTED>SUBMITTED:lab',
  'LAB_REJECTED>SUBMITTED:patient',
  'DOCTOR_REVIEW>REPORTED:doctor',
  'DOCTOR_REVIEW>REFERRED:doctor',
  'DOCTOR_REVIEW>LAB_PENDING:doctor', // Section 6.3 "Request more tests"
]);

test('only the spec transitions are legal, for only the spec roles', () => {
  let checked = 0;
  for (const from of CASE_STATES) {
    for (const to of CASE_STATES) {
      for (const role of ROLES) {
        const result = checkTransition(from, to, role);
        const expected = LEGAL.has(`${from}>${to}:${role}`);
        assert.equal(result.ok, expected, `${from} → ${to} as ${role}: expected ${expected ? 'allowed' : 'rejected'}`);
        if (!expected) assert.ok([403, 409].includes(result.status));
        checked++;
      }
    }
  }
  assert.equal(checked, CASE_STATES.length ** 2 * ROLES.length);
});

test('a transition that does not exist is 409, a wrong role on a real transition is 403', () => {
  assert.equal(checkTransition('DRAFT', 'DOCTOR_REVIEW', 'patient').status, 409);
  assert.equal(checkTransition('DOCTOR_REVIEW', 'REPORTED', 'lab').status, 403);
});

test('terminal states have no way out', () => {
  for (const from of TERMINAL_STATES) {
    for (const to of CASE_STATES) {
      for (const role of ROLES) assert.equal(checkTransition(from, to, role).ok, false);
    }
  }
});

test('the admin role can perform no transition at all', () => {
  for (const from of CASE_STATES) {
    for (const to of CASE_STATES) assert.equal(checkTransition(from, to, 'admin').ok, false);
  }
});

test('an unknown target state is a 400', () => {
  assert.equal(checkTransition('DRAFT', 'APPROVED', 'patient').status, 400);
});
