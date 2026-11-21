// Clinician worklist (Section 6.3): cases awaiting a decision, highest screening
// band first, each row carrying the leading result and what the engine was
// missing when it scored. The disclaimer is visible text, never a tooltip.
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { BandBadge, Card, Disclaimer, Empty, PageHeader, StatTile, StateBadge, itemVariants, listVariants, sexLabel } from '../components/ui.jsx';
import { PageSkeleton } from '../components/Skeleton.jsx';
import { useDoctorData, worklist } from '../data/doctorStore.js';
import { MISSING_INPUT_LABELS, pct, topPrediction } from '../lib/risk.js';

const DISCLAIMER =
  'This output is a screening aid, not a diagnosis. All results must be reviewed by a qualified clinician and confirmed by laboratory testing.';

function waited(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60_000);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export default function DoctorWorklist() {
  const { cases: all, status, error, reload } = useDoctorData();
  const queue = worklist(all);
  const decided = all.filter((c) => c.state !== 'DOCTOR_REVIEW');

  if (status === 'idle' || status === 'loading') return <PageSkeleton rows={3} />;
  if (status === 'error') return <Empty hint="Check the backend is running, then refresh.">Could not load the worklist: {error}</Empty>;

  const band = (b) => queue.filter((c) => c.assessment.response.risk_level === b).length;
  const urgent = band('CRITICAL') + band('HIGH');
  const incomplete = queue.filter((c) => c.assessment.response.confidence.missing_inputs.length).length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Clinical review"
        title="Review worklist"
        subtitle="Cases awaiting your decision, highest screening band first."
      >
        <button onClick={reload} className="btn-ghost px-3.5 py-2 text-label">Refresh</button>
      </PageHeader>

      <Disclaimer text={DISCLAIMER} />

      <motion.div variants={listVariants} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Awaiting review" value={queue.length} hint="Scored and queued" />
        <StatTile label="High or critical" value={urgent} tone={urgent ? 'high' : 'ok'} hint="Look at these first" />
        <StatTile label="Incomplete inputs" value={incomplete} tone={incomplete ? 'warn' : 'ok'} hint="Scored with gaps" />
      </motion.div>

      <Card title={`Awaiting review (${queue.length})`}>
        {queue.length === 0 ? (
          <Empty hint="Cases arrive here once the laboratory submits their results.">Nothing waiting on you.</Empty>
        ) : (
          <motion.ul variants={listVariants} initial="hidden" animate="show" className="space-y-2.5">
            {queue.map((c) => {
              const r = c.assessment.response;
              const top = topPrediction(r);
              const missing = r.confidence.missing_inputs;
              return (
                <motion.li key={c.id} variants={itemVariants}>
                  <Link to={`/doctor/cases/${c.id}`} className="card-interactive block px-5 py-4">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                      <BandBadge band={r.risk_level} />

                      <div className="min-w-[9rem]">
                        <p className="text-body font-medium text-fg">{c.patient.name}</p>
                        <p className="mt-0.5 text-label text-fg-3">
                          {c.patient.age_years} y · {sexLabel(c.patient.sex)}
                        </p>
                      </div>

                      <div className="min-w-[14rem] flex-1">
                        <p className="text-body text-fg-2">
                          {top.display_name}{' '}
                          <span className="font-semibold tabular-nums text-fg">{pct(top.absolute_risk)}</span>
                        </p>
                        {/* The leading probability, drawn so the queue is scannable. */}
                        <div className="mt-1.5 h-1.5 w-full max-w-[13rem] overflow-hidden rounded-full bg-muted" aria-hidden>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, top.absolute_risk * 100)}%` }}
                            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                            className="h-full rounded-full"
                            style={{ background: 'rgb(var(--accent-solid))' }}
                          />
                        </div>
                      </div>

                      <div className="min-w-[8rem] text-label">
                        {missing.length ? (
                          <span className="font-medium text-warn-fg">
                            {missing.map((m) => MISSING_INPUT_LABELS[m] ?? m).join(', ')}
                          </span>
                        ) : (
                          <span className="text-fg-3">All inputs present</span>
                        )}
                      </div>

                      <span className="w-20 text-right text-label tabular-nums text-fg-3">{waited(c.created_at)}</span>
                      <span className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-label font-medium text-on-primary">Review</span>
                    </div>
                  </Link>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </Card>

      {decided.length > 0 && (
        <Card title="Decided this session">
          <motion.ul variants={listVariants} initial="hidden" animate="show" className="divide-y divide-line">
            {decided.map((c) => (
              <motion.li key={c.id} variants={itemVariants} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="text-body text-fg-2">{c.patient.name}</span>
                <span className="flex items-center gap-3">
                  <StateBadge state={c.state} />
                  {c.release && <span className="text-label text-ok-fg">Released to patient</span>}
                  <Link to={`/doctor/cases/${c.id}`} className="text-label font-medium text-accent-fg hover:underline">Open</Link>
                </span>
              </motion.li>
            ))}
          </motion.ul>
        </Card>
      )}
    </div>
  );
}
