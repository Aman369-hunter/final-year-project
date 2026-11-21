// Guard on the Section 3.1/3.2 response contract. Every engine response passes
// through this before it is stored or returned, so a contract break in the
// engine surfaces as a 502 naming the field, not as a broken dashboard.
import { z } from 'zod';

const DISEASES = ['gaucher', 'fabry', 'pompe', 'mps1', 'niemann_pick_c', 'krabbe'];
const CATEGORIES = ['enzyme', 'genetic', 'symptom', 'biomarker', 'vitals'];
const unit = z.number().min(0).max(1);

const prediction = z.object({
  disease: z.enum(DISEASES),
  display_name: z.string().min(1),
  raw_score: z.number().min(0),
  max_possible_score: z.number().positive(),
  absolute_risk: unit,
  relative_probability: unit,
  rank: z.number().int().min(1).max(6),
});

const factor = z.object({
  category: z.enum(CATEGORIES),
  feature: z.string(),
  label: z.string(),
  value: z.string(),
  points: z.number(),
  direction: z.enum(['increases', 'decreases']),
  disease: z.enum(DISEASES),
  citation: z.string().min(1), // Section 11 rule 3
});

export const predictResponse = z
  .object({
    request_id: z.string().min(1),
    generated_at: z.string().min(1),
    predictions: z.array(prediction).length(6),
    risk_level: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']),
    risk_basis: z.literal('absolute_risk'),
    confidence: z.object({ level: z.string(), missing_inputs: z.array(z.string()), note: z.string() }),
    factors: z.array(factor),
    category_scores: z.object(Object.fromEntries(CATEGORIES.map((c) => [c, z.number()]))).strict(),
    inheritance: z.object({
      applicable: z.boolean(),
      mode: z.string(),
      punnett: z.object({ affected_pct: z.number(), carrier_pct: z.number(), unaffected_pct: z.number() }).nullable(),
      note: z.string(),
    }),
    recommendations: z.object({
      confirmatory_tests: z.array(z.object({ test: z.string(), priority: z.string(), rationale: z.string() })),
      treatment_pathways: z.array(z.object({ name: z.string(), stage: z.string() })),
      referral: z.string(),
    }),
    model: z.object({ engine_version: z.string(), mode: z.string(), weights_version: z.string() }),
    disclaimer: z.string().min(1), // Section 3.2: non-empty on every response
  })
  .superRefine((r, ctx) => {
    const seen = new Set(r.predictions.map((p) => p.disease));
    if (seen.size !== 6) ctx.addIssue({ code: 'custom', path: ['predictions'], message: 'must contain all 6 diseases once' });
    const ranks = r.predictions.map((p) => p.rank);
    if (ranks.some((rank, i) => rank !== i + 1)) ctx.addIssue({ code: 'custom', path: ['predictions'], message: 'must be sorted by rank 1..6' });
    const sum = r.predictions.reduce((s, p) => s + p.relative_probability, 0);
    if (Math.abs(sum - 1) > 0.01) ctx.addIssue({ code: 'custom', path: ['predictions'], message: `relative_probability sums to ${sum.toFixed(3)}` });
    for (const p of r.predictions) {
      if (Math.abs(p.absolute_risk - Math.min(1, p.raw_score / p.max_possible_score)) > 0.002) {
        ctx.addIssue({ code: 'custom', path: ['predictions', p.disease], message: 'absolute_risk != raw_score / max_possible_score' });
      }
    }
  });

// Returns a list of "path: problem" strings; empty when the response conforms.
export function contractViolations(response) {
  const result = predictResponse.safeParse(response);
  if (result.success) return [];
  return result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
