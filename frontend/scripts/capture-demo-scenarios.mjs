// Generates src/demo/scenarios.generated.json: the four scripted demo patients,
// each with its input AND the real engine's response to that input.
//
//   node scripts/capture-demo-scenarios.mjs
//
// Needs the engine on :8000 (127.0.0.1). It only calls POST /predict, which is a
// pure computation: it writes nothing to MongoDB and nothing under data/.
//
// Bands are never forced. If an input does not land in its intended band, change the
// INPUT here, never the engine or weights. scenarios.test.js pins the bands, so a
// future weights change that moves a scenario fails loudly instead of quietly
// showing a demo clinician the wrong risk level.
import { readFileSync, writeFileSync } from 'node:fs';

const ENGINE = process.env.ENGINE_URL || 'http://127.0.0.1:8000';
const FIX = new URL('../../fixtures/live/', import.meta.url);
const live = (n) => JSON.parse(readFileSync(new URL(`request.${n}.json`, FIX), 'utf8'));
const S = (hpo_id, label, severity = 2) => ({ hpo_id, label, present: true, severity });

// 1. Clear Gaucher → HIGH. The captured case lacked genetics (the biggest single
//    input), so it capped at MODERATE; add the classic N370S homozygous result.
const gaucher = live('gaucher');
gaucher.genetics = {
  tested: true,
  findings: [{ gene: 'GBA', variant: 'c.1226A>G (p.Asn409Ser)', zygosity: 'homozygous', classification: 'pathogenic' }],
  parents: { mother_genotype: 'carrier', father_genotype: 'carrier' },
};

// 2. Fabry, heterozygous female → MODERATE (as captured: GLA het, low enzyme, high lyso-Gb3).
const fabry = live('fabry_female');

// 3. Ambiguous → MODERATE with overlapping findings. Hepatosplenomegaly + a raised
//    chitotriosidase point at Gaucher; gaze palsy, ataxia and a raised lyso-SM-509
//    point at Niemann-Pick C. No enzyme assay or genetics yet to separate them.
const ambiguous = {
  patient: { age_years: 6.5, sex: 'female', consanguinity: false, ethnicity: 'south_asian', family_history: { affected_relative: false } },
  symptoms: [
    S('HP:0001744', 'Splenomegaly', 3), S('HP:0002240', 'Hepatomegaly', 2), S('HP:0000511', 'Vertical supranuclear gaze palsy', 2),
    S('HP:0001251', 'Ataxia', 2), S('HP:0001263', 'Global developmental delay', 2), S('HP:0001288', 'Gait disturbance', 2),
    S('HP:0002015', 'Dysphagia', 1), S('HP:0000708', 'Atypical behavior', 1), S('HP:0001268', 'Mental deterioration', 1),
  ],
  labs: {
    biomarkers: [
      { analyte: 'chitotriosidase', value: 520, unit: 'nmol/h/mL', reference_high: 150 },
      { analyte: 'lyso_SM_509', value: 9, unit: 'ng/mL', reference_high: 3 },
      { analyte: 'lyso_Gb1', value: 28, unit: 'ng/mL', reference_high: 9 },
    ],
  },
};

// 4. Healthy control → LOW.
const healthy = live('healthy');

// `state` is where each patient starts, spread so all three dashboards have work.
const SCENARIOS = [
  { key: 'gaucher', id: 'demo-gaucher', name: 'Demo Patient A', blurb: 'Clear Gaucher', state: 'DOCTOR_REVIEW', minutesAgo: 95, expectBand: 'HIGH', request: gaucher },
  { key: 'fabry', id: 'demo-fabry', name: 'Demo Patient B', blurb: 'Fabry, heterozygous female', state: 'DOCTOR_REVIEW', minutesAgo: 240, expectBand: 'MODERATE', request: fabry },
  { key: 'ambiguous', id: 'demo-ambiguous', name: 'Demo Patient C', blurb: 'Ambiguous: Niemann-Pick C vs Gaucher', state: 'LAB_PENDING', minutesAgo: 60, expectBand: 'MODERATE', request: ambiguous },
  { key: 'healthy', id: 'demo-healthy', name: 'Demo Patient D', blurb: 'Healthy control', state: 'SUBMITTED', minutesAgo: 30, expectBand: 'LOW', request: healthy },
];

const out = { generated_by: 'scripts/capture-demo-scenarios.mjs', scenarios: [] };
for (const s of SCENARIOS) {
  const res = await fetch(`${ENGINE}/predict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s.request) });
  const response = await res.json();
  if (!res.ok) throw new Error(`${s.key}: engine HTTP ${res.status} ${JSON.stringify(response).slice(0, 200)}`);
  const top = response.predictions.find((p) => p.rank === 1);
  const ok = response.risk_level === s.expectBand;
  console.log(`${ok ? 'ok  ' : 'MISS'} ${s.key.padEnd(10)} ${response.risk_level.padEnd(9)} (wanted ${s.expectBand}) top ${top.disease} ${top.absolute_risk}`);
  if (!ok) process.exitCode = 1;
  out.scenarios.push({ ...s, response, engine_version: response.model?.engine_version });
}
writeFileSync(new URL('../src/demo/scenarios.generated.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('wrote src/demo/scenarios.generated.json');
