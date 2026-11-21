import { Card, Empty } from './ui.jsx';

const PRIORITY = {
  high: 'bg-danger-bg text-danger-fg ring-danger-solid/30',
  medium: 'bg-warn-bg text-warn-fg ring-warn-solid/30',
  low: 'bg-muted text-fg-2 ring-line-strong/30',
};

export function ConfirmatoryTests({ recommendations }) {
  const tests = recommendations.confirmatory_tests ?? [];
  return (
    <Card title="Confirmatory tests" subtitle="Recommended before any diagnosis is made">
      {tests.length === 0 ? (
        <Empty>No confirmatory tests suggested at this screening result.</Empty>
      ) : (
        <ol className="space-y-3">
          {tests.map((t) => (
            <li key={t.test} className="flex gap-3">
              <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${PRIORITY[t.priority] ?? PRIORITY.low}`}>
                {t.priority}
              </span>
              <div>
                <div className="text-sm font-medium text-fg">{t.test}</div>
                <div className="text-sm text-fg-2">{t.rationale}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {recommendations.referral && (
        <p className="mt-4 border-t border-line pt-3 text-sm text-fg-2">
          <span className="font-medium">Referral: </span>
          {recommendations.referral}
        </p>
      )}
    </Card>
  );
}

export function TreatmentPathways({ recommendations }) {
  const paths = recommendations.treatment_pathways ?? [];
  return (
    <Card title="Treatment pathways" subtitle="Only after the diagnosis is confirmed. Not a prescription.">
      {paths.length === 0 ? (
        <Empty>No treatment pathway applies at this screening result.</Empty>
      ) : (
        <ul className="space-y-2">
          {paths.map((p) => (
            <li key={p.name} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line-strong px-3 py-2">
              <span className="text-sm text-fg">{p.name}</span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-fg-2">
                {p.stage === 'post-confirmation' ? 'Post-confirmation' : p.stage}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
