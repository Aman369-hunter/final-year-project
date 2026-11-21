import mongoose from 'mongoose';
import { CASE_STATES, ROLES, ENZYME_ANALYTES, ENZYME_ASSAYS, BIOMARKER_ANALYTES } from '../domain.js';

const { ObjectId } = mongoose.Schema.Types;

const HistorySchema = new mongoose.Schema(
  {
    from: { type: String, enum: [...CASE_STATES, null], default: null },
    to: { type: String, enum: CASE_STATES, required: true },
    at: { type: Date, required: true, default: Date.now },
    actor: { type: ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
    reason: { type: String, maxlength: 500 },
  },
  { _id: false },
);

// Section 3.1 symptom shape. present = null means "don't know" (Section 6.1).
const SymptomSchema = new mongoose.Schema(
  {
    hpo_id: { type: String, required: true },
    label: { type: String, required: true, maxlength: 200 },
    present: { type: Boolean, default: null },
    severity: { type: Number, min: 0, max: 3, default: 0 },
  },
  { _id: false },
);

// Section 6.2: the lab stores a session summary plus the raw ECG segment.
const VitalsSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ['device', 'manual'] },
    heart_rate_bpm: Number,
    spo2_pct: Number,
    temperature_c: Number,
    respiratory_rate_bpm: Number,
    ecg: {
      rhythm: String,
      qrs_ms: Number,
      arrhythmia_flag: Boolean,
    },
    activity: {
      tremor_index: Number,
      mobility_score: Number,
    },
    ecg_segment: {
      sample_rate_hz: Number,
      samples: [Number],
    },
    recorded_at: Date,
    recorded_by: { type: ObjectId, ref: 'User' },
  },
  { _id: false },
);

const EnzymeSchema = new mongoose.Schema(
  {
    analyte: { type: String, enum: ENZYME_ANALYTES, required: true },
    value: { type: Number, required: true },
    unit: { type: String, required: true },
    assay: { type: String, enum: ENZYME_ASSAYS },
    pct_of_normal: { type: Number },
    reference_mean: { type: Number },
    reference_low: { type: Number },
    reference_high: { type: Number },
  },
  { _id: false },
);

const BiomarkerSchema = new mongoose.Schema(
  {
    analyte: { type: String, enum: BIOMARKER_ANALYTES, required: true },
    value: { type: Number, required: true },
    unit: { type: String, required: true },
    fold_uln: { type: Number },
    reference_high: { type: Number },
  },
  { _id: false },
);

const LabsSchema = new mongoose.Schema(
  {
    enzymes: { type: [EnzymeSchema], default: undefined },
    biomarkers: { type: [BiomarkerSchema], default: undefined },
    routine: {
      hemoglobin_g_dl: Number,
      platelets_10e9_l: Number,
      ck_u_l: Number,
    },
    // AES-256-GCM ciphertext of the Section 3.1 `genetics` object. Never stored in clear.
    genetics_enc: { type: String },
    updated_at: Date,
    updated_by: { type: ObjectId, ref: 'User' },
  },
  { _id: false },
);

const CaseSchema = new mongoose.Schema(
  {
    patient: { type: ObjectId, ref: 'Patient', required: true, index: true },
    patientUser: { type: ObjectId, ref: 'User', index: true }, // scoping key for patient tokens
    facility: { type: String, required: true, index: true }, // scoping key for lab/doctor tokens
    state: { type: String, enum: CASE_STATES, required: true, default: 'DRAFT', index: true },
    history: { type: [HistorySchema], default: [] },

    symptoms: { type: [SymptomSchema], default: [] },
    vitals: { type: VitalsSchema, default: undefined },
    labs: { type: LabsSchema, default: undefined },

    assignedLab: { type: ObjectId, ref: 'User' },
    assignedDoctor: { type: ObjectId, ref: 'User' },
    rejection: {
      reason: { type: String, maxlength: 500 },
      at: Date,
    },

    latestAssessment: { type: ObjectId, ref: 'Assessment' },
    // Denormalised from the latest assessment so the doctor worklist can sort CRITICAL first.
    // Only ever serialised for doctors.
    risk_level: { type: String, enum: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] },
    risk_rank: { type: Number },

    release: {
      released: { type: Boolean, default: false },
      at: Date,
      by: { type: ObjectId, ref: 'User' },
      note: { type: String, maxlength: 2000 },
    },
  },
  { timestamps: true },
);

CaseSchema.index({ facility: 1, state: 1, risk_rank: -1 });

export const Case = mongoose.models.Case || mongoose.model('Case', CaseSchema);
