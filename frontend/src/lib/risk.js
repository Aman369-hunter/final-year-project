// Display helpers for the Section 3.1 response. No scoring happens here:
// the response is rendered as given (Section 3.2).

export const BANDS = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const BAND_RANK = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };

// Section 4.3 thresholds, used only to draw markers on the gauge and chart.
export const BAND_THRESHOLDS = [0.3, 0.6, 0.8];

// Colours come from the per-theme tokens in index.css (LOW→ok, MODERATE→warn,
// HIGH→high, CRITICAL→danger), each tuned separately for light and dark. `color` is
// for SVG/inline use; `soft` is the badge. The band's NAME is always printed too,
// so colour is never the only signal.
// Class names are spelled out in full so Tailwind's scanner emits them.
export const BAND_STYLE = {
  LOW: { color: 'rgb(var(--ok-solid))', soft: 'bg-ok-bg text-ok-fg ring-ok-line', label: 'Low' },
  MODERATE: { color: 'rgb(var(--warn-solid))', soft: 'bg-warn-bg text-warn-fg ring-warn-line', label: 'Moderate' },
  HIGH: { color: 'rgb(var(--high-solid))', soft: 'bg-high-bg text-high-fg ring-high-line', label: 'High' },
  CRITICAL: { color: 'rgb(var(--danger-solid))', soft: 'bg-danger-bg text-danger-fg ring-danger-line', label: 'Critical' },
};

export function bandFor(absoluteRisk) {
  if (absoluteRisk < 0.3) return 'LOW';
  if (absoluteRisk <= 0.6) return 'MODERATE';
  if (absoluteRisk <= 0.8) return 'HIGH';
  return 'CRITICAL';
}

export const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export const topPrediction = (response) => response.predictions.find((p) => p.rank === 1) ?? response.predictions[0];

// Worklist order (Section 6.3): CRITICAL first, then by top absolute risk, then oldest first.
export function compareByRisk(a, b) {
  const ra = a.assessment?.response;
  const rb = b.assessment?.response;
  return (
    (BAND_RANK[rb?.risk_level] ?? 0) - (BAND_RANK[ra?.risk_level] ?? 0) ||
    (rb ? topPrediction(rb).absolute_risk : 0) - (ra ? topPrediction(ra).absolute_risk : 0) ||
    new Date(a.created_at) - new Date(b.created_at)
  );
}

// The fired factor that contributed most to a disease, or null if none fired.
export function headlineFactor(response, disease) {
  return (
    response.factors
      .filter((f) => f.disease === disease && f.direction === 'increases')
      .sort((a, b) => b.points - a.points)[0] ?? null
  );
}

export function topDifferentials(response, n = 3) {
  return [...response.predictions].sort((a, b) => a.rank - b.rank).slice(0, n);
}

export const isPlaceholderCitation = (c) => /PLACEHOLDER/i.test(c ?? '');

export const CATEGORY_LABELS = {
  enzyme: 'Enzyme',
  genetic: 'Genetic',
  symptom: 'Symptom',
  biomarker: 'Biomarker',
  vitals: 'Vitals (supporting)',
};

export const MISSING_INPUT_LABELS = {
  genetics: 'Genetic testing',
  enzymes: 'Enzyme assays',
  biomarkers: 'Biomarkers',
  vitals: 'Device vitals',
  symptoms: 'Symptoms',
  labs: 'Lab results',
};
