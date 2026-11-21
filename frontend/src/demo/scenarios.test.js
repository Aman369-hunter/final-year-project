// Pins the four scripted patients to the bands the demo promises. Their responses are
// REAL engine output (scripts/capture-demo-scenarios.mjs), never hand-typed. If a
// weights change moves a scenario to another band this fails, so a demo can never
// quietly show a clinician the wrong risk level. Fix the INPUT in the capture script.
import { describe, expect, it } from 'vitest';
import file from './scenarios.generated.json';

const by = Object.fromEntries(file.scenarios.map((s) => [s.key, s]));
const ranked = (s) => [...s.response.predictions].sort((a, b) => a.rank - b.rank);

describe('scripted demo scenarios', () => {
  it('cover the four requested patients', () => {
    expect(Object.keys(by).sort()).toEqual(['ambiguous', 'fabry', 'gaucher', 'healthy']);
  });

  it.each([
    ['gaucher', 'HIGH', 'gaucher'],
    ['fabry', 'MODERATE', 'fabry'],
    ['ambiguous', 'MODERATE', 'niemann_pick_c'],
    ['healthy', 'LOW', null],
  ])('%s lands in %s', (key, band, top) => {
    const s = by[key];
    expect(s.response.risk_level).toBe(band);
    expect(s.expectBand).toBe(band);
    if (top) expect(ranked(s)[0].disease).toBe(top);
  });

  it('ambiguous really is ambiguous: Gaucher is a credible runner-up to Niemann-Pick C', () => {
    const [a, b] = ranked(by.ambiguous);
    expect(b.disease).toBe('gaucher');
    expect(b.absolute_risk).toBeGreaterThan(0.15);
    expect(a.absolute_risk - b.absolute_risk).toBeLessThan(0.2);
  });

  it('fabry is a heterozygous female', () => {
    expect(by.fabry.request.patient.sex).toBe('female');
    expect(by.fabry.request.genetics.findings[0]).toMatchObject({ gene: 'GLA', zygosity: 'heterozygous' });
  });

  it('starts at the promised lifecycle states', () => {
    expect(Object.fromEntries(file.scenarios.map((s) => [s.key, s.state]))).toEqual({
      gaucher: 'DOCTOR_REVIEW',
      fabry: 'DOCTOR_REVIEW',
      ambiguous: 'LAB_PENDING',
      healthy: 'SUBMITTED',
    });
  });

  it('every response is engine-shaped, carries the disclaimer, and records the engine version', () => {
    for (const s of file.scenarios) {
      expect(s.engine_version).toBeTruthy();
      expect(s.response.disclaimer).toBeTruthy();
      expect(s.response.predictions.length).toBeGreaterThanOrEqual(6);
    }
  });
});
