// Section 6.3 case detail: the whole decision surface on one screen. The top of
// the page answers "what is this and what do I do", and everything below it is
// the evidence for that answer, in the order a clinician would ask for it.
import { motion } from 'framer-motion';
import { Link, useParams } from 'react-router-dom';
import CaseActions from '../components/CaseActions.jsx';
import CategoryRadar from '../components/CategoryRadar.jsx';
import ConfidencePanel from '../components/ConfidencePanel.jsx';
import DifferentialCards from '../components/DifferentialCards.jsx';
import DiseaseBarChart from '../components/DiseaseBarChart.jsx';
import FactorTable from '../components/FactorTable.jsx';
import { LabValuesPanel, SymptomsPanel } from '../components/PatientInputs.jsx';
import PunnettSquare from '../components/PunnettSquare.jsx';
import { ConfirmatoryTests, TreatmentPathways } from '../components/Recommendations.jsx';
import RiskGauge from '../components/RiskGauge.jsx';
import { BandBadge, Card, Disclaimer, Empty, StateBadge, itemVariants, listVariants, sexLabel } from '../components/ui.jsx';
import { PageSkeleton } from '../components/Skeleton.jsx';
import { useDoctorData } from '../data/doctorStore.js';
import { BAND_STYLE, MISSING_INPUT_LABELS, pct, topPrediction } from '../lib/risk.js';

const Section = ({ title, children }) => (
  <section>
    <h2 className="section-title mb-2.5">{title}</h2>
    {children}
  </section>
);

const NotFound = ({ children }) => (
  <div className="space-y-4">
    <Empty>{children}</Empty>
    <Link to="/doctor" className="text-label text-accent-fg hover:underline">← Back to worklist</Link>
  </div>
);

export default function DoctorCaseDetail() {
  const { id } = useParams();
  const { cases, status, error } = useDoctorData();
  const c = cases.find((x) => x.id === id);

  if (!c && (status === 'idle' || status === 'loading')) return <PageSkeleton rows={3} />;
  if (!c && status === 'error') return <NotFound>Could not load the case: {error}</NotFound>;
  if (!c) return <NotFound>Case not found.</NotFound>;

  const r = c.assessment.response;
  const top = topPrediction(r);
  const p = c.patient;
  const lastNote = [...c.history].reverse().find((h) => h.reason)?.reason;
  const missing = r.confidence.missing_inputs;

  return (
    <motion.div variants={listVariants} initial="hidden" animate="show" className="space-y-7">
      <Link to="/doctor" className="inline-flex items-center gap-1.5 text-label text-accent-fg hover:underline">
        <span aria-hidden>←</span> Back to worklist
      </Link>

      {/* Decision header: who, what the engine says, and the actions — before any detail. */}
      <motion.header variants={itemVariants} className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-5 p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-display text-fg">{p.name}</h1>
              <StateBadge state={c.state} />
            </div>
            <p className="mt-1 text-body text-fg-3">
              {p.age_years} y · {sexLabel(p.sex)}
              {p.family_history?.affected_relative ? ` · affected ${p.family_history.relationship ?? 'relative'}` : ''}
              {p.consanguinity ? ' · consanguineous parents' : ''}
            </p>
            {/* Parent names: how two same-named patients are told apart. Doctor only. */}
            {(p.father_name || p.mother_name) && (
              <p className="mt-0.5 text-label text-fg-3">
                {[p.father_name && `F/O ${p.father_name}`, p.mother_name && `M/O ${p.mother_name}`].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className="mt-1.5 font-mono text-micro text-fg-3">case {c.id}</p>
          </div>
          <CaseActions c={c} />
        </div>

        {/* The headline the whole page exists to support. */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-line bg-subtle/60 px-6 py-5">
          <BandBadge band={r.risk_level} size="lg" />
          <div className="min-w-[16rem] flex-1">
            <p className="text-body text-fg-2">
              Top-ranked: <span className="font-semibold text-fg">{top.display_name}</span>
            </p>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted" aria-hidden>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, top.absolute_risk * 100)}%` }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full"
                  style={{ background: BAND_STYLE[r.risk_level].color }}
                />
              </div>
              <span className="text-body font-semibold tabular-nums text-fg">{pct(top.absolute_risk)}</span>
            </div>
          </div>
          <div className="text-label">
            <p className="section-title">Inputs</p>
            <p className={`mt-1 font-medium ${missing.length ? 'text-warn-fg' : 'text-ok-fg'}`}>
              {missing.length ? missing.map((m) => MISSING_INPUT_LABELS[m] ?? m).join(', ') : 'All present'}
            </p>
          </div>
        </div>
      </motion.header>

      {c.state !== 'DOCTOR_REVIEW' && (
        <motion.p variants={itemVariants} className="rounded-xl border border-line bg-muted px-4 py-3 text-body text-fg-2">
          This case is now <strong>{c.state}</strong>
          {c.release ? ' and results have been released to the patient' : ''}.
          {lastNote ? ` Note: “${lastNote}”` : ''}
        </motion.p>
      )}

      <motion.div variants={itemVariants}>
        <Disclaimer text={r.disclaimer} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <Section title="Screening result">
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Overall screening risk" subtitle="Top-ranked disease, absolute risk">
              <RiskGauge value={top.absolute_risk} band={r.risk_level} diseaseName={top.display_name} />
            </Card>
            <Card className="lg:col-span-2" title="Screening risk by disease" subtitle="All six diseases, by absolute risk">
              <DiseaseBarChart predictions={r.predictions} />
            </Card>
          </div>
        </Section>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Section title="Top 3 differentials">
          <DifferentialCards response={r} />
        </Section>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Section title="How the score was reached">
          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Confidence" subtitle="How complete the inputs were">
              <ConfidencePanel confidence={r.confidence} />
            </Card>
            <Card title="Evidence by category" subtitle={`Points for ${top.display_name} (${pct(top.absolute_risk)} screening risk)`}>
              <CategoryRadar scores={r.category_scores} color={BAND_STYLE[r.risk_level].color} />
            </Card>
            <Card title="Inheritance" subtitle="Offspring risk for the reported parental genotypes">
              <PunnettSquare inheritance={r.inheritance} />
            </Card>
          </div>
        </Section>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card title="Contributing factors" subtitle="Every scoring rule that fired, with its points and source">
          <FactorTable factors={r.factors} predictions={r.predictions} />
        </Card>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Section title="What to do next">
          <div className="grid gap-5 lg:grid-cols-2">
            <ConfirmatoryTests recommendations={r.recommendations} />
            <TreatmentPathways recommendations={r.recommendations} />
          </div>
        </Section>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Section title="Source data">
          <div className="grid gap-5 lg:grid-cols-2">
            <SymptomsPanel symptoms={c.symptoms} />
            <LabValuesPanel labs={c.labs} vitals={c.vitals} />
          </div>
        </Section>
      </motion.div>

      <footer className="space-y-3 border-t border-line pt-5">
        <Disclaimer text={r.disclaimer} />
        <p className="font-mono text-micro text-fg-3">
          Engine {r.model.engine_version} ({r.model.mode}) · weights {r.model.weights_version} · request {r.request_id} ·
          scored {new Date(r.generated_at).toLocaleString()}
        </p>
      </footer>
    </motion.div>
  );
}
