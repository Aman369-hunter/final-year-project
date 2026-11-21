// zod request schemas. Shapes follow Section 3.1; unknown keys are rejected.
import { z } from 'zod';
import {
  BIOMARKER_ANALYTES,
  CASE_STATES,
  ENZYME_ANALYTES,
  ENZYME_ASSAYS,
  PARENT_GENOTYPES,
  SEXES,
  VARIANT_CLASSES,
  ZYGOSITIES,
} from '../domain.js';

const num = z.number().finite();

export const symptomSchema = z
  .object({
    hpo_id: z.string().regex(/^HP:\d{7}$/),
    label: z.string().trim().min(1).max(200),
    present: z.boolean().nullable(), // null = don't know
    severity: z.number().int().min(0).max(3).default(0),
  })
  .strict();

export const symptomsBody = z.object({ symptoms: z.array(symptomSchema).max(200) }).strict();

export const createCaseBody = z.object({ symptoms: z.array(symptomSchema).max(200).optional() }).strict();

export const vitalsBody = z
  .object({
    source: z.enum(['device', 'manual']),
    heart_rate_bpm: num.min(0).max(400).optional(),
    spo2_pct: num.min(0).max(100).optional(),
    temperature_c: num.min(20).max(45).optional(),
    respiratory_rate_bpm: num.min(0).max(150).optional(),
    ecg: z
      .object({ rhythm: z.string().max(40).optional(), qrs_ms: num.min(0).max(1000).optional(), arrhythmia_flag: z.boolean().optional() })
      .strict()
      .optional(),
    activity: z
      .object({ tremor_index: num.min(0).optional(), mobility_score: num.min(0).max(1).optional() })
      .strict()
      .optional(),
    // Raw ECG segment from the ESP32 session (250 Hz; up to 5 minutes).
    ecg_segment: z
      .object({ sample_rate_hz: z.number().int().positive().max(2000), samples: z.array(num).max(75_000) })
      .strict()
      .optional(),
  })
  .strict();

export const geneticsSchema = z
  .object({
    tested: z.boolean(),
    findings: z
      .array(
        z
          .object({
            gene: z.string().trim().min(1).max(20),
            variant: z.string().trim().min(1).max(200), // HGVS
            zygosity: z.enum(ZYGOSITIES),
            classification: z.enum(VARIANT_CLASSES),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    parents: z
      .object({ mother_genotype: z.enum(PARENT_GENOTYPES).optional(), father_genotype: z.enum(PARENT_GENOTYPES).optional() })
      .strict()
      .optional(),
  })
  .strict();

export const labsBody = z
  .object({
    enzymes: z
      .array(z.object({
          analyte: z.enum(ENZYME_ANALYTES),
          value: num.min(0),
          unit: z.string().trim().min(1).max(30),
          assay: z.enum(ENZYME_ASSAYS),
          // Section 3.1a: a value with no reference interval cannot be scored.
          pct_of_normal: num.min(0).max(1000).optional(),
          reference_mean: num.positive().optional(),
          reference_low: num.min(0).optional(),
          reference_high: num.positive().optional(),
        }).strict()
        .refine((e) => e.pct_of_normal !== undefined || e.reference_mean !== undefined || e.reference_high !== undefined,
          { message: 'reference_range_required' }))
      .max(20)
      .optional(),
    biomarkers: z
      .array(z.object({
          analyte: z.enum(BIOMARKER_ANALYTES),
          value: num.min(0),
          unit: z.string().trim().min(1).max(30),
          // Section 3.1a: a value with no upper limit of normal cannot be scored.
          fold_uln: num.min(0).max(10000).optional(),
          reference_high: num.positive().optional(),
        }).strict()
        .refine((b) => b.fold_uln !== undefined || b.reference_high !== undefined,
          { message: 'reference_range_required' }))
      .max(20)
      .optional(),
    routine: z
      .object({ hemoglobin_g_dl: num.min(0).optional(), platelets_10e9_l: num.min(0).optional(), ck_u_l: num.min(0).optional() })
      .strict()
      .optional(),
    genetics: geneticsSchema.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'empty' });

export const transitionBody = z
  .object({ to_state: z.enum(CASE_STATES), reason: z.string().trim().max(500).optional() })
  .strict();

export const releaseBody = z.object({ note: z.string().trim().max(2000).optional() }).strict();

export const listQuery = z.object({
  state: z.enum(CASE_STATES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParams = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) });

// Section 3.1 request: only patient.age_years and patient.sex are required.
export const predictBody = z
  .object({
    patient: z.object({ age_years: num.min(0).max(130), sex: z.enum(SEXES) }).passthrough(),
  })
  .passthrough();

// Section 3.3: POST /api/punnett { mode, mother, father }
const GENOTYPE = z.enum(['carrier', 'affected', 'unaffected']);
export const punnettBody = z
  .object({
    mode: z.enum(['autosomal_recessive', 'x_linked', 'AR', 'XL']),
    mother: GENOTYPE,
    father: GENOTYPE,
    child_sex: z.enum(SEXES).optional(),
  })
  .strict();
