// All 6 diseases by absolute_risk (Section 3.2: never omit low scorers).
// Every label carries the percentage (Section 6.4 rule 2).
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BAND_STYLE, BAND_THRESHOLDS, bandFor, pct } from '../lib/risk.js';
import { cssVar } from '../lib/tokens.js';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="font-semibold text-fg">{p.display_name}</div>
      <div>Absolute screening risk: {pct(p.absolute_risk)}</div>
      <div>Relative probability: {pct(p.relative_probability)}</div>
      <div className="text-fg-3">Score {p.raw_score} / {p.max_possible_score} · rank {p.rank}</div>
    </div>
  );
}

export default function DiseaseBarChart({ predictions }) {
  const data = [...predictions].sort((a, b) => a.rank - b.rank);
  const max = Math.max(...data.map((d) => d.absolute_risk));
  const domainMax = Math.min(1, Math.max(0.4, Math.ceil((max + 0.1) * 10) / 10));

  return (
    <div>
      <ResponsiveContainer width="100%" height={data.length * 40 + 30}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }}>
          <XAxis type="number" domain={[0, domainMax]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: cssVar('fg-3') }} stroke={cssVar('line-strong')} />
          <YAxis type="category" dataKey="display_name" width={170} tick={{ fontSize: 12, fill: cssVar('fg-2') }} stroke={cssVar('line-strong')} />
          {BAND_THRESHOLDS.filter((t) => t <= domainMax).map((t) => (
            <ReferenceLine key={t} x={t} stroke={cssVar('line-strong')} strokeDasharray="3 3" />
          ))}
          <Tooltip content={<ChartTooltip />} cursor={{ fill: cssVar('muted', 0.6) }} />
          <Bar dataKey="absolute_risk" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive>
            {data.map((d) => (
              <Cell key={d.disease} fill={BAND_STYLE[bandFor(d.absolute_risk)].color} />
            ))}
            <LabelList dataKey="absolute_risk" position="right" formatter={(v) => pct(v)} style={{ fontSize: 11, fill: cssVar('fg-2') }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-fg-3">
        Dashed lines mark the band thresholds at 30%, 60% and 80%. Bars use absolute risk (score ÷ maximum possible), which sets the risk band.
      </p>
    </div>
  );
}
