// Pure helpers behind the manual lab entry form: field coercion, the
// pre-flight check, the PATCH payload, and readable text for a server
// rejection. Kept out of the component so they can be tested against the real
// backend schema (see labsForm.test.js).

// A blank, partly typed or otherwise unparseable field is "not entered", never
// NaN — the API rejects NaN with an unreadable path like enzymes.0.reference_low.
export const num = (x) => {
  if (x === '' || x == null) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function pctOfNormal(e) {
  const v = num(e.value);
  if (v == null) return null;
  const mean = num(e.reference_mean);
  const low = num(e.reference_low);
  const high = num(e.reference_high);
  if (mean) return (100 * v) / mean;
  if (low != null && high) return (100 * v) / ((low + high) / 2);
  if (high) return (100 * v) / high;
  return null;
}

// Mirrors the backend schema (routes/schemas.js labsBody) so the lab gets a
// plain-English message in the row's own words instead of a zod path.
export function labsProblems(enzymes, biomarkers) {
  const out = [];
  enzymes.forEach((e, i) => {
    const where = `Enzyme ${i + 1} (${e.analyte})`;
    const v = num(e.value);
    const low = num(e.reference_low);
    const high = num(e.reference_high);
    const mean = num(e.reference_mean);
    const typed = (x) => x !== '' && x != null;
    if (v == null) out.push(typed(e.value) ? `${where}: the value is not a number.` : `${where}: enter a value.`);
    else if (v < 0) out.push(`${where}: the value cannot be negative.`);
    if (typed(e.reference_high) && high == null) out.push(`${where}: Ref high is not a number.`);
    if (typed(e.reference_low) && low == null) out.push(`${where}: Ref low is not a number.`);
    if (high == null && mean == null) out.push(`${where}: enter Ref high — a value with no reference range cannot be scored.`);
    if (high != null && high <= 0) out.push(`${where}: Ref high must be greater than 0.`);
    if (low != null && low < 0) out.push(`${where}: Ref low cannot be negative.`);
    if (low != null && high != null && low >= high) out.push(`${where}: Ref low must be below Ref high.`);
  });
  biomarkers.forEach((b, i) => {
    const where = `Biomarker ${i + 1} (${b.analyte})`;
    const v = num(b.value);
    const uln = num(b.reference_high);
    if (v == null) out.push(`${where}: enter a value.`);
    else if (v < 0) out.push(`${where}: the value cannot be negative.`);
    if (uln == null) out.push(`${where}: enter the ULN — a value with no upper limit of normal cannot be scored.`);
    else if (uln <= 0) out.push(`${where}: the ULN must be greater than 0.`);
  });
  return out;
}

export function buildLabsPayload({ enzymes, biomarkers, routine, genetics }) {
  const payload = {};
  if (enzymes.length) {
    payload.enzymes = enzymes.map((e) =>
      defined({
        analyte: e.analyte,
        value: num(e.value),
        unit: e.unit,
        assay: e.assay,
        reference_low: num(e.reference_low),
        reference_high: num(e.reference_high),
        reference_mean: num(e.reference_mean),
      }),
    );
  }
  if (biomarkers.length) {
    payload.biomarkers = biomarkers.map((b) =>
      defined({ analyte: b.analyte, value: num(b.value), unit: b.unit, reference_high: num(b.reference_high) }),
    );
  }
  const rt = defined(Object.fromEntries(Object.entries(routine ?? {}).map(([k, v]) => [k, num(v)])));
  if (Object.keys(rt).length) payload.routine = rt;
  if (genetics?.tested) {
    payload.genetics = {
      tested: true,
      findings: genetics.findings
        .filter((f) => f.gene && f.variant)
        .map((f) => ({
          gene: f.gene,
          variant: f.variant,
          zygosity: f.zygosity || 'heterozygous',
          classification: f.classification || 'vus',
        })),
    };
  }
  return payload;
}

// Fallback for anything the client check missed: turn zod paths into words.
const ISSUE_TEXT = {
  custom: 'needs a reference range',
  invalid_type: 'is not a number',
  too_small: 'is below the allowed minimum',
  too_big: 'is above the allowed maximum',
  invalid_enum_value: 'is not one of the allowed options',
};

export function serverMessage(err) {
  const issues = err.body?.issues;
  if (!issues?.length) return err.message;
  return issues
    .map((i) => {
      const parts = String(i.path).split('.');
      const group = parts[0] === 'enzymes' ? 'Enzyme' : parts[0] === 'biomarkers' ? 'Biomarker' : parts[0];
      const row = Number(parts[1]);
      const field = parts[2] ? ` → ${parts[2].replace(/_/g, ' ')}` : '';
      const label = Number.isInteger(row) ? `${group} ${row + 1}${field}` : String(i.path);
      return `${label} ${ISSUE_TEXT[i.code] ?? 'is invalid'}.`;
    })
    .join(' ');
}
