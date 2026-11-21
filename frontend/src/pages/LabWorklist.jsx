// Lab worklist (Section 6.2): cases in SUBMITTED (claimable) and the ones this
// lab has in progress. No predictions anywhere — the lab never sees scores, and
// a patient is identified by age, sex and case id only.
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { PageSkeleton } from '../components/Skeleton.jsx';
import { shortId } from '../lib/ids.js';
import { Card, Empty, PageHeader, StatTile, StateBadge, itemVariants, listVariants, sexLabel } from '../components/ui.jsx';

function ageWait(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}
// Anything sitting more than four hours is worth the eye going to it first.
const isOverdue = (iso) => Date.now() - new Date(iso) > 4 * 3600 * 1000;

export default function LabWorklist() {
  const [state, setState] = useState({ status: 'loading' });

  async function load() {
    setState((s) => (s.status === 'ok' ? s : { status: 'loading' }));
    try {
      const [submitted, pending, rejected] = await Promise.all([
        api.listCases('?state=SUBMITTED'),
        api.listCases('?state=LAB_PENDING'),
        api.listCases('?state=LAB_REJECTED'),
      ]);
      setState({ status: 'ok', submitted: submitted.items, pending: pending.items, rejected: rejected.items });
    } catch (e) {
      setState({ status: 'error', message: e.message });
    }
  }

  useEffect(() => {
    load();
    // Patients submit from another tab. Without this the lab would sit on a list
    // fetched once at mount and never see the new case. Throttled so flicking
    // between tabs doesn't hammer the API.
    let lastAt = Date.now();
    const refetch = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastAt < 3000) return;
      lastAt = Date.now();
      load();
    };
    document.addEventListener('visibilitychange', refetch);
    window.addEventListener('focus', refetch);
    return () => {
      document.removeEventListener('visibilitychange', refetch);
      window.removeEventListener('focus', refetch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'loading') return <PageSkeleton rows={2} />;
  if (state.status === 'error') return <Empty>Could not load the worklist: {state.message}</Empty>;

  const waiting = state.submitted.length;
  const overdue = [...state.submitted, ...state.pending].filter((c) => isOverdue(c.created_at)).length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Laboratory"
        title="Bench worklist"
        subtitle="Claim a case, capture device vitals, then enter assay results against their reference ranges."
      >
        <button onClick={load} className="btn-ghost px-3.5 py-2 text-label">Refresh</button>
      </PageHeader>

      <motion.div variants={listVariants} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Awaiting claim" value={waiting} tone={waiting ? 'warn' : 'ok'} hint={waiting ? 'Ready to start' : 'Nothing queued'} />
        <StatTile label="In progress" value={state.pending.length} hint="Claimed by this lab" />
        <StatTile label="Waiting over 4 h" value={overdue} tone={overdue ? 'high' : 'ok'} hint="Across both queues" />
      </motion.div>

      <WorkList title="Awaiting the lab" rows={state.submitted} empty="No new cases to claim." hint="New cases appear here as soon as a patient submits." cta="Claim & capture" primary />
      {state.pending.length > 0 && <WorkList title="In progress" rows={state.pending} cta="Continue" />}
      {state.rejected.length > 0 && <WorkList title="Returned for recollection" rows={state.rejected} cta="View" />}
    </div>
  );
}

function WorkList({ title, rows, empty, hint, cta, primary }) {
  return (
    <Card title={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <Empty hint={hint}>{empty}</Empty>
      ) : (
        <motion.ul variants={listVariants} initial="hidden" animate="show" className="space-y-2.5">
          {rows.map((c) => {
            const late = isOverdue(c.created_at);
            return (
              <motion.li key={c.id} variants={itemVariants}>
                <Link to={`/lab/cases/${c.id}`} className="card-interactive flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-fg">
                      {c.patient?.age_years} y · {sexLabel(c.patient?.sex)}
                    </p>
                    <p className="mt-0.5 font-mono text-micro text-fg-3">case {shortId(c.id)}</p>
                  </div>
                  <StateBadge state={c.state} />
                  <span className={`w-24 text-right text-label tabular-nums ${late ? 'font-semibold text-high-fg' : 'text-fg-3'}`}>
                    {ageWait(c.created_at)}
                  </span>
                  <span
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-label font-medium ${
                      primary ? 'bg-primary text-on-primary' : 'text-fg-2 ring-1 ring-line-strong'
                    }`}
                  >
                    {cta}
                  </span>
                </Link>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </Card>
  );
}
