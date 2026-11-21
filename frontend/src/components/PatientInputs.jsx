// The raw inputs behind the score: what the patient submitted and what the lab measured.
// Each panel also exposes the exact JSON for inspection.
import { Card, Empty } from './ui.jsx';

function RawJson({ value }) {
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer select-none text-xs font-medium text-accent-fg hover:underline">View raw JSON</summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-primary p-3 text-[11px] leading-relaxed text-on-primary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-[11px] uppercase tracking-wide text-fg-3">
          <tr>{head.map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="py-1.5 pr-3 text-fg">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const presence = (p) =>
  p === true ? <span className="font-medium text-danger-fg">Present</span> : p === false ? <span className="text-fg-3">Absent</span> : <span className="text-fg-3">Don’t know</span>;

const fmt = (v) => (v === null || v === undefined ? '—' : String(v));

// Section 3.1a: how a result converts to the quantity the engine scores.
// A result with no reference interval is not scored, and says so.
function Unscorable() {
  return <span className="rounded bg-warn-bg px-1.5 py-px text-[11px] font-medium text-warn-fg">no range — not scored</span>;
}

function referenceLabel(e) {
  if (e.reference_low != null && e.reference_high != null) return `${e.reference_low}–${e.reference_high}`;
  if (e.reference_mean != null) return `mean ${e.reference_mean}`;
  if (e.reference_high != null) return `< ${e.reference_high}`;
  if (e.pct_of_normal != null) return 'reported as % of normal';
  return <Unscorable />;
}

function pctOfNormal(e) {
  if (e.pct_of_normal != null) return `${e.pct_of_normal.toFixed(1)}%`;
  if (e.reference_mean) return `${((100 * e.value) / e.reference_mean).toFixed(1)}%`;
  if (e.reference_low != null && e.reference_high != null) return `${((100 * e.value) / ((e.reference_low + e.reference_high) / 2)).toFixed(1)}%`;
  if (e.reference_high) return `${((100 * e.value) / e.reference_high).toFixed(1)}%`;
  return '—';
}

function foldUln(b) {
  if (b.fold_uln != null) return `${b.fold_uln.toFixed(1)}×`;
  if (b.reference_high) return `${(b.value / b.reference_high).toFixed(1)}×`;
  return '—';
}

export function SymptomsPanel({ symptoms }) {
  return (
    <Card title="Patient-submitted symptoms" subtitle="As entered by the patient">
      {symptoms?.length ? (
        <Table
          head={['Symptom', 'HPO', 'Status', 'Severity (0–3)']}
          rows={symptoms.map((s) => [s.label, <code key="h" className="text-xs text-fg-3">{s.hpo_id}</code>, presence(s.present), s.present ? s.severity : '—'])}
        />
      ) : (
        <Empty>No symptoms submitted.</Empty>
      )}
      <RawJson value={symptoms} />
    </Card>
  );
}

export function LabValuesPanel({ labs, vitals }) {
  const g = labs?.genetics;
  return (
    <Card title="Lab values" subtitle="As entered by the lab, each with the assay's own reference interval (Section 3.1a).">
      <div className="space-y-5">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Enzymes</h3>
          {labs?.enzymes?.length ? (
            <Table
              head={['Analyte', 'Value', 'Unit', 'Assay', 'Reference', '% of normal']}
              rows={labs.enzymes.map((e) => [
                e.analyte,
                <span key="v" className="tabular-nums">{e.value}</span>,
                e.unit,
                e.assay,
                referenceLabel(e),
                pctOfNormal(e),
              ])}
            />
          ) : <Empty>Not measured.</Empty>}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Biomarkers</h3>
          {labs?.biomarkers?.length ? (
            <Table
              head={['Analyte', 'Value', 'Unit', 'Reference', '× ULN']}
              rows={labs.biomarkers.map((b) => [
                b.analyte,
                <span key="v" className="tabular-nums">{b.value}</span>,
                b.unit,
                b.reference_high ? `< ${b.reference_high}` : <Unscorable key="u" />,
                foldUln(b),
              ])}
            />
          ) : <Empty>Not measured.</Empty>}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Routine bloods</h3>
          {labs?.routine ? (
            <Table
              head={['Haemoglobin (g/dL)', 'Platelets (10⁹/L)', 'CK (U/L)']}
              rows={[[fmt(labs.routine.hemoglobin_g_dl), fmt(labs.routine.platelets_10e9_l), fmt(labs.routine.ck_u_l)]]}
            />
          ) : <Empty>Not measured.</Empty>}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Genetics</h3>
          {!g ? (
            <Empty>No genetic testing supplied.</Empty>
          ) : g.findings?.length ? (
            <Table head={['Gene', 'Variant', 'Zygosity', 'Classification']} rows={g.findings.map((f) => [f.gene, <code key="v" className="text-xs">{f.variant}</code>, f.zygosity, f.classification])} />
          ) : (
            <Empty>Tested; no variants reported.</Empty>
          )}
          {g?.parents && (
            <p className="mt-1 text-xs text-fg-2">
              Mother: {fmt(g.parents.mother_genotype)} · Father: {fmt(g.parents.father_genotype)}
            </p>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">
            Vitals <span className="ml-1 rounded bg-muted px-1.5 py-px normal-case tracking-normal text-fg-2">Supporting evidence, not diagnostic</span>
          </h3>
          {vitals ? (
            <Table
              head={['HR', 'SpO₂', 'Temp', 'RR', 'ECG', 'Tremor', 'Mobility']}
              rows={[[
                `${fmt(vitals.heart_rate_bpm)} bpm`,
                `${fmt(vitals.spo2_pct)}%`,
                `${fmt(vitals.temperature_c)} °C`,
                `${fmt(vitals.respiratory_rate_bpm)}/min`,
                `${fmt(vitals.ecg?.rhythm)}, QRS ${fmt(vitals.ecg?.qrs_ms)} ms${vitals.ecg?.arrhythmia_flag ? ', arrhythmia flagged' : ''}`,
                fmt(vitals.activity?.tremor_index),
                fmt(vitals.activity?.mobility_score),
              ]]}
            />
          ) : <Empty>No device session recorded.</Empty>}
        </div>
      </div>
      <RawJson value={{ labs, vitals }} />
    </Card>
  );
}
