// Enzyme / biomarker / routine / genetics entry (Section 6.2). Every enzyme and
// biomarker row carries its reference range (Section 3.1a) — a value without one
// cannot be scored, so the form says so in the row and refuses to save.
// Each row reads back what the number means (% of normal, × ULN) as it is typed,
// so the bench sees the interpretation before the doctor does.
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { api } from '../lib/api.js';
import VariantAutocomplete from './VariantAutocomplete.jsx';
import { buildLabsPayload, labsProblems, num, pctOfNormal, serverMessage } from './labsPayload.js';

const ENZYMES = ['GBA', 'alpha_Gal_A', 'GAA', 'IDUA', 'GALC'];
const ASSAYS = ['DBS', 'leukocyte', 'fibroblast'];
const BIOMARKERS = ['lyso_Gb1', 'lyso_Gb3', 'CK', 'urinary_GAG', 'psychosine', 'lyso_SM_509', 'chitotriosidase', 'oxysterols'];
const GENES = ['GBA1', 'GLA', 'GAA', 'IDUA', 'GALC', 'NPC1', 'NPC2', 'SMPD1'];
const ZYG = ['homozygous', 'heterozygous', 'hemizygous', 'compound_heterozygous'];
const CLS = ['pathogenic', 'likely_pathogenic', 'vus', 'likely_benign', 'benign'];

// Bench shorthand → the name a clinician reads.
const NAMES = {
  GBA: 'β-Glucocerebrosidase',
  alpha_Gal_A: 'α-Galactosidase A',
  GAA: 'Acid α-Glucosidase',
  IDUA: 'α-L-Iduronidase',
  GALC: 'Galactocerebrosidase',
  lyso_Gb1: 'Lyso-Gb1',
  lyso_Gb3: 'Lyso-Gb3',
  CK: 'Creatine kinase',
  urinary_GAG: 'Urinary GAG',
  psychosine: 'Psychosine',
  lyso_SM_509: 'Lyso-SM-509',
  chitotriosidase: 'Chitotriosidase',
  oxysterols: 'Oxysterols',
};
const CLS_TONE = { pathogenic: 'danger', likely_pathogenic: 'high', vus: 'warn', likely_benign: 'ok', benign: 'ok' };

const spring = { type: 'spring', stiffness: 420, damping: 34 };
const rowMotion = {
  initial: { opacity: 0, y: -8, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, height: 0, marginTop: 0, marginBottom: 0, transition: { duration: 0.18 } },
  transition: spring,
};

export default function LabsForm({ caseId, initial, onSaved, disabled }) {
  const [enzymes, setEnzymes] = useState(initial?.enzymes ?? []);
  const [biomarkers, setBiomarkers] = useState(initial?.biomarkers ?? []);
  const [routine, setRoutine] = useState(initial?.routine ?? {});
  const [genetics, setGenetics] = useState(initial?.genetics ?? { tested: false, findings: [] });
  const [status, setStatus] = useState(null);

  const setEnz = (i, patch) => setEnzymes((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setBio = (i, patch) => setBiomarkers((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setFinding = (i, patch) => setGenetics((g) => ({ ...g, findings: g.findings.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const dirty = () => setStatus((s) => (s?.kind === 'saved' ? null : s));

  async function save() {
    const bad = labsProblems(enzymes, biomarkers);
    if (bad.length) {
      setStatus({ kind: 'invalid', items: bad });
      return;
    }
    setStatus({ kind: 'saving' });
    const payload = buildLabsPayload({ enzymes, biomarkers, routine, genetics });
    try {
      const { case: updated } = await api.patchLabs(caseId, payload);
      setStatus({ kind: 'saved' });
      onSaved?.(updated);
    } catch (e) {
      setStatus({ kind: 'error', message: serverMessage(e) });
    }
  }

  const count = enzymes.length + biomarkers.length + genetics.findings.length;

  return (
    <div className="space-y-7">
      {/* ── Enzymes ── */}
      <Section
        title="Enzyme activity"
        hint="Residual activity against the assay's own reference interval."
        count={enzymes.length}
        addLabel="Add enzyme"
        onAdd={() => {
          dirty();
          setEnzymes((x) => [...x, { analyte: 'GBA', value: '', unit: 'nmol/h/mL', assay: 'DBS', reference_low: '', reference_high: '' }]);
        }}
        empty="No enzyme assays entered yet."
      >
        <AnimatePresence initial={false}>
          {enzymes.map((e, i) => {
            const pct = pctOfNormal(e);
            const hasRange = num(e.reference_high) != null || num(e.reference_mean) != null;
            return (
              <motion.div key={`enz-${i}`} layout {...rowMotion}>
                <Row
                  title={NAMES[e.analyte] ?? e.analyte}
                  badge={hasRange ? <Readout pct={pct} /> : <Flag>needs reference range</Flag>}
                  onRemove={() => {
                    dirty();
                    setEnzymes((xs) => xs.filter((_, j) => j !== i));
                  }}
                >
                  <Select label="Analyte" value={e.analyte} onChange={(v) => { dirty(); setEnz(i, { analyte: v }); }} options={ENZYMES} render={(o) => NAMES[o] ?? o} />
                  <Field label="Value" value={e.value} onChange={(v) => { dirty(); setEnz(i, { value: v }); }} type="number" />
                  <Field label="Unit" value={e.unit} onChange={(v) => { dirty(); setEnz(i, { unit: v }); }} />
                  <Select label="Assay" value={e.assay} onChange={(v) => { dirty(); setEnz(i, { assay: v }); }} options={ASSAYS} />
                  <Field label="Ref low" value={e.reference_low} onChange={(v) => { dirty(); setEnz(i, { reference_low: v }); }} type="number" />
                  <Field label="Ref high" value={e.reference_high} onChange={(v) => { dirty(); setEnz(i, { reference_high: v }); }} type="number" />
                </Row>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </Section>

      {/* ── Biomarkers ── */}
      <Section
        title="Biomarkers"
        hint="Reported as a multiple of the upper limit of normal."
        count={biomarkers.length}
        addLabel="Add biomarker"
        onAdd={() => {
          dirty();
          setBiomarkers((x) => [...x, { analyte: 'lyso_Gb1', value: '', unit: 'ng/mL', reference_high: '' }]);
        }}
        empty="No biomarkers entered yet."
      >
        <AnimatePresence initial={false}>
          {biomarkers.map((b, i) => {
            const v = num(b.value);
            const uln = num(b.reference_high);
            const fold = v != null && uln ? v / uln : null;
            return (
              <motion.div key={`bio-${i}`} layout {...rowMotion}>
                <Row
                  title={NAMES[b.analyte] ?? b.analyte}
                  badge={uln ? <Fold fold={fold} /> : <Flag>needs ULN</Flag>}
                  onRemove={() => {
                    dirty();
                    setBiomarkers((xs) => xs.filter((_, j) => j !== i));
                  }}
                >
                  <Select label="Analyte" value={b.analyte} onChange={(v2) => { dirty(); setBio(i, { analyte: v2 }); }} options={BIOMARKERS} render={(o) => NAMES[o] ?? o} />
                  <Field label="Value" value={b.value} onChange={(v2) => { dirty(); setBio(i, { value: v2 }); }} type="number" />
                  <Field label="Unit" value={b.unit} onChange={(v2) => { dirty(); setBio(i, { unit: v2 }); }} />
                  <Field label="ULN" value={b.reference_high} onChange={(v2) => { dirty(); setBio(i, { reference_high: v2 }); }} type="number" />
                </Row>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </Section>

      {/* ── Routine bloods ── */}
      <Section title="Routine bloods" hint="Optional supporting counts." noAdd>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Haemoglobin (g/dL)" value={routine.hemoglobin_g_dl ?? ''} onChange={(v) => { dirty(); setRoutine((r) => ({ ...r, hemoglobin_g_dl: v })); }} type="number" grow />
          <Field label="Platelets (10⁹/L)" value={routine.platelets_10e9_l ?? ''} onChange={(v) => { dirty(); setRoutine((r) => ({ ...r, platelets_10e9_l: v })); }} type="number" grow />
          <Field label="CK (U/L)" value={routine.ck_u_l ?? ''} onChange={(v) => { dirty(); setRoutine((r) => ({ ...r, ck_u_l: v })); }} type="number" grow />
        </div>
      </Section>

      {/* ── Genetics ── */}
      <Section
        title="Genetics"
        hint="Variants are matched against ClinVar as you type."
        count={genetics.findings.length}
        addLabel="Add variant"
        onAdd={() => {
          dirty();
          setGenetics((g) => ({ ...g, tested: true, findings: [...g.findings, { gene: 'GBA1', variant: '', zygosity: 'heterozygous', classification: 'vus' }] }));
        }}
        empty="No variants entered. Leave empty if genetics were not tested."
      >
        <AnimatePresence initial={false}>
          {genetics.findings.map((f, i) => (
            <motion.div key={`gen-${i}`} layout {...rowMotion}>
              <Row
                title={f.gene}
                badge={<Tone tone={CLS_TONE[f.classification] ?? 'warn'} caps>{f.classification.replace(/_/g, ' ')}</Tone>}
                onRemove={() => {
                  dirty();
                  setGenetics((g) => ({ ...g, findings: g.findings.filter((_, j) => j !== i) }));
                }}
              >
                <Select label="Gene" value={f.gene} onChange={(v) => { dirty(); setFinding(i, { gene: v, variant: '' }); }} options={GENES} />
                <label className="block min-w-[260px] flex-1">
                  <span className="text-micro font-medium uppercase tracking-wider text-fg-3">Variant (HGVS)</span>
                  <span className="mt-1 block">
                    <VariantAutocomplete
                      gene={f.gene}
                      value={f}
                      onPick={(picked) => { dirty(); setFinding(i, { variant: picked.variant, classification: picked.classification ?? f.classification }); }}
                    />
                  </span>
                </label>
                <Select label="Zygosity" value={f.zygosity} onChange={(v) => { dirty(); setFinding(i, { zygosity: v }); }} options={ZYG} render={(o) => o.replace(/_/g, ' ')} />
                <Select label="Classification" value={f.classification} onChange={(v) => { dirty(); setFinding(i, { classification: v }); }} options={CLS} render={(o) => o.replace(/_/g, ' ')} />
              </Row>
            </motion.div>
          ))}
        </AnimatePresence>
      </Section>

      {/* ── Save bar ── */}
      <div className="sticky bottom-0 -mx-1 border-t border-line bg-surface/90 px-1 py-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1 text-body">
            <AnimatePresence mode="wait">
              {status?.kind === 'saved' && (
                <motion.span key="ok" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1.5 font-medium text-ok-fg">
                  <Tick /> Saved
                </motion.span>
              )}
              {status?.kind === 'error' && (
                <motion.span key="err" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-danger-fg">
                  Could not save: {status.message}
                </motion.span>
              )}
              {status?.kind === 'invalid' && (
                <motion.div
                  key="bad"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-lg border border-warn-line bg-warn-bg px-3.5 py-2.5 text-warn-fg"
                >
                  <p className="font-semibold">Check these before saving</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {status.items.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </motion.div>
              )}
              {!status && (
                <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-fg-3">
                  {count === 0 ? 'Nothing entered yet.' : `${count} result${count === 1 ? '' : 's'} ready to save.`}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <motion.button
            onClick={save}
            disabled={disabled || status?.kind === 'saving'}
            whileTap={{ scale: 0.97 }}
            className="btn-primary shrink-0"
          >
            {status?.kind === 'saving' ? 'Saving…' : 'Save lab results'}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

function Section({ title, hint, children, onAdd, addLabel, noAdd, count, empty }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-body font-semibold text-fg">
            {title}
            {count > 0 && (
              <motion.span
                key={count}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={spring}
                className="rounded-full bg-muted px-2 py-0.5 text-micro font-semibold text-fg-2"
              >
                {count}
              </motion.span>
            )}
          </h3>
          {hint && <p className="mt-0.5 text-label text-fg-3">{hint}</p>}
        </div>
        {!noAdd && (
          <motion.button type="button" onClick={onAdd} whileTap={{ scale: 0.96 }} className="btn-ghost px-3 py-1.5 text-label">
            <span aria-hidden>+</span> {addLabel}
          </motion.button>
        )}
      </div>
      <div className="space-y-2.5">
        {children}
        {empty && count === 0 && (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-label text-fg-3">{empty}</p>
        )}
      </div>
    </section>
  );
}

function Row({ title, badge, children, onRemove }) {
  return (
    <div className="group rounded-xl border border-line bg-surface p-3.5 transition-colors hover:border-line-strong">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-label font-semibold text-fg">{title}</span>
        {badge}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          className="ml-auto rounded-md p-1 text-fg-3 opacity-0 transition-all hover:bg-danger-bg hover:text-danger-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2.5">{children}</div>
    </div>
  );
}

// Residual enzyme activity. Lower is more suspicious, so the tone tracks it.
function Readout({ pct }) {
  if (pct == null) return <span className="text-micro text-fg-3">enter a value</span>;
  const tone = pct < 15 ? 'danger' : pct < 40 ? 'high' : 'ok';
  return (
    <Tone tone={tone} animateKey={Math.round(pct)}>
      {pct.toFixed(0)}% of normal
    </Tone>
  );
}

function Fold({ fold }) {
  if (fold == null) return <span className="text-micro text-fg-3">enter a value</span>;
  const tone = fold > 5 ? 'danger' : fold > 1 ? 'high' : 'ok';
  return (
    <Tone tone={tone} animateKey={fold.toFixed(1)}>
      {fold.toFixed(1)}× ULN
    </Tone>
  );
}

const TONES = {
  ok: 'bg-ok-bg text-ok-fg ring-ok-line',
  warn: 'bg-warn-bg text-warn-fg ring-warn-line',
  high: 'bg-high-bg text-high-fg ring-high-line',
  danger: 'bg-danger-bg text-danger-fg ring-danger-line',
};

function Tone({ tone, children, animateKey, caps }) {
  return (
    <motion.span
      key={animateKey}
      initial={animateKey !== undefined ? { scale: 0.9, opacity: 0.6 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={spring}
      className={`rounded-full px-2 py-0.5 text-micro font-semibold ring-1 ${caps ? 'capitalize' : ''} ${TONES[tone]}`}
    >
      {children}
    </motion.span>
  );
}

const Flag = ({ children }) => <Tone tone="warn">{children}</Tone>;

const Tick = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

function Field({ label, value, onChange, type = 'text', grow }) {
  return (
    <label className={`block ${grow ? 'w-full' : 'w-28'}`}>
      <span className="text-micro font-medium uppercase tracking-wider text-fg-3">{label}</span>
      <input
        type={type}
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1 px-2.5 py-1.5"
      />
    </label>
  );
}

function Select({ label, value, onChange, options, render = (o) => o }) {
  return (
    <label className="block">
      <span className="text-micro font-medium uppercase tracking-wider text-fg-3">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input mt-1 px-2.5 py-1.5 capitalize">
        {options.map((o) => (
          <option key={o} value={o}>{render(o)}</option>
        ))}
      </select>
    </label>
  );
}
