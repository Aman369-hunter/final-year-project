// Animated semicircle gauge of the top-ranked disease's absolute_risk,
// coloured by risk_level (the band comes from the response, not recomputed).
import { animate, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { BAND_STYLE, BAND_THRESHOLDS, pct } from '../lib/risk.js';
import { cssVar } from '../lib/tokens.js';
import { BandBadge } from './ui.jsx';

const CX = 110;
const CY = 110;
const R = 88;
const ARC = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

function point(fraction, radius) {
  const angle = Math.PI * (1 - fraction);
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)];
}

export default function RiskGauge({ value, band, diseaseName }) {
  const [shown, setShown] = useState(0);
  const color = BAND_STYLE[band]?.color ?? cssVar('fg-3');

  useEffect(() => {
    const controls = animate(0, value, { duration: 1.1, ease: 'easeOut', onUpdate: setShown });
    return () => controls.stop();
  }, [value]);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 220 128" className="w-full max-w-[280px]" role="img" aria-label={`Screening risk ${pct(value)}, band ${band}`}>
        <path d={ARC} fill="none" stroke={cssVar('muted')} strokeWidth="16" strokeLinecap="round" />
        <motion.path
          key={value}
          d={ARC}
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: Math.max(value, 0.005) }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
        {BAND_THRESHOLDS.map((t) => {
          const [x1, y1] = point(t, R - 12);
          const [x2, y2] = point(t, R + 12);
          const [lx, ly] = point(t, R + 22);
          return (
            <g key={t}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={cssVar('line-strong')} strokeWidth="1.5" />
              <text x={lx} y={ly} textAnchor="middle" className="fill-fg-3 text-[9px]">{Math.round(t * 100)}</text>
            </g>
          );
        })}
        <text x={CX} y={CY - 18} textAnchor="middle" className="fill-fg-3 text-[28px] font-semibold tabular-nums">
          {(shown * 100).toFixed(1)}%
        </text>
        <text x={CX} y={CY} textAnchor="middle" className="fill-fg-3 text-[10px]">absolute screening risk</text>
      </svg>
      <div className="mt-2 flex flex-col items-center gap-1.5 text-center">
        <BandBadge band={band} size="lg" />
        <p className="text-xs text-fg-3">
          Top-ranked: <span className="font-medium text-fg-2">{diseaseName}</span>, {pct(value)} screening risk
        </p>
      </div>
    </div>
  );
}
