// Section 6.1 "Registration and profile". A signed-in patient reads and maintains
// their own profile. Identity set at registration (name, date of birth, sex) is
// read-only here; the patient maintains the facts only they know — consanguinity,
// ethnicity and family history. No other role reaches these endpoints.
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Patient } from '../models/Patient.js';
import { audit } from '../services/audit.js';

const iso = (d) => (d ? new Date(d).toISOString() : null);

function presentProfile(p) {
  return {
    id: p.id,
    name: p.name,
    date_of_birth: iso(p.date_of_birth),
    age_years: p.ageYears(),
    sex: p.sex,
    father_name: p.father_name ?? null,
    mother_name: p.mother_name ?? null,
    consanguinity: p.consanguinity ?? null,
    ethnicity: p.ethnicity ?? null,
    family_history: {
      affected_relative: p.family_history?.affected_relative ?? null,
      relationship: p.family_history?.relationship ?? null,
    },
  };
}

// Only the patient-knowable fields are editable. Unknown keys are rejected.
const profileBody = z
  .object({
    father_name: z.string().trim().max(120).nullable().optional(),
    mother_name: z.string().trim().max(120).nullable().optional(),
    consanguinity: z.boolean().nullable().optional(),
    ethnicity: z.string().trim().max(64).nullable().optional(),
    family_history: z
      .object({
        affected_relative: z.boolean().nullable().optional(),
        relationship: z.string().trim().max(64).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

async function loadOwnPatient(req) {
  const p = await Patient.findOne({ user: req.user._id });
  if (!p) throw new HttpError(409, 'no_patient_profile', 'No patient record is linked to this account.');
  return p;
}

export function patientsRouter() {
  const r = Router();
  r.use(authenticate, requireRole('patient'));

  r.get('/me', async (req, res) => {
    const p = await loadOwnPatient(req);
    res.json({ profile: presentProfile(p) });
  });

  r.patch('/me', validate({ body: profileBody }), async (req, res) => {
    const p = await loadOwnPatient(req);
    const b = req.valid.body;
    if (b.father_name !== undefined) p.father_name = b.father_name || undefined;
    if (b.mother_name !== undefined) p.mother_name = b.mother_name || undefined;
    if (b.consanguinity !== undefined) p.consanguinity = b.consanguinity ?? undefined;
    if (b.ethnicity !== undefined) p.ethnicity = b.ethnicity ?? undefined;
    if (b.family_history !== undefined) {
      const fh = p.family_history ?? {};
      if (b.family_history.affected_relative !== undefined) fh.affected_relative = b.family_history.affected_relative ?? undefined;
      if (b.family_history.relationship !== undefined) fh.relationship = b.family_history.relationship ?? undefined;
      p.family_history = fh;
    }
    await p.save();
    await audit(req.user, 'patient.update_profile', { resourceType: 'patient', resourceId: p._id });
    res.json({ profile: presentProfile(p) });
  });

  return r;
}
