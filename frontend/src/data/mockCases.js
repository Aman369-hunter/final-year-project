// DEMO DATA. Four cases in DOCTOR_REVIEW, one per fixture in /fixtures.
// Each object has the exact shape the backend returns to a doctor from
// GET /api/cases/:id (backend/src/services/casePresenter.js), with
// assessment.response = the fixture verbatim. Swapping to the live API later
// means replacing doctorStore.js, not the components.
//
// Patient inputs are chosen to agree with each fixture's fired factors.
// Lab values are illustrative only: they are not reference ranges or cutoffs.
// Every lab result carries its own reference interval, per Section 3.1a.
import gaucher from '@fixtures/predict.gaucher.json';
import fabryFemale from '@fixtures/predict.fabry_female.json';
import ambiguous from '@fixtures/predict.ambiguous.json';
import healthy from '@fixtures/predict.healthy.json';

// VITE_ENGINE_OUTPUT=live swaps each fixture for the live engine's response to the
// same patient, captured through the Node proxy by scripts/capture-live-fixtures.js.
const LIVE = import.meta.glob('../../../fixtures/live/predict.*.json', { eager: true, import: 'default' });
export const ENGINE_OUTPUT = import.meta.env.VITE_ENGINE_OUTPUT === 'live' ? 'live' : 'fixtures';
const response = (name, fixture) =>
  ENGINE_OUTPUT === 'live' ? LIVE[`../../../fixtures/live/predict.${name}.json`] ?? missingLive(name) : fixture;
function missingLive(name) {
  throw new Error(`fixtures/live/predict.${name}.json not found: run scripts/capture-live-fixtures.js first`);
}

const S = (hpo_id, label, present, severity = 0) => ({ hpo_id, label, present, severity });

function demoCase({ id, minutesAgo, patient, symptoms, vitals = null, labs = null, response }) {
  const submitted = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    state: 'DOCTOR_REVIEW',
    created_at: submitted,
    updated_at: submitted,
    allowed_transitions: ['REPORTED', 'REFERRED', 'LAB_PENDING'],
    facility: 'facility-001',
    patient,
    history: [
      { from: null, to: 'DRAFT', at: submitted, role: 'patient', reason: null },
      { from: 'DRAFT', to: 'SUBMITTED', at: submitted, role: 'patient', reason: null },
      { from: 'SUBMITTED', to: 'LAB_PENDING', at: submitted, role: 'lab', reason: null },
      { from: 'LAB_PENDING', to: 'DOCTOR_REVIEW', at: submitted, role: 'lab', reason: null },
    ],
    symptoms,
    vitals,
    labs,
    assigned_lab: 'demo-lab',
    assigned_doctor: null,
    rejection: null,
    risk_level: response.risk_level,
    assessment: { id: `asm-${id}`, created_at: submitted, trigger: 'enter_doctor_review', response },
    release: null,
  };
}

export const MOCK_CASES = [
  demoCase({
    id: 'demo-case-a',
    minutesAgo: 95,
    patient: {
      id: 'demo-patient-a', name: 'Demo patient A', age_years: 7.5, sex: 'male', date_of_birth: '2019-05-15',
      consanguinity: false, ethnicity: 'south_asian', family_history: { affected_relative: true, relationship: 'sibling' },
    },
    symptoms: [
      S('HP:0001744', 'Splenomegaly', true, 3),
      S('HP:0002240', 'Hepatomegaly', true, 2),
      S('HP:0001873', 'Thrombocytopenia', true, 2),
      S('HP:0001903', 'Anaemia', true, 2),
      S('HP:0001250', 'Seizure', false),
    ],
    vitals: {
      source: 'device', heart_rate_bpm: 102, spo2_pct: 95, temperature_c: 37.1, respiratory_rate_bpm: 24,
      ecg: { rhythm: 'sinus', qrs_ms: 96, arrhythmia_flag: false }, activity: { tremor_index: 0.12, mobility_score: 0.74 },
    },
    labs: {
      enzymes: [{ analyte: 'GBA', value: 0.8, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 4.5, reference_high: 20.0 }],
      biomarkers: [{ analyte: 'lyso_Gb1', value: 210.0, unit: 'ng/mL', reference_high: 9.0 }],
      routine: { hemoglobin_g_dl: 9.1, platelets_10e9_l: 95 },
      genetics: null, // fixture: confidence.missing_inputs = ["genetics"]
    },
    response: response('gaucher', gaucher),
  }),
  demoCase({
    id: 'demo-case-b',
    minutesAgo: 240,
    patient: {
      id: 'demo-patient-b', name: 'Demo patient B', age_years: 34, sex: 'female', date_of_birth: '1992-03-02',
      consanguinity: false, ethnicity: 'south_asian', family_history: { affected_relative: true, relationship: 'brother' },
    },
    symptoms: [
      S('HP:0003401', 'Burning pain in hands and feet', true, 2),
      S('HP:0000966', 'Reduced sweating', true, 1),
      S('HP:0000093', 'Proteinuria', true, 1),
      S('HP:0007957', 'Corneal clouding', null),
    ],
    vitals: {
      source: 'device', heart_rate_bpm: 64, spo2_pct: 98, temperature_c: 36.7, respiratory_rate_bpm: 14,
      ecg: { rhythm: 'irregular', qrs_ms: 104, arrhythmia_flag: true }, activity: { tremor_index: 0.03, mobility_score: 0.95 },
    },
    labs: {
      enzymes: [{ analyte: 'alpha_Gal_A', value: 2.9, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 3.0, reference_high: 12.3 }],
      biomarkers: [{ analyte: 'lyso_Gb3', value: 4.1, unit: 'ng/mL', reference_high: 0.8 }],
      routine: { hemoglobin_g_dl: 12.8, platelets_10e9_l: 240 },
      genetics: {
        tested: true,
        findings: [{ gene: 'GLA', variant: 'c.644A>G', zygosity: 'heterozygous', classification: 'pathogenic' }],
        parents: { mother_genotype: 'carrier', father_genotype: 'unaffected' },
      },
    },
    response: response('fabry_female', fabryFemale),
  }),
  demoCase({
    id: 'demo-case-c',
    minutesAgo: 30,
    patient: {
      id: 'demo-patient-c', name: 'Demo patient C', age_years: 4.2, sex: 'female', date_of_birth: '2022-08-20',
      consanguinity: null, ethnicity: null, family_history: null,
    },
    symptoms: [
      S('HP:0001744', 'Splenomegaly', true, 2),
      S('HP:0001251', 'Ataxia', true, 2),
      S('HP:0001263', 'Developmental delay', true, 1),
      S('HP:0002240', 'Hepatomegaly', true, 1),
    ],
    vitals: null, // fixture: missing vitals
    labs: {
      biomarkers: [{ analyte: 'chitotriosidase', value: 310, unit: 'nmol/h/mL', reference_high: 150 }],
      genetics: null,
    },
    response: response('ambiguous', ambiguous),
  }),
  demoCase({
    id: 'demo-case-d',
    minutesAgo: 400,
    patient: {
      id: 'demo-patient-d', name: 'Demo patient D', age_years: 10.1, sex: 'male', date_of_birth: '2016-10-01',
      consanguinity: false, ethnicity: 'south_asian', family_history: { affected_relative: false },
    },
    symptoms: [
      S('HP:0012378', 'Fatigue', true, 1),
      S('HP:0001744', 'Splenomegaly', false),
      S('HP:0001250', 'Seizure', false),
      S('HP:0003401', 'Burning pain in hands and feet', false),
    ],
    vitals: {
      source: 'device', heart_rate_bpm: 84, spo2_pct: 99, temperature_c: 36.8, respiratory_rate_bpm: 18,
      ecg: { rhythm: 'sinus', qrs_ms: 88, arrhythmia_flag: false }, activity: { tremor_index: 0.02, mobility_score: 0.97 },
    },
    labs: {
      enzymes: [
        { analyte: 'GBA', value: 11.4, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 4.5, reference_high: 20.0 },
        { analyte: 'alpha_Gal_A', value: 9.6, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 3.0, reference_high: 12.3 },
        { analyte: 'GAA', value: 14.2, unit: 'nmol/h/mL', assay: 'DBS', reference_low: 7.0 , reference_high: 24.0 },
      ],
      biomarkers: [{ analyte: 'lyso_Gb1', value: 2.1, unit: 'ng/mL', reference_high: 9.0 }],
      routine: { hemoglobin_g_dl: 13.4, platelets_10e9_l: 260, ck_u_l: 110 },
      genetics: { tested: true, findings: [], parents: { mother_genotype: 'unknown', father_genotype: 'unknown' } },
    },
    response: response('healthy', healthy),
  }),
];
