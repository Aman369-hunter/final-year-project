// Section 6.1: one case, from the patient's point of view. Shows the friendly
// status tracker, the symptoms they reported, and — only once the doctor has
// released it after REPORTED — the released note. No scores, ever.
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { PageSkeleton } from '../components/Skeleton.jsx';
import { Card, Empty, PageHeader, itemVariants, listVariants } from '../components/ui.jsx';
import StatusTracker from '../patient/StatusTracker.jsx';
import { isEditable, isComplete } from '../patient/status.js';

const PRESENCE = { true: 'Yes', false: 'No', null: "Don't know" };
const SEVERITY = ['None', 'Mild', 'Moderate', 'Severe'];
const fmt = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

// Reported symptoms read best grouped: what you have, then what you don't.
const ANSWER_STYLE = {
  true: 'bg-accent-bg text-accent-fg ring-accent-line',
  false: 'bg-muted text-fg-3 ring-line',
  null: 'bg-warn-bg text-warn-fg ring-warn-line',
};

export default function PatientCaseView() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getCase(id)
      .then((d) => setC(d.case))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="rounded-xl bg-danger-bg px-4 py-3 text-body text-danger-fg">{error}</p>;
  if (!c) return <PageSkeleton rows={2} />;

  const released = c.release; // { released_at, note } once the doctor releases
  const reported = c.symptoms ?? [];
  const present = reported.filter((s) => s.present === true);
  const others = reported.filter((s) => s.present !== true);

  return (
    <div className="space-y-7">
      <div>
        <Link to="/patient" className="inline-flex items-center gap-1.5 text-label text-accent-fg hover:underline">
          <span aria-hidden>←</span> Back to your checks
        </Link>
        <div className="mt-2">
          <PageHeader eyebrow="Your check" title={c.status_label}>
            {isEditable(c.state) && (
              <Link to={`/patient/cases/${c.id}/questionnaire`} className="btn-accent">
                {c.state === 'DRAFT' ? 'Continue the questionnaire' : 'Resubmit your details'}
              </Link>
            )}
          </PageHeader>
        </div>
      </div>

      <Card title="Progress" subtitle="Where this check has reached.">
        <StatusTracker state={c.state} />
      </Card>

      {isComplete(c.state) && (
        <Card title="Your report">
          {released ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              <p className="text-label text-fg-3">Released {fmt(released.released_at)}</p>
              <div className="mt-2 whitespace-pre-wrap rounded-xl border border-ok-line bg-ok-bg px-5 py-4 text-body leading-relaxed text-ok-fg">
                {released.note || 'Your doctor has released your results. Please contact the clinic to discuss them.'}
              </div>
            </motion.div>
          ) : (
            <Empty hint="Your doctor decides when to share it with you.">
              Your doctor has finished the review. Your report will appear here once they release it.
            </Empty>
          )}
        </Card>
      )}

      <Card title="What you told us" subtitle="The symptoms you reported for this check.">
        {reported.length === 0 ? (
          <Empty>No symptoms recorded yet.</Empty>
        ) : (
          <div className="space-y-5">
            {present.length > 0 && (
              <div>
                <p className="section-title">Symptoms you reported</p>
                <motion.ul variants={listVariants} initial="hidden" animate="show" className="mt-2.5 space-y-2">
                  {present.map((s) => (
                    <motion.li
                      key={s.hpo_id}
                      variants={itemVariants}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-subtle/60 px-4 py-3"
                    >
                      <span className="text-body text-fg">{s.label}</span>
                      <span className="flex items-center gap-2">
                        {s.severity > 0 && (
                          <span className="rounded-full bg-accent-bg px-2.5 py-0.5 text-micro font-semibold text-accent-fg ring-1 ring-accent-line">
                            {SEVERITY[s.severity]}
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-0.5 text-micro font-semibold ring-1 ${ANSWER_STYLE.true}`}>Yes</span>
                      </span>
                    </motion.li>
                  ))}
                </motion.ul>
              </div>
            )}

            {others.length > 0 && (
              <div>
                <p className="section-title">Everything else you answered</p>
                <motion.ul variants={listVariants} initial="hidden" animate="show" className="mt-2.5 divide-y divide-line">
                  {others.map((s) => (
                    <motion.li key={s.hpo_id} variants={itemVariants} className="flex items-center justify-between gap-4 py-2.5">
                      <span className="text-body text-fg-2">{s.label}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-micro font-semibold ring-1 ${ANSWER_STYLE[String(s.present)]}`}>
                        {PRESENCE[String(s.present)]}
                      </span>
                    </motion.li>
                  ))}
                </motion.ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <p className="px-1 text-label text-fg-3">
        This check captures your symptoms for screening. It is not a diagnosis. Your doctor will explain what your
        results mean.
      </p>
    </div>
  );
}
