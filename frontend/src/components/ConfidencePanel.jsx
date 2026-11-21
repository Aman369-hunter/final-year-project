// Section 6.4 rule 4: when inputs are missing, say so prominently.
import { MISSING_INPUT_LABELS } from '../lib/risk.js';

const LEVEL_STYLE = {
  high: 'bg-ok-bg text-ok-fg ring-ok-solid/30',
  moderate: 'bg-warn-bg text-warn-fg ring-warn-solid/30',
  low: 'bg-danger-bg text-danger-fg ring-danger-solid/30',
};

export default function ConfidencePanel({ confidence }) {
  const missing = confidence.missing_inputs ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-fg-2">Confidence</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ring-1 ring-inset ${LEVEL_STYLE[confidence.level] ?? LEVEL_STYLE.moderate}`}>
          {confidence.level}
        </span>
      </div>
      {missing.length > 0 ? (
        <div className="rounded-lg border-2 border-warn-solid bg-warn-bg p-3">
          <p className="text-sm font-semibold text-warn-fg">
            {missing.length} input {missing.length === 1 ? 'category is' : 'categories are'} missing
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((m) => (
              <li key={m} className="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-warn-fg ring-1 ring-warn-line">
                {MISSING_INPUT_LABELS[m] ?? m}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok-fg">All input categories were supplied.</p>
      )}
      <p className="text-sm text-fg-2">{confidence.note}</p>
    </div>
  );
}
