// Creates (or updates) the single project login that can act as patient, lab and
// doctor — one sign-in, all three dashboards, with the role filtering still
// enforced per active role. Idempotent: safe to re-run, touches nothing else.
// Usage:  node --env-file-if-exists=.env scripts/project-account.js
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Patient } from '../src/models/Patient.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/services/tokens.js';

if (config.isProduction) {
  console.error('Refusing to run with NODE_ENV=production.');
  process.exit(1);
}
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 10) {
  console.error('Set SEED_PASSWORD (10+ characters) in backend/.env first.');
  process.exit(1);
}

const EMAIL = 'demo@lsd.test';
const NAME = 'Project Demo';
const ROLES = ['patient', 'lab', 'doctor'];

await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });

let user = await User.findOne({ email: EMAIL });
if (user) {
  user.name = NAME;
  user.roles = ROLES;
  user.role = 'patient';
  user.facility = config.defaultFacility;
  user.active = true;
  user.passwordHash = await hashPassword(password);
  await user.save();
  console.log(`Updated ${EMAIL}`);
} else {
  user = await User.create({
    name: NAME,
    email: EMAIL,
    role: 'patient',
    roles: ROLES,
    facility: config.defaultFacility,
    passwordHash: await hashPassword(password),
  });
  console.log(`Created ${EMAIL}`);
}

// A patient record so the Patient dashboard works for this login too.
let patient = await Patient.findOne({ user: user._id });
if (!patient) {
  patient = await Patient.create({
    user: user._id,
    name: NAME,
    date_of_birth: new Date('2001-04-12'),
    sex: 'female',
    facility: config.defaultFacility,
  });
  console.log('Created its linked patient record');
}

console.log(`\n  email    ${EMAIL}`);
console.log(`  roles    ${user.allowedRoles().join(', ')}`);
console.log(`  facility ${user.facility}`);
console.log('  password = SEED_PASSWORD from backend/.env');
await mongoose.disconnect();
