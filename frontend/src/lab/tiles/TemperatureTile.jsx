// TILE 4: Temperature (DS18B20). A liquid-filled thermometer: the column rises on a
// critically damped spring (no bounce), its surface has a slight meniscus curve, and the
// scale carries fine 0.2 °C markings with the normal range (36.1-37.5 °C) shaded.
import { useRef } from 'react';
import { NoSignal, TileShell } from './TileShell.jsx';
import { fromTriple, rgb, triple } from '../../lib/tokens.js';
import { FONT, setColor, setText, useCanvasLoop, useFrameLoop } from './canvasKit.js';
import { clamp, lerpTriple, makeSpring, mixTriple, smoothK, stepSpring } from './motion.js';
import { useVitals } from '../useMonitor.js';

const LO = 34;
const HI = 40;
const N_LO = 36.1;
const N_HI = 37.5;
const stateToken = (t) => (t == null ? 'fg-3' : t >= N_LO && t <= N_HI ? 'ok-solid' : 'warn-solid');
const textToken = (t) => (t == null ? 'fg-3' : t >= N_LO && t <= N_HI ? 'ok-fg' : 'warn-fg');

export default function TemperatureTile({ monitor }) {
  const v = useVitals(monitor);
  const numRef = useRef(null);
  const st = useRef({ spring: makeSpring(0), col: triple('fg-3'), tcol: triple('fg-3'), has: false }).current;

  const advance = (dt) => {
    const t = monitor.getSnapshot().temp;
    if (t == null) {
      st.has = false;
      return null;
    }
    if (!st.has) {
      st.has = true;
      st.spring.x = t;
      st.col = triple(stateToken(t));
      st.tcol = triple(textToken(t));
    }
    stepSpring(st.spring, t, dt, { omega: 6, zeta: 1 });
    lerpTriple(st.col, triple(stateToken(t)), smoothK(6, dt));
    lerpTriple(st.tcol, triple(textToken(t)), smoothK(6, dt));
    return st.spring.x;
  };

  const canvasRef = useCanvasLoop(() => ({
    paint(f) {
      const { ctx, w, h, dt } = f;
      ctx.clearRect(0, 0, w, h);
      const shown = advance(dt);

      const tubeW = 16;
      const cx = 46;
      const top = 8;
      const bulbR = 15;
      const bulbY = h - bulbR - 3;
      const tubeBottom = bulbY - bulbR + 6;
      const yFor = (deg) => tubeBottom - clamp((deg - LO) / (HI - LO)) * (tubeBottom - top);

      // normal-range band beside the tube
      ctx.fillStyle = rgb('ok-solid', 0.14);
      ctx.fillRect(cx + tubeW / 2 + 5, yFor(N_HI), 6, yFor(N_LO) - yFor(N_HI));

      // fine scale: minor every 0.2 °C, medium every 0.5, major + label every 1 °C
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `500 10px ${FONT}`;
      for (let i = 0; i <= (HI - LO) * 5; i++) {
        const deg = LO + i * 0.2;
        const major = Math.abs(deg - Math.round(deg)) < 1e-6;
        const half = !major && Math.abs(deg * 2 - Math.round(deg * 2)) < 1e-6;
        const len = major ? 9 : half ? 6 : 3.5;
        const y = Math.round(yFor(deg)) + 0.5;
        ctx.strokeStyle = major ? rgb('fg-3') : rgb('line-strong', 0.9);
        ctx.lineWidth = major ? 1.2 : 1;
        ctx.beginPath();
        ctx.moveTo(cx - tubeW / 2 - 4, y);
        ctx.lineTo(cx - tubeW / 2 - 4 - len, y);
        ctx.stroke();
        if (major) {
          ctx.fillStyle = rgb('fg-3');
          ctx.fillText(String(Math.round(deg)), cx - tubeW / 2 - 17, y);
        }
      }

      // glass
      const glass = new Path2D();
      glass.roundRect(cx - tubeW / 2, top, tubeW, tubeBottom - top + 8, tubeW / 2);
      glass.moveTo(cx + bulbR, bulbY);
      glass.arc(cx, bulbY, bulbR, 0, Math.PI * 2);
      ctx.fillStyle = rgb('muted');
      ctx.fill(glass);

      // liquid (clipped to the glass)
      if (shown != null) {
        ctx.save();
        ctx.clip(glass);
        const y = yFor(shown);
        const m = 2.4; // meniscus depth
        const g = ctx.createLinearGradient(0, y, 0, bulbY + bulbR);
        g.addColorStop(0, fromTriple(mixTriple(st.col, [255, 255, 255], 0.3)));
        g.addColorStop(1, fromTriple(st.col));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx - tubeW / 2 - 2, y - m);
        ctx.quadraticCurveTo(cx, y + m * 1.5, cx + tubeW / 2 + 2, y - m); // concave surface: edges climb the glass
        ctx.lineTo(cx + tubeW / 2 + 2, h);
        ctx.lineTo(cx - tubeW / 2 - 2, h);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, bulbY, bulbR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // glass outline + a soft highlight
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgb('line-strong');
      ctx.stroke(glass);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(cx - tubeW / 2 + 3, top + 6, 2, tubeBottom - top - 10);
    },
  }), [monitor]);

  useFrameLoop(() => {
    setText(numRef.current, st.has ? st.spring.x.toFixed(1) : '––');
    setColor(numRef.current, fromTriple(st.tcol));
  }, [monitor]);

  const q = v.quality.temp;
  const idle = q === 'no-signal' && !v.frozen;
  const inRange = v.temp != null && v.temp >= N_LO && v.temp <= N_HI;

  return (
    <TileShell title="Temperature" sensor="DS18B20" quality={q} frozen={v.frozen}>
      <div className="relative flex items-center justify-center gap-5">
        <canvas ref={canvasRef} className="h-36 w-24 shrink-0" aria-hidden />
        <div>
          <div className="text-metric font-semibold tabular-nums">
            <span ref={numRef} aria-hidden>––</span>
            <span className="ml-0.5 text-title font-medium text-fg-3">°C</span>
          </div>
          <div className="text-micro text-fg-3">{v.temp == null ? '' : inRange ? 'Afebrile' : v.temp > N_HI ? 'Above range' : 'Below range'}</div>
        </div>
        <span className="sr-only" role="status">{v.temp == null ? 'No temperature' : `Temperature ${v.temp.toFixed(1)} degrees Celsius`}</span>
        {idle && <NoSignal label="No probe reading" />}
      </div>
    </TileShell>
  );
}
