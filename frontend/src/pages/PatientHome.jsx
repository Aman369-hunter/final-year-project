// Section 6.1 patient dashboard home. Lists the patient's cases in friendly
// words, lets them start a new symptom check, and surfaces released reports.
// Contains no risk score, gauge, chart or probability of any kind.
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ListSkeleton } from '../components/Skeleton.jsx';
import { Card, Empty, PageHeader, itemVariants, listVariants } from '../components/ui.jsx';
import { isEditable, isComplete } from '../patient/status.js';

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

// Where this check has reached, in the patient's own terms. Five stops, no scores.
const STEPS = ['DRAFT', 'SUBMITTED', 'LAB_PENDING', 'DOCTOR_REVIEW', 'REPORTED'];
const stepIndex = (state) => {
  if (state === 'REFERRED' || state === 'REPORTED') return 4;
  if (state === 'LAB_REJECTED') return 1;
  const i = STEPS.indexOf(state);
  return i < 0 ? 0 : i;
};

function Progress({ state }) {
  const at = stepIndex(state);
  return (
    <div className="mt-2.5 flex items-center gap-1" aria-hidden>
      {STEPS.map((s, i) => (
        <motion.span
          key={s}
          initial={{ scaleX: 0, originX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.4, delay: i * 0.05, ease: 'easeOut' }}
          className={`h-1 flex-1 rounded-full ${i <= at ? 'bg-accent-solid' : 'bg-muted'}`}
        />
      ))}
    </div>
  );
}

function CaseRow({ c }) {
  const editable = isEditable(c.state);
  const action = editable ? 'Continue' : isComplete(c.state) ? 'View report' : 'View progress';
  return (
    <motion.li variants={itemVariants}>
      <Link
        to={`/patient/cases/${c.id}`}
        className="card-interactive block px-5 py-4 focus-visible:outline-none"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-body font-medium text-fg">{c.status_label}</p>
            <p className="mt-0.5 text-label text-fg-3">
              Started {fmtDate(c.created_at)} · updated {fmtDate(c.updated_at)}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-lg px-3 py-1.5 text-label font-medium transition-colors ${
              editable ? 'bg-accent-solid text-on-primary' : 'text-accent-fg ring-1 ring-accent-line'
            }`}
          >
            {action}
          </span>
        </div>
        <Progress state={c.state} />
      </Link>
    </motion.li>
  );
}

export default function PatientHome() {
  const [cases, setCases] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    api
      .listCases()
      .then((d) => setCases(d.items))
      .catch((e) => setError(e.message));
  }, []);

  async function startNew() {
    setCreating(true);
    setError(null);
    try {
      const { case: c } = await api.createCase();
      nav(`/patient/cases/${c.id}/questionnaire`);
    } catch (e) {
      setError(e.message);
      setCreating(false);
    }
  }

  const open = cases?.filter((c) => !isComplete(c.state)) ?? [];
  const done = cases?.filter((c) => isComplete(c.state)) ?? [];
  const needsAttention = open.filter((c) => isEditable(c.state));

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Your care"
        title="Your health checks"
        subtitle="Follow each check from your answers through the laboratory to your doctor’s review."
      >
        <motion.button onClick={startNew} disabled={creating} whileTap={{ scale: 0.97 }} className="btn-accent">
          {creating ? 'Starting…' : 'Start a new check'}
        </motion.button>
      </PageHeader>

      {error && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-danger-bg px-4 py-3 text-body text-danger-fg">
          {error}
        </motion.p>
      )}

      {needsAttention.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-xl border border-accent-line bg-accent-bg px-4 py-3 text-body text-accent-fg"
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-solid opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-solid" />
          </span>
          {needsAttention.length} check{needsAttention.length > 1 ? 's are' : ' is'} waiting for you to finish and submit.
        </motion.div>
      )}

      <Card title="In progress" subtitle="Checks that are still moving through the system.">
        {cases === null ? (
          <ListSkeleton rows={2} />
        ) : open.length === 0 ? (
          <Empty hint="Choose “Start a new check” above to answer a short symptom questionnaire.">No checks in progress.</Empty>
        ) : (
          <motion.ul variants={listVariants} initial="hidden" animate="show" className="space-y-2.5">
            {open.map((c) => (
              <CaseRow key={c.id} c={c} />
            ))}
          </motion.ul>
        )}
      </Card>

      <Card title="Completed reports" subtitle="Reports appear here once your doctor has released them.">
        {done.length === 0 ? (
          <Empty hint="Reports appear here after a doctor completes a review and chooses to share it with you.">No reports yet.</Empty>
        ) : (
          <motion.ul variants={listVariants} initial="hidden" animate="show" className="space-y-2.5">
            {done.map((c) => (
              <CaseRow key={c.id} c={c} />
            ))}
          </motion.ul>
        )}
      </Card>
    </div>
  );
}
