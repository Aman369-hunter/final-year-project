import mongoose from 'mongoose';
import { SEXES } from '../domain.js';

const PatientSchema = new mongoose.Schema(
  {
    // The patient's own login, if they have one.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    date_of_birth: { type: Date, required: true },
    sex: { type: String, enum: SEXES, required: true },
    // Section 6.1 identity. Parent names are how a clinic tells two same-named
    // patients apart; they are shown to the doctor only, never to the lab.
    father_name: { type: String, trim: true, maxlength: 120 },
    mother_name: { type: String, trim: true, maxlength: 120 },
    consanguinity: { type: Boolean },
    ethnicity: { type: String, trim: true, maxlength: 64 },
    family_history: {
      affected_relative: { type: Boolean },
      relationship: { type: String, trim: true, maxlength: 64 },
    },
    facility: { type: String, required: true, trim: true, maxlength: 64, index: true },
  },
  { timestamps: true },
);

PatientSchema.methods.ageYears = function ageYears(at = new Date()) {
  const years = (at - this.date_of_birth) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, Math.round(years * 10) / 10);
};

export const Patient = mongoose.models.Patient || mongoose.model('Patient', PatientSchema);
