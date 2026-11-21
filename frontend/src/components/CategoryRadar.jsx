// category_scores: exactly 5 axes (Section 3.2), points for the top-ranked disease.
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CATEGORY_LABELS } from '../lib/risk.js';
import { cssVar } from '../lib/tokens.js';

const AXES = ['enzyme', 'genetic', 'symptom', 'biomarker', 'vitals'];

export default function CategoryRadar({ scores, color }) {
  const data = AXES.map((k) => ({ axis: CATEGORY_LABELS[k].replace(' (supporting)', ''), points: scores[k] ?? 0 }));
  const max = Math.max(10, ...data.map((d) => d.points));
  const domainMax = Math.ceil(max / 10) * 10;

  return (
    <div>
      <ResponsiveContainer width="100%" height={250}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={cssVar('line')} />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: cssVar('fg-2') }} />
          <PolarRadiusAxis domain={[0, domainMax]} tickCount={3} tick={{ fontSize: 9, fill: cssVar('fg-3') }} angle={90} />
          <Radar dataKey="points" stroke={color} fill={color} fillOpacity={0.25} isAnimationActive />
          <Tooltip
            formatter={(v) => [`${v} points`, 'Score']}
            contentStyle={{ background: cssVar('surface'), border: `1px solid ${cssVar('line')}`, borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: cssVar('fg') }}
            itemStyle={{ color: cssVar('fg-2') }}
          />
        </RadarChart>
      </ResponsiveContainer>
      <ul className="mt-1 grid grid-cols-5 gap-1 text-center text-[11px] text-fg-2">
        {data.map((d) => (
          <li key={d.axis}>
            <div className="font-semibold tabular-nums text-fg">{d.points}</div>
            {d.axis}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-fg-3">Vitals are supporting evidence only, never diagnostic.</p>
    </div>
  );
}
