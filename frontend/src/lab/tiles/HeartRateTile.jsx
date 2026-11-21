// TILE 1: Heart rate (MAX30102).
// The heart beats ONCE PER DETECTED R-PEAK (the QRS worker's beats, not a timer) with a
// two-phase cycle scaled to the patient's real RR interval: a quick, sharp systolic
// rise (~120 ms) then a slower ease-in-out diastolic relaxation, a faint expanding ring
// and a slight warm shift at the peak, over a soft inner glow. Below it, a pulse
// wave (PPG) timed to those same beats with a gradient fill. All canvas + rAF; the
// numbers are written to the DOM from the animation loop, never through React state.
import { useRef } from 'react';
import { NoSignal, TileShell } from './TileShell.jsx';
import { fromTriple, rgb, triple } from '../../lib/tokens.js';
import { setColor, setText, useCanvasLoop, useFrameLoop } from './canvasKit.js';
import { beatPulse, lerpTriple, makeSpring, mixTriple, ppgShape, ringProgress, smoothK, stepSpring } from './motion.js';
import { useVitals } from '../useMonitor.js';

const HEART = new Path2D('M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');
const PPG_WINDOW_MS = 3200;
const PTT_MS = 180; // pulse transit: the pulse wave trails the R-peak at the finger

const normal = (hr) => hr >= 60 && hr <= 100;
const stateToken = (hr) => (hr == null ? 'fg-3' : normal(hr) ? 'ok-fg' : 'warn-fg');

export default function HeartRateTile({ monitor }) {
  const v = useVitals(monitor);
  const numRef = useRef(null);

  // Shared, loop-owned state: the heart and the PPG both follow the same beats.
  const shared = useRef({ beats: [], seen: 0 }).current;
  const track = (now) => {
    const L = monitor.live;
    if (L.lastBeatWall && L.lastBeatWall !== shared.seen) {
      shared.seen = L.lastBeatWall;
      shared.beats.push(L.lastBeatWall);
      if (shared.beats.length > 10) shared.beats.shift();
    }
    return { L, since: now - L.lastBeatWall, rr: L.lastIntervalMs || 800 };
  };

  // ---- heart ----
  const heartRef = useCanvasLoop(() => {
    const base = triple('danger-solid');
    const warm = triple('high-solid');
    return {
      paint(f) {
        const { ctx, w, h, now, reduced } = f;
        ctx.clearRect(0, 0, w, h);
        const { L, since, rr } = track(now);
        const streaming = L.connection === 'streaming' && L.lastBeatWall > 0;
        const pulse = streaming && !reduced ? beatPulse(since, rr) : 0;
        const col = mixTriple(base, warm, pulse * 0.4); // slight warm shift at peak contraction
        const size = Math.min(w, h) * 0.58;
        const s = (size / 24) * (1 + 0.1 * pulse);

        // faint expanding ring that fades out
        if (streaming && !reduced) {
          const rp = ringProgress(since, rr);
          if (rp < 1) {
            ctx.beginPath();
            ctx.arc(w / 2, h / 2, size * 0.5 * (1 + rp * 0.9), 0, Math.PI * 2);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = fromTriple(col, 0.4 * (1 - rp) ** 1.6);
            ctx.stroke();
          }
        }

        ctx.save();
        ctx.translate(w / 2, h / 2 + 1);
        ctx.scale(s, s);
        ctx.translate(-12, -12.2);
        // soft inner glow: lit core falling to the edge colour, not a flat fill
        const g = ctx.createRadialGradient(10.2, 9, 0.5, 12, 11, 12.5);
        g.addColorStop(0, fromTriple(mixTriple(col, [255, 255, 255], 0.38)));
        g.addColorStop(0.55, fromTriple(col));
        g.addColorStop(1, fromTriple(mixTriple(col, [0, 0, 0], 0.18)));
        ctx.fillStyle = g;
        if (pulse > 0.02) {
          ctx.shadowColor = fromTriple(col, 0.55 * pulse);
          ctx.shadowBlur = 16 * pulse;
        }
        ctx.globalAlpha = streaming ? 1 : 0.35;
        ctx.fill(HEART);
        ctx.restore();
      },
    };
  }, [monitor]);

  // ---- pulse wave ----
  const ppgRef = useCanvasLoop(() => {
    return {
      paint(f) {
        const { ctx, w, h, now } = f;
        ctx.clearRect(0, 0, w, h);
        const { L, rr } = track(now);
        const line = rgb('danger-solid');
        const baseY = h - 5;
        const amp = h - 12;

        if (L.connection !== 'streaming' || shared.beats.length === 0) {
          ctx.strokeStyle = rgb('line-strong', 0.7);
          ctx.setLineDash([3, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, baseY);
          ctx.lineTo(w, baseY);
          ctx.stroke();
          ctx.setLineDash([]);
          return;
        }

        const beats = shared.beats;
        const yAt = (t) => {
          const tt = t - PTT_MS;
          for (let i = beats.length - 1; i >= 0; i--) {
            if (beats[i] <= tt) {
              const next = beats[i + 1];
              const interval = next ? next - beats[i] : rr;
              const ph = (tt - beats[i]) / interval;
              return ph > 1 ? 0 : ppgShape(ph); // waiting on the next beat: sits at baseline
            }
          }
          // older than the oldest known beat: extrapolate backwards at the current RR
          const k = Math.ceil((beats[0] - tt) / rr);
          return ppgShape((tt - (beats[0] - k * rr)) / rr);
        };

        const step = 2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += step) {
          const t = now - ((w - x) / w) * PPG_WINDOW_MS;
          const y = baseY - yAt(t) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        // gradient fill under the curve
        const fill = ctx.createLinearGradient(0, 0, 0, h);
        fill.addColorStop(0, rgb('danger-solid', 0.3));
        fill.addColorStop(1, rgb('danger-solid', 0));
        ctx.save();
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
        // line on top
        ctx.beginPath();
        for (let x = 0; x <= w; x += step) {
          const t = now - ((w - x) / w) * PPG_WINDOW_MS;
          const y = baseY - yAt(t) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = line;
        ctx.stroke();
      },
    };
  }, [monitor]);

  // ---- readout: tweened number + state colour, written straight to the DOM ----
  const readout = useRef({ spring: makeSpring(0), col: triple('fg-3'), has: false }).current;
  useFrameLoop((f) => {
    const hr = monitor.getSnapshot().hr;
    if (hr == null) {
      readout.has = false;
      setText(numRef.current, '––');
      setColor(numRef.current, fromTriple(triple('fg-3')));
      return;
    }
    if (!readout.has) {
      readout.has = true;
      readout.spring.x = hr; // snap in from no-signal
      readout.col = triple(stateToken(hr));
    }
    stepSpring(readout.spring, hr, f.dt, { omega: 9, zeta: 1 });
    lerpTriple(readout.col, triple(stateToken(hr)), smoothK(8, f.dt)); // colour glides between states
    setText(numRef.current, String(Math.round(readout.spring.x)));
    setColor(numRef.current, fromTriple(readout.col));
  }, [monitor]);

  const q = v.quality.hr;
  const bpm = v.hr;
  const idle = q === 'no-signal' && !v.frozen;

  return (
    <TileShell title="Heart rate" sensor="MAX30102" quality={q} frozen={v.frozen}>
      <div className="relative">
        <div className="flex items-center justify-center gap-4">
          <canvas ref={heartRef} className="h-24 w-24 shrink-0" aria-hidden />
          <div>
            <div ref={numRef} className="text-metric font-semibold tabular-nums" aria-hidden>––</div>
            <div className="text-micro text-fg-3">bpm{bpm != null && !normal(bpm) ? (bpm > 100 ? ' · tachycardia' : ' · bradycardia') : ''}</div>
          </div>
        </div>
        <canvas ref={ppgRef} className="mt-3 h-14 w-full" aria-hidden />
        <span className="sr-only" role="status">{bpm == null ? 'No heart rate' : `Heart rate ${Math.round(bpm)} beats per minute`}</span>
        {idle && <NoSignal label="No pulse detected" />}
      </div>
    </TileShell>
  );
}
