// TILE 2: Oxygen saturation (MAX30102). A smooth 270° ring gauge with a gradient
// stroke and rounded cap. The number is tweened by a critically damped spring (it
// glides, never jumps), the ring "breathes" by ±1% so it reads as live, and the
// colour animates between states (amber < 94 %, red < 90 %) with no hard switch.
import { useRef } from 'react';
import { NoSignal, TileShell } from './TileShell.jsx';
import { fromTriple, rgb, triple } from '../../lib/tokens.js';
import { FONT, setColor, setText, useCanvasLoop, useFrameLoop } from './canvasKit.js';
import { clamp, lerpTriple, makeSpring, mixTriple, smoothK, stepSpring } from './motion.js';
import { useVitals } from '../useMonitor.js';

const A0 = Math.PI * 0.75; // gauge starts bottom-left and sweeps 270° clockwise
const SWEEP = Math.PI * 1.5;
const LO = 85;
const HI = 100;
const frac = (pct) => clamp((pct - LO) / (HI - LO));
const stateToken = (spo2) => (spo2 == null ? 'fg-3' : spo2 < 90 ? 'danger-solid' : spo2 < 94 ? 'warn-solid' : 'ok-solid');
const textToken = (spo2) => (spo2 == null ? 'fg-3' : spo2 < 90 ? 'danger-fg' : spo2 < 94 ? 'warn-fg' : 'ok-fg');

export default function SpO2Tile({ monitor }) {
  const v = useVitals(monitor);
  const numRef = useRef(null);
  const st = useRef({ spring: makeSpring(0), col: triple('fg-3'), tcol: triple('fg-3'), has: false }).current;

  // Shared per-frame state (number + colour) advanced once, read by the ring and the DOM number.
  const advance = (dt) => {
    const spo2 = monitor.getSnapshot().spo2;
    if (spo2 == null) {
      st.has = false;
      return null;
    }
    if (!st.has) {
      st.has = true;
      st.spring.x = spo2;
      st.col = triple(stateToken(spo2));
      st.tcol = triple(textToken(spo2));
    }
    stepSpring(st.spring, spo2, dt, { omega: 8, zeta: 1 }); // ease-out, never overshoots
    lerpTriple(st.col, triple(stateToken(spo2)), smoothK(7, dt));
    lerpTriple(st.tcol, triple(textToken(spo2)), smoothK(7, dt));
    return st.spring.x;
  };

  const ringRef = useCanvasLoop(() => ({
    paint(f) {
      const { ctx, w, h, now, dt, reduced } = f;
      ctx.clearRect(0, 0, w, h);
      const shown = advance(dt);
      const cx = w / 2;
      const cy = h / 2;
      const breathe = reduced || shown == null ? 1 : 1 + 0.01 * Math.sin((now / 4200) * Math.PI * 2); // ±1%
      const R = (Math.min(w, h) / 2 - 12) * breathe;
      const lw = 11;

      ctx.lineCap = 'round';
      ctx.lineWidth = lw;
      ctx.strokeStyle = rgb('muted');
      ctx.beginPath();
      ctx.arc(cx, cy, R, A0, A0 + SWEEP);
      ctx.stroke();

      // threshold ticks at 90 and 94 so the colour bands have a visible origin
      for (const [pct, tok] of [[90, 'danger-solid'], [94, 'warn-solid']]) {
        const a = A0 + SWEEP * frac(pct);
        ctx.beginPath();
        ctx.lineWidth = 2;
        ctx.lineCap = 'butt';
        ctx.strokeStyle = rgb(tok, 0.85);
        ctx.moveTo(cx + Math.cos(a) * (R + lw / 2 + 1), cy + Math.sin(a) * (R + lw / 2 + 1));
        ctx.lineTo(cx + Math.cos(a) * (R + lw / 2 + 6), cy + Math.sin(a) * (R + lw / 2 + 6));
        ctx.stroke();
      }
      ctx.lineCap = 'round';

      if (shown != null) {
        const end = A0 + SWEEP * Math.max(frac(shown), 0.004);
        // gradient stroke: lighter at the start, full colour at the tip
        const g = ctx.createLinearGradient(cx - R, cy + R, cx + R, cy - R);
        g.addColorStop(0, fromTriple(mixTriple(st.col, [255, 255, 255], 0.35)));
        g.addColorStop(1, fromTriple(st.col));
        if (!reduced) {
          ctx.lineWidth = lw + 7;
          ctx.strokeStyle = fromTriple(st.col, 0.14); // faint bloom, no blur cost
          ctx.beginPath();
          ctx.arc(cx, cy, R, A0, end);
          ctx.stroke();
        }
        ctx.lineWidth = lw;
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R, A0, end);
        ctx.stroke();
      }

      ctx.fillStyle = rgb('fg-3');
      ctx.font = `500 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${LO}`, cx - R * 0.72, cy + R * 0.98);
      ctx.fillText(`${HI}`, cx + R * 0.72, cy + R * 0.98);
    },
  }), [monitor]);

  // The big number is DOM text written from the loop (never React state).
  useFrameLoop(() => {
    const shown = st.has ? st.spring.x : null;
    setText(numRef.current, shown == null ? '––' : String(Math.round(shown)));
    setColor(numRef.current, fromTriple(st.tcol));
  }, [monitor]);

  const q = v.quality.spo2;
  const idle = q === 'no-signal' && !v.frozen;

  return (
    <TileShell title="Oxygen saturation" sensor="MAX30102" quality={q} frozen={v.frozen} footer={v.pi != null ? `Perfusion index ${v.pi.toFixed(2)}` : null}>
      <div className="relative mx-auto h-36 w-36">
        <canvas ref={ringRef} className="h-full w-full" aria-hidden />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span ref={numRef} className="text-metric font-semibold tabular-nums" aria-hidden>––</span>
          <span className="-mt-0.5 text-micro text-fg-3">% SpO₂</span>
        </div>
        <span className="sr-only" role="status">{v.spo2 == null ? 'No oxygen saturation' : `Oxygen saturation ${Math.round(v.spo2)} percent`}</span>
        {idle && <NoSignal label="No pulse oximetry" />}
      </div>
    </TileShell>
  );
}
