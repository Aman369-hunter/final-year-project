// Section 3.3 /api/cases/*. Every query goes through caseScopeFor (Section 5).
import { Router } from 'express';
import { HttpError } from '../middleware/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Case } from '../models/Case.js';
import { Patient } from '../models/Patient.js';
import { audit, auditCase } from '../services/audit.js';
import { presentCase, presentCaseSummary } from '../services/casePresenter.js';
import { caseScopeFor } from '../services/caseScope.js';
import {
  createCase,
  releaseToPatient,
  setLabs,
  setSymptoms,
  setVitals,
  transitionCase,
} from '../services/caseService.js';
import {
  createCaseBody,
  idParams,
  labsBody,
  listQuery,
  releaseBody,
  symptomsBody,
  transitionBody,
  vitalsBody,
} from './schemas.js';

const SORT = {
  doctor: { risk_rank: -1, updatedAt: 1 }, // Section 6.3: CRITICAL first
  lab: { createdAt: 1 }, // oldest first
  patient: { updatedAt: -1 },
};

async function loadScopedCase(req) {
  const c = await Case.findOne({ _id: req.valid.params.id, ...caseScopeFor(req.user) });
  if (!c) throw new HttpError(404, 'not_found', 'Case not found.');
  return c;
}

const byId = validate({ params: idParams });

export function casesRouter() {
  const r = Router();
  r.use(authenticate, requireRole('patient', 'lab', 'doctor'));

  // Patient creates a case (DRAFT).
  r.post('/', requireRole('patient'), validate({ body: createCaseBody }), async (req, res) => {
    const patient = await Patient.findOne({ user: req.user._id });
    if (!patient) throw new HttpError(409, 'no_patient_profile', 'No patient record is linked to this account.');
    const c = await createCase(req.user, patient, req.valid.body);
    res.status(201).json({ case: await presentCase(c, req.user) });
  });

  // Worklist, filtered by role scope + optional state.
  r.get('/', validate({ query: listQuery }), async (req, res) => {
    const { state, page, limit } = req.valid.query;
    const scope = caseScopeFor(req.user);
    const filter = state ? { $and: [scope, { state }] } : scope;
    const [rows, total] = await Promise.all([
      Case.find(filter)
        .sort(SORT[req.user.role])
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('patient'),
      Case.countDocuments(filter),
    ]);
    await audit(req.user, 'case.list', { resourceType: 'case', meta: { count: rows.length, state: state ?? null } });
    res.json({ items: rows.map((c) => presentCaseSummary(c, req.user)), page, limit, total });
  });

  r.get('/:id', byId, async (req, res) => {
    const c = await loadScopedCase(req);
    await auditCase(req.user, 'case.view', c);
    res.json({ case: await presentCase(c, req.user) });
  });

  r.patch('/:id/symptoms', requireRole('patient'), byId, validate({ body: symptomsBody }), async (req, res) => {
    const c = await setSymptoms(await loadScopedCase(req), req.user, req.valid.body.symptoms);
    res.json({ case: await presentCase(c, req.user) });
  });

  r.patch('/:id/vitals', requireRole('lab'), byId, validate({ body: vitalsBody }), async (req, res) => {
    const c = await setVitals(await loadScopedCase(req), req.user, req.valid.body);
    res.json({ case: await presentCase(c, req.user) });
  });

  r.patch('/:id/labs', requireRole('lab'), byId, validate({ body: labsBody }), async (req, res) => {
    const c = await setLabs(await loadScopedCase(req), req.user, req.valid.body);
    res.json({ case: await presentCase(c, req.user) });
  });

  r.post('/:id/transition', byId, validate({ body: transitionBody }), async (req, res) => {
    const { to_state, reason } = req.valid.body;
    const c = await transitionCase(await loadScopedCase(req), req.user, to_state, reason);
    res.json({ case: await presentCase(c, req.user) });
  });

  r.post('/:id/release', requireRole('doctor'), byId, validate({ body: releaseBody }), async (req, res) => {
    const c = await releaseToPatient(await loadScopedCase(req), req.user, req.valid.body.note);
    res.json({ case: await presentCase(c, req.user) });
  });

  return r;
}
