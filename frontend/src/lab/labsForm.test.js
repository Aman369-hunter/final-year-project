// The manual lab entry form used to POST values the backend rejects, and showed
// the rejection as a raw zod path ("enzymes.0.reference_low"). These tests pin
// the client-side check that catches those rows first, and prove the payload
// built from a blank/garbled field never contains NaN.
import { describe, expect, it } from 'vitest';
import { labsBody } from '../../../backend/src/routes/schemas.js';
import { buildLabsPayload, labsProblems } from './labsPayload.js';

const enzyme = (over = {}) => ({ analyte: 'GBA', value: '0.8', unit: 'nmol/h/mL', assay: 'DBS', reference_low: '4.5', reference_high: '20', ...over });
const biomarker = (over = {}) => ({ analyte: 'lyso_Gb1', value: '210', unit: 'ng/mL', reference_high: '9', ...over });

describe('labsProblems', () => {
  it('accepts a complete enzyme and biomarker row', () => {
    expect(labsProblems([enzyme()], [biomarker()])).toEqual([]);
  });

  it('names the row and the field, in words', () => {
    const [msg] = labsProblems([enzyme({ reference_high: '' })], []);
    expect(msg).toContain('Enzyme 1 (GBA)');
    expect(msg).toMatch(/Ref high/);
    expect(msg).not.toMatch(/enzymes\.0/);
  });

  it.each([
    ['missing value', [enzyme({ value: '' })], []],
    ['negative value', [enzyme({ value: '-1' })], []],
    ['no reference range at all', [enzyme({ reference_low: '', reference_high: '' })], []],
    ['zero ref high', [enzyme({ reference_high: '0' })], []],
    ['negative ref low', [enzyme({ reference_low: '-2' })], []],
    ['ref low above ref high', [enzyme({ reference_low: '30' })], []],
    ['biomarker with no ULN', [], [biomarker({ reference_high: '' })]],
    ['biomarker with zero ULN', [], [biomarker({ reference_high: '0' })]],
    ['biomarker with no value', [], [biomarker({ value: '' })]],
  ])('rejects %s', (_label, enzymes, biomarkers) => {
    expect(labsProblems(enzymes, biomarkers).length).toBeGreaterThan(0);
  });
});

describe('buildLabsPayload', () => {
  it('never emits NaN for a blank or unparseable field', () => {
    const payload = buildLabsPayload({
      enzymes: [enzyme({ reference_low: '', reference_high: '20' })],
      biomarkers: [biomarker({ reference_high: '9' })],
      routine: { hemoglobin_g_dl: '', platelets_10e9_l: 'abc', ck_u_l: '95' },
      genetics: { tested: false, findings: [] },
    });
    const flat = JSON.stringify(payload);
    expect(flat).not.toContain('null');
    expect(Object.values(payload.enzymes[0]).every((v) => typeof v !== 'number' || Number.isFinite(v))).toBe(true);
    expect(payload.enzymes[0]).not.toHaveProperty('reference_low');
    expect(payload.routine).toEqual({ ck_u_l: 95 });
  });

  it('builds a payload the real backend schema accepts', () => {
    const payload = buildLabsPayload({
      enzymes: [enzyme()],
      biomarkers: [biomarker()],
      routine: { hemoglobin_g_dl: '9.1', platelets_10e9_l: '95', ck_u_l: '' },
      genetics: { tested: true, findings: [{ gene: 'GBA1', variant: 'c.1226A>G', zygosity: 'homozygous', classification: 'pathogenic' }] },
    });
    const result = labsBody.safeParse(payload);
    expect(result.success).toBe(true);
  });

  // The regression itself: whatever the lab typed, a payload that passes the
  // client check must pass the server schema, so the cryptic path never returns.
  it('anything labsProblems accepts, labsBody accepts', () => {
    const rows = [
      [[enzyme({ reference_low: '' })], [biomarker()]],
      [[enzyme({ reference_mean: '12', reference_low: '', reference_high: '' })], []],
      [[enzyme()], [biomarker({ value: '0' })]],
    ];
    for (const [enzymes, biomarkers] of rows) {
      expect(labsProblems(enzymes, biomarkers)).toEqual([]);
      const parsed = labsBody.safeParse(buildLabsPayload({ enzymes, biomarkers, routine: {}, genetics: { tested: false, findings: [] } }));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
});
