// Shared vocabulary. Roles: Section 5. States: Section 6.0. Bands: Section 4.3.

export const ROLES = ['patient', 'lab', 'doctor', 'admin'];

export const CASE_STATES = [
  'DRAFT',
  'SUBMITTED',
  'LAB_PENDING',
  'LAB_REJECTED',
  'DOCTOR_REVIEW',
  'REPORTED',
  'REFERRED',
];

export const RISK_RANK = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };

// Section 6.1: the patient sees the lifecycle in friendly words.
export const PATIENT_STATUS_LABELS = {
  DRAFT: 'You are still filling in your details',
  SUBMITTED: 'Your details are submitted and waiting for the lab',
  LAB_PENDING: 'Your samples are with the lab',
  LAB_REJECTED: 'The lab needs a new sample from you',
  DOCTOR_REVIEW: 'A doctor is reviewing your results',
  REPORTED: 'Your doctor has completed the review',
  REFERRED: 'Your doctor has referred you to a specialist',
};

// Canonical analyte keys, spec 3.1b. Note alpha_Gal_A is the enzyme; GLA is the gene.
// Section 1: Niemann-Pick C has no enzyme assay, so there is no NPC analyte here.
export const ENZYME_ANALYTES = ['GBA', 'alpha_Gal_A', 'GAA', 'IDUA', 'GALC'];
export const ENZYME_ASSAYS = ['DBS', 'leukocyte', 'fibroblast'];
export const BIOMARKER_ANALYTES = [
  'lyso_Gb1',
  'lyso_Gb3',
  'CK',
  'urinary_GAG',
  'psychosine',
  'lyso_SM_509',
  'chitotriosidase',
  'oxysterols',
];
export const ZYGOSITIES = ['homozygous', 'heterozygous', 'hemizygous', 'compound_heterozygous'];
export const VARIANT_CLASSES = ['pathogenic', 'likely_pathogenic', 'vus', 'likely_benign', 'benign'];
export const PARENT_GENOTYPES = ['carrier', 'affected', 'unaffected', 'unknown'];
export const SEXES = ['male', 'female', 'other'];
