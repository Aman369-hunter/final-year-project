// Dev seed: one user per staff role + FOUR demo patients, each with cases in
// varied states so every dashboard has something to show. WIPES the five
// collections first. Refuses to run with NODE_ENV=production. Passwords come
// from SEED_PASSWORD (.env); they are never printed.
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Assessment } from '../src/models/Assessment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Case } from '../src/models/Case.js';
import { Patient } from '../src/models/Patient.js';
import { User } from '../src/models/User.js';
import { createCase, setLabs, setVitals, transitionCase } from '../src/services/caseService.js';
import { hashPassword } from '../src/services/tokens.js';

if (config.isProduction) {
  console.error('Refusing to seed: NODE_ENV=production.');
  process.exit(1);
}
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 10) {
  console.error('Set SEED_PASSWORD (10+ characters) in backend/.env first.');
  process.exit(1);
}

const FACILITY = 'facility-001';

await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
for (const model of [User, Patient, Case, Assessment, AuditLog]) {
  await model.collection.deleteMany({}); // raw collection: AuditLog's model refuses deletes
}
await Promise.all([User, Patient, Case, Assessment, AuditLog].map((m) => m.syncIndexes()));

const passwordHash = await hashPassword(password);
const mkUser = (name, email, role, facility) => User.create({ name, email, role, facility, passwordHash });

const admin = await mkUser('Admin User', 'admin@lsd.test', 'admin');
const doctor = await mkUser('Dr Demo Doctor', 'doctor@lsd.test', 'doctor', FACILITY);
const lab = await mkUser('Lab Technician', 'lab@lsd.test', 'lab', FACILITY);

// Plain-language symptom entries (Section 6.1). label is what the patient sees;
// hpo_id is mapped behind the scenes. present: true | false | null (don't know).
const S = (hpo_id, label, present, severity = 0) => ({ hpo_id, label, present, severity });

// A linked patient login + record.
async function mkPatient({ name, email, dob, sex, consanguinity, ethnicity, family_history }) {
  const user = await mkUser(name, email, 'patient', FACILITY);
  const patient = await Patient.create({
    user: user._id,
    name,
    date_of_birth: new Date(dob),
    sex,
    consanguinity,
    ethnicity,
    family_history,
    facility: FACILITY,
  });
  return { user, patient };
}

// ── Patient 1: Gaucher-pattern child. Rich dashboard: a DRAFT in progress, a
//    SUBMITTED case awaiting the lab, and a fully scored case in DOCTOR_REVIEW. ──
const p1 = await mkPatient({
  name: 'Aarav Sharma',
  email: 'patient@lsd.test',
  dob: '2019-05-15',
  sex: 'male',
  consanguinity: false,
  ethnicity: 'south_asian',
  family_history: { affected_relative: true, relationship: 'sibling' },
});

const p1Draft = await createCase(p1.user, p1.patient, {
  symptoms: [S('HP:0012378', 'Tiredness or low energy', true, 1), S('HP:0002653', 'Bone pain', null)],
});

let p1Submitted = await createCase(p1.user, p1.patient, {
  symptoms: [
    S('HP:0001744', 'Swelling or fullness on the left side of the tummy', true, 2),
    S('HP:0001251', 'Unsteady walking or poor balance', true, 1),
  ],
});
p1Submitted = await transitionCase(p1Submitted, p1.user, 'SUBMITTED');

// Clear Gaucher (spec Section 10 profile 1), scored on entry to DOCTOR_REVIEW.
let p1Review = await createCase(p1.user, p1.patient, {
  symptoms: [
    S('HP:0001744', 'Swelling or fullness on the left side of the tummy', true, 3),
    S('HP:0002240', 'Swelling or fullness on the right side of the tummy', true, 2),
    S('HP:0001903', 'Looking pale and tired', true, 2),
    S('HP:0002653', 'Bone pain', true, 2),
  ],
});
p1Review = await transitionCase(p1Review, p1.user, 'SUBMITTED');
p1Review = await transitionCase(p1Review, lab, 'LAB_PENDING');
p1Review = await setVitals(p1Review, lab, {
  source: 'device',
  heart_rate_bpm: 102,
  spo2_pct: 95,
  temperature_c: 37.1,
  respiratory_rate_bpm: 24,
  ecg: { rhythm: 'sinus', qrs_ms: 96, arrhythmia_flag: false },
  activity: { tremor_index: 0.12, mobility_score: 0.74 },
});
p1Review = await setLabs(p1Review, lab, {
  enzymes: [{ analyte: 'GBA', value: 0.8, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 4.5, reference_high: 20.0 }],
  biomarkers: [{ analyte: 'lyso_Gb1', value: 210.0, unit: 'ng/mL', reference_high: 9.0 }],
  routine: { hemoglobin_g_dl: 9.1, platelets_10e9_l: 95 },
  genetics: {
    tested: true,
    findings: [{ gene: 'GBA1', variant: 'c.1226A>G', zygosity: 'homozygous', classification: 'pathogenic' }],
    parents: { mother_genotype: 'carrier', father_genotype: 'carrier' },
  },
});
p1Review = await transitionCase(p1Review, lab, 'DOCTOR_REVIEW');

// ── Patients 2–4: each starts with one DRAFT pre-filled in plain language,
//    ready to be submitted and run through the full pipeline. ──
const p2 = await mkPatient({
  name: 'Meera Nair',
  email: 'patient2@lsd.test',
  dob: '1992-02-10',
  sex: 'female',
  consanguinity: false,
  ethnicity: 'south_asian',
  family_history: { affected_relative: true, relationship: 'father' },
});
const p2Draft = await createCase(p2.user, p2.patient, {
  symptoms: [
    S('HP:0009830', 'Burning or tingling pain in the hands and feet', true, 2),
    S('HP:0001014', 'Clusters of small dark-red spots on the skin', true, 1),
    S('HP:0000966', 'Sweating little or not at all', true, 2),
    S('HP:0000790', 'Blood in the urine', null),
  ],
});

const p3 = await mkPatient({
  name: 'Rohan Gupta',
  email: 'patient3@lsd.test',
  dob: '1988-09-30',
  sex: 'male',
  consanguinity: false,
  ethnicity: 'south_asian',
  family_history: { affected_relative: false },
});
const p3Draft = await createCase(p3.user, p3.patient, {
  symptoms: [
    S('HP:0012378', 'Tiredness or low energy', true, 1),
    S('HP:0002094', 'Shortness of breath', false),
    S('HP:0001744', 'Swelling or fullness on the left side of the tummy', false),
  ],
});

const p4 = await mkPatient({
  name: 'Fatima Khan',
  email: 'patient4@lsd.test',
  dob: '2015-11-20',
  sex: 'female',
  consanguinity: true,
  ethnicity: 'south_asian',
  family_history: { affected_relative: null },
});
const p4Draft = await createCase(p4.user, p4.patient, {
  symptoms: [
    S('HP:0002240', 'Swelling or fullness on the right side of the tummy', true, 2),
    S('HP:0004322', 'Shorter than others of the same age', true, 1),
    S('HP:0001251', 'Unsteady walking or poor balance', null),
    S('HP:0012378', 'Tiredness or low energy', true, 1),
  ],
});

console.log('Seeded users (password = SEED_PASSWORD from .env):');
for (const u of [admin, doctor, lab, p1.user, p2.user, p3.user, p4.user]) {
  console.log(`  ${u.role.padEnd(8)} ${u.email}`);
}
console.log('Seeded cases:');
for (const c of [p1Draft, p1Submitted, p1Review, p2Draft, p3Draft, p4Draft]) {
  console.log(`  ${c.state.padEnd(14)} ${c.id}`);
}

await mongoose.disconnect();
