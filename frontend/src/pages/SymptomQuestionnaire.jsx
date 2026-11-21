// Section 6.1 symptom questionnaire. Plain-language labels only — HPO ids are
// carried behind the scenes and never shown. Questions are grouped by body
// system. For each: present / absent / don't-know, and a 0–3 severity choice
// shown only when the symptom is present. Saves to the case's symptoms, and
// submits it (DRAFT/LAB_REJECTED → SUBMITTED) when the patient is done.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { PageSkeleton } from '../components/Skeleton.jsx';
import { Card, PageHeader, itemVariants, listVariants } from '../components/ui.jsx';
import { isEditable } from '../patient/status.js';

const SEVERITY = ['None', 'Mild', 'Moderate', 'Severe'];
const spring = { type: 'spring', stiffness: 460, damping: 38 };

function initialAnswers(catalog, existing) {
  const byId = new Map((existing ?? []).map((s) => [s.hpo_id, s]));
  const answers = {};
  for (const g of catalog.groups) {
    for (const s of g.symptoms) {
      const prev = byId.get(s.hpo_id);
      answers[s.hpo_id] = {
        present: prev ? prev.present : undefined, // undefined = not answered yet
        severity: prev?.severity ?? 1,
      };
    }
  }
  return answers;
}

// One segmented control for both questions, so the page has a single rhythm.
function Segmented({ options, value, onChange, name, tone = 'accent' }) {
  const tones = {
    accent: 'bg-accent-solid text-on-primary',
    primary: 'bg-primary text-on-primary',
  };
  return (
    <div className="inline-flex gap-1 rounded-xl bg-muted p-1" role="radiogroup">
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={`relative rounded-lg px-3 py-1.5 text-label font-medium transition-colors ${
              on ? 'text-on-primary' : 'text-fg-3 hover:text-fg-2'
            }`}
          >
            {on && (
              <motion.span
                layoutId={`${name}-pill`}
                transition={spring}
                className={`absolute inset-0 rounded-lg ${tones[o.tone ?? tone]}`}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const PRESENCE = [
  { v: true, label: 'Yes' },
  { v: false, label: 'No', tone: 'primary' },
  { v: null, label: "Don't know", tone: 'primary' },
];

function SymptomItem({ symptom, answer, onChange }) {
  const answered = answer?.present !== undefined;
  const present = answer?.present === true;
  return (
    <motion.div
      variants={itemVariants}
      className={`rounded-xl border px-4 py-3.5 transition-colors ${
        answered ? 'border-line bg-subtle/60' : 'border-line bg-surface'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-fg">{symptom.label}</p>
          {symptom.hint && <p className="mt-0.5 text-label text-fg-3">{symptom.hint}</p>}
        </div>
        <Segmented
          name={symptom.hpo_id}
          options={PRESENCE}
          value={answer?.present}
          onChange={(present) => onChange({ ...answer, present })}
        />
      </div>

      <AnimatePresence initial={false}>
        {present && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-3.5 flex flex-wrap items-center gap-3 border-t border-line pt-3.5">
              <span className="text-label text-fg-2">How bad is it?</span>
              <Segmented
                name={`${symptom.hpo_id}-sev`}
                options={SEVERITY.map((label, v) => ({ v, label }))}
                value={answer.severity}
                onChange={(severity) => onChange({ ...answer, severity })}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function SymptomQuestionnaire() {
  const { id } = useParams();
  const nav = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [caseState, setCaseState] = useState(null);
  const [answers, setAnswers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.symptomCatalog(), api.getCase(id)])
      .then(([cat, { case: c }]) => {
        setCatalog(cat);
        setCaseState(c.state);
        setAnswers(initialAnswers(cat, c.symptoms));
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const total = useMemo(
    () => (catalog ? catalog.groups.reduce((n, g) => n + g.symptoms.length, 0) : 0),
    [catalog],
  );
  const answeredCount = useMemo(
    () => (answers ? Object.values(answers).filter((a) => a.present !== undefined).length : 0),
    [answers],
  );
  const groupAnswered = (g) => g.symptoms.filter((s) => answers[s.hpo_id]?.present !== undefined).length;

  // Only answered symptoms are sent. present:false and null are meaningful
  // (absent / don't-know), so they are kept; unanswered ones are dropped.
  function collectSymptoms() {
    const out = [];
    for (const g of catalog.groups) {
      for (const s of g.symptoms) {
        const a = answers[s.hpo_id];
        if (a.present === undefined) continue;
        out.push({ hpo_id: s.hpo_id, label: s.label, present: a.present, severity: a.present === true ? a.severity : 0 });
      }
    }
    return out;
  }

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      nav(`/patient/cases/${id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  const save = () => run(() => api.patchSymptoms(id, collectSymptoms()));
  const submit = () =>
    run(async () => {
      await api.patchSymptoms(id, collectSymptoms());
      await api.transition(id, 'SUBMITTED');
    });

  if (error && !catalog) return <p className="rounded-xl bg-danger-bg px-4 py-3 text-body text-danger-fg">{error}</p>;
  if (!catalog || !answers) return <PageSkeleton rows={2} />;
  if (!isEditable(caseState)) {
    return (
      <Card title="This check can no longer be edited">
        <p className="text-body text-fg-2">
          Your answers have already been submitted.{' '}
          <button className="font-medium text-accent-fg underline" onClick={() => nav(`/patient/cases/${id}`)}>
            View progress
          </button>
        </p>
      </Card>
    );
  }

  const progress = total ? (answeredCount / total) * 100 : 0;

  return (
    <div className="space-y-6 pb-4">
      <PageHeader
        eyebrow="Step 1 of 1"
        title="Your symptoms"
        subtitle="For each one, tell us whether you have noticed it. There are no right or wrong answers — choose “Don’t know” if you are unsure, and you can save and come back any time."
      />

      {/* Progress rides along the top so the length of the form never feels open-ended. */}
      <div className="sticky top-16 z-30 rounded-xl border border-line bg-surface/90 px-5 py-3.5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-4 text-label">
          <span className="font-medium text-fg">
            {answeredCount} of {total} answered
          </span>
          <span className="tabular-nums text-fg-3">{Math.round(progress)}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 220, damping: 30 }}
            className="h-full rounded-full bg-accent-solid"
          />
        </div>
      </div>

      {catalog.groups.map((g) => {
        const done = groupAnswered(g);
        const complete = done === g.symptoms.length;
        return (
          <Card
            key={g.system}
            title={g.system}
            right={
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-micro font-semibold ring-1 ${
                  complete ? 'bg-ok-bg text-ok-fg ring-ok-line' : 'bg-muted text-fg-3 ring-line'
                }`}
              >
                {complete && (
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
                {done}/{g.symptoms.length}
              </span>
            }
          >
            <motion.div variants={listVariants} initial="hidden" animate="show" className="space-y-2.5">
              {g.symptoms.map((s) => (
                <SymptomItem
                  key={s.hpo_id}
                  symptom={s}
                  answer={answers[s.hpo_id]}
                  onChange={(a) => setAnswers((prev) => ({ ...prev, [s.hpo_id]: a }))}
                />
              ))}
            </motion.div>
          </Card>
        );
      })}

      {error && <p className="rounded-xl bg-danger-bg px-4 py-3 text-body text-danger-fg">{error}</p>}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/90 px-5 py-4 shadow-pop backdrop-blur-md">
        <p className="max-w-md text-label text-fg-3">
          Submitting sends your answers to the laboratory. You will not be able to change them afterwards.
        </p>
        <div className="flex gap-2.5">
          <button onClick={save} disabled={busy} className="btn-ghost">Save for later</button>
          <motion.button onClick={submit} disabled={busy || answeredCount === 0} whileTap={{ scale: 0.97 }} className="btn-accent">
            {busy ? 'Working…' : 'Submit to the lab'}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
