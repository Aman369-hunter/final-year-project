import { BAND_STYLE, bandFor, headlineFactor, pct, topDifferentials } from '../lib/risk.js';

export default function DifferentialCards({ response }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {topDifferentials(response, 3).map((p) => {
        const band = bandFor(p.absolute_risk);
        const f = headlineFactor(response, p.disease);
        return (
          <article key={p.disease} className="rounded-xl border border-line bg-surface p-4 shadow-sm" style={{ borderTop: `4px solid ${BAND_STYLE[band].color}` }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-3">#{p.rank} differential</span>
              <span className="text-xs text-fg-3">relative {pct(p.relative_probability)}</span>
            </div>
            <h3 className="mt-1 font-semibold text-fg">{p.display_name}</h3>
            <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: BAND_STYLE[band].color }}>
              {pct(p.absolute_risk)}
              <span className="ml-1.5 text-xs font-normal text-fg-3">screening risk</span>
            </p>
            <div className="mt-3 rounded-lg bg-subtle px-3 py-2 text-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-3">Headline factor</div>
              {f ? (
                <div className="mt-0.5 text-fg">
                  {f.label} <span className="text-fg-3">({f.value})</span>
                  <span className="ml-1 font-semibold tabular-nums text-fg">+{f.points}</span>
                </div>
              ) : (
                <div className="mt-0.5 text-fg-3">No scoring rule fired</div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
