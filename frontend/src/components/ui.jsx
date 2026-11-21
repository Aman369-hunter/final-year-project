// Small shared building blocks. One visual language across the three dashboards:
// the same page header, card, badge and empty state everywhere, so a clinician
// moving between them is never re-learning the furniture.
import { motion } from 'framer-motion';
import { BAND_STYLE } from '../lib/risk.js';

export const spring = { type: 'spring', stiffness: 420, damping: 36 };

// Staggered list entry. Parent gets `listVariants`, each child `itemVariants`.
export const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.03 } },
};
export const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export function PageHeader({ title, subtitle, children, eyebrow }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-wrap items-end justify-between gap-4"
    >
      <div>
        {eyebrow && <p className="section-title">{eyebrow}</p>}
        <h1 className="mt-1 text-display text-fg">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-body text-fg-3">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2.5">{children}</div>}
    </motion.header>
  );
}

export function Card({ title, subtitle, children, className = '', right }) {
  return (
    <section className={`card p-6 ${className}`}>
      {(title || right) && (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-body font-semibold text-fg">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-label text-fg-3">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

// A number worth reading at a glance, above a worklist.
export function StatTile({ label, value, tone = 'neutral', hint }) {
  const tones = {
    neutral: 'text-fg',
    ok: 'text-ok-fg',
    warn: 'text-warn-fg',
    high: 'text-high-fg',
    danger: 'text-danger-fg',
  };
  return (
    <motion.div variants={itemVariants} className="card px-5 py-4">
      <p className="section-title">{label}</p>
      <p className={`mt-1.5 text-metric tabular-nums leading-none ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1.5 text-label text-fg-3">{hint}</p>}
    </motion.div>
  );
}

export function BandBadge({ band, size = 'sm' }) {
  const s = BAND_STYLE[band];
  if (!s) return null;
  const pad = size === 'lg' ? 'px-3 py-1 text-body' : 'px-2.5 py-0.5 text-label';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${s.soft} ${pad}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} aria-hidden />
      {band}
    </span>
  );
}

const STATE_STYLE = {
  DRAFT: 'bg-muted text-fg-2 ring-line-strong/30',
  SUBMITTED: 'bg-accent-bg text-accent-fg ring-accent-solid/30',
  LAB_PENDING: 'bg-muted text-fg-2 ring-line-strong/30',
  LAB_REJECTED: 'bg-danger-bg text-danger-fg ring-danger-solid/30',
  DOCTOR_REVIEW: 'bg-accent-bg text-accent-fg ring-accent-solid/30',
  REPORTED: 'bg-ok-bg text-ok-fg ring-ok-solid/30',
  REFERRED: 'bg-refer-bg text-refer-fg ring-refer-solid/30',
};

// Staff-facing: the state machine's own name, so it matches the audit trail.
export function StateBadge({ state }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 font-mono text-micro font-medium ring-1 ring-inset ${STATE_STYLE[state] ?? STATE_STYLE.LAB_PENDING}`}>
      {state}
    </span>
  );
}

// An empty state says what is missing and, where there is one, what to do about it.
export function Empty({ children, hint }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-8 text-center">
      <p className="text-body text-fg-2">{children}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-label text-fg-3">{hint}</p>}
    </div>
  );
}

// Section 6.4 rule 1: visible text, never a tooltip.
export function Disclaimer({ text }) {
  return (
    <div role="note" className="flex gap-3 rounded-xl border border-warn-line bg-warn-bg px-4 py-3 text-label text-warn-fg">
      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" />
      </svg>
      <p>
        <span className="font-semibold">Medical disclaimer: </span>
        {text}
      </p>
    </div>
  );
}

export function sexLabel(sex) {
  return { male: 'Male', female: 'Female', other: 'Other' }[sex] ?? '—';
}
