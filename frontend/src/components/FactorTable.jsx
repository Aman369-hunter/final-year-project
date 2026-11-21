// Rendered straight from factors[] (Section 3.2: no extra computation).
// Only adds a disease filter and sorting for readability.
import { useState } from 'react';
import { CATEGORY_LABELS, isPlaceholderCitation } from '../lib/risk.js';

export default function FactorTable({ factors, predictions }) {
  const names = Object.fromEntries(predictions.map((p) => [p.disease, p.display_name]));
  const diseasesWithFactors = predictions.filter((p) => factors.some((f) => f.disease === p.disease));
  const [disease, setDisease] = useState('all');
  const rows = factors
    .filter((f) => disease === 'all' || f.disease === disease)
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.points - a.points || a.i - b.i);

  if (factors.length === 0) return <p className="text-sm text-fg-3">No scoring rules fired.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {[{ disease: 'all', display_name: `All (${factors.length})` }, ...diseasesWithFactors].map((p) => (
          <button
            key={p.disease}
            onClick={() => setDisease(p.disease)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
              disease === p.disease ? 'bg-primary text-on-primary ring-fg' : 'text-fg-2 ring-line-strong hover:bg-subtle'
            }`}
          >
            {p.display_name}
          </button>
        ))}
      </div>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-fg-3">
            <tr>
              <th className="px-5 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Finding</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">Points</th>
              <th className="px-3 py-2 font-medium">Direction</th>
              <th className="px-3 py-2 font-medium">Disease</th>
              <th className="px-5 py-2 font-medium">Citation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((f) => (
              <tr key={f.i}>
                <td className="px-5 py-2 text-fg-2">{CATEGORY_LABELS[f.category] ?? f.category}</td>
                <td className="px-3 py-2 text-fg">
                  {f.label}
                  <div className="font-mono text-[11px] text-fg-3">{f.feature}</div>
                </td>
                <td className="px-3 py-2 text-fg-2">{f.value}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">
                  {f.direction === 'decreases' ? '−' : '+'}{Math.abs(f.points)}
                </td>
                <td className="px-3 py-2">
                  <span className={f.direction === 'decreases' ? 'text-ok-fg' : 'text-danger-fg'}>
                    {f.direction === 'decreases' ? '▼ decreases' : '▲ increases'}
                  </span>
                </td>
                <td className="px-3 py-2 text-fg-2">{names[f.disease] ?? f.disease}</td>
                <td className="px-5 py-2">
                  <code className="text-[11px] text-fg-2">{f.citation}</code>
                  {isPlaceholderCitation(f.citation) && (
                    <span className="ml-1.5 rounded bg-warn-bg px-1 py-px text-[10px] font-medium text-warn-fg">placeholder</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
