// Section 11 rule 7: the healthy control must come out LOW, and stay that way.
import { describe, expect, test } from 'vitest';
import { ENGINE_OUTPUT, MOCK_CASES } from '../data/mockCases.js';
import { worklist } from '../data/doctorStore.js';
import { buildReportPdf } from './reportPdf.js';
import { bandFor, headlineFactor, topDifferentials, topPrediction } from './risk.js';

// Runs against the fixtures by default, or live engine output with VITE_ENGINE_OUTPUT=live.
const byCase = Object.fromEntries(MOCK_CASES.map((c) => [c.id, c]));
const healthy = byCase['demo-case-d'].assessment.response;
const gaucher = byCase['demo-case-a'].assessment.response;

describe('healthy control', () => {
  test('renders as LOW', () => {
    expect(healthy.risk_level).toBe('LOW');
    expect(bandFor(topPrediction(healthy).absolute_risk)).toBe('LOW');
  });

  test('no disease above ~20%, by either measure', () => {
    for (const p of healthy.predictions) {
      expect(p.absolute_risk).toBeLessThan(0.2);
      expect(p.relative_probability).toBeLessThan(0.2);
    }
  });
});

describe('all four fixtures', () => {
  test.runIf(ENGINE_OUTPUT === 'fixtures')('are in the worklist, sorted by band: HIGH, MODERATE, MODERATE, LOW', () => {
    const bands = worklist(MOCK_CASES).map((c) => c.assessment.response.risk_level);
    expect(bands).toEqual(['HIGH', 'MODERATE', 'MODERATE', 'LOW']);
  });

  test('are in the worklist, never ordered against the band', () => {
    const ranks = worklist(MOCK_CASES).map((c) => ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].indexOf(c.assessment.response.risk_level));
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  test.each(MOCK_CASES.map((c) => [c.id, c]))(
    '%s satisfies the Section 3.2 rules the dashboard relies on',
    (_, c) => {
      const r = c.assessment.response;
      expect(r.predictions).toHaveLength(6);
      expect(Object.keys(r.category_scores).sort()).toEqual(['biomarker', 'enzyme', 'genetic', 'symptom', 'vitals']);
      expect(r.disclaimer.length).toBeGreaterThan(0);
      expect(bandFor(topPrediction(r).absolute_risk)).toBe(r.risk_level);
      expect(topDifferentials(r)).toHaveLength(3);
      expect(r.predictions.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6]);
      // Every disease key in factors must be one of the six the chart shows.
      const keys = new Set(r.predictions.map((p) => p.disease));
      for (const f of r.factors) expect(keys.has(f.disease)).toBe(true);
      // The top-ranked disease gets a headline factor whenever any of its rules fired.
      const top = topPrediction(r);
      if (top.raw_score > 0) expect(headlineFactor(r, top.disease)).not.toBeNull();
      expect(buildReportPdf(c).getNumberOfPages()).toBeGreaterThan(0);
    },
  );

  test('the headline factor is the highest-points factor for that disease', () => {
    expect(headlineFactor(gaucher, 'gaucher').feature).toBe('GBA');
    // In the fixture no Fabry rule fired; live, anaemia fires a small Fabry factor.
    if (ENGINE_OUTPUT === 'fixtures') expect(headlineFactor(gaucher, 'fabry')).toBeNull();
  });
});
