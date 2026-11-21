// TILE 5: Motion / activity (MPU6050). X/Y/Z acceleration bars with momentum (a lightly
// underdamped spring, so they swing and settle instead of jumping), a tremor-index
// sparkline drawn as a smooth curve with a gradient fill, and a damped mobility meter.
// One canvas, rAF only; the numbers are mirrored in an sr-only live region.
import { NoSignal, TileShell } from './TileShell.jsx';
import { rgb } from '../../lib/tokens.js';
import { FONT, useCanvasLoop } from './canvasKit.js';
import { clamp, makeSpring, stepSpring } from './motion.js';
import { useVitals } from '../useMonitor.js';

const AXES = ['X', 'Y', 'Z'];
const FULL_SCALE_G = 0.5; // a bar is full at ±0.5 g (gravity removed)

export default function MotionTile({ monitor }) {
  const v = useVitals(monitor);

  const canvasRef = useCanvasLoop(() => {
    const bars = AXES.map(() => makeSpring(0));
    const mob = makeSpring(0);
    const max = makeSpring(0.05);

    return {
      paint(f) {
        const { ctx, w, h, dt } = f;
        ctx.clearRect(0, 0, w, h);
        const snap = monitor.getSnapshot();
        const accel = snap.accel;
        const L = monitor.live;

        ctx.font = `500 11px ${FONT}`;
        ctx.textBaseline = 'middle';

        // ---- acceleration bars (momentum) ----
        const x0 = 18;
        const x1 = w - 46;
        const half = (x1 - x0) / 2;
        const mx = (x0 + x1) / 2;
        AXES.forEach((axis, i) => {
          const raw = i === 2 ? (accel.z ?? 0) - 1 : accel[axis.toLowerCase()] ?? 0;
          const s = stepSpring(bars[i], clamp(raw / FULL_SCALE_G, -1, 1), dt, { omega: 13, zeta: 0.6 });
          const y = 12 + i * 24;
          ctx.fillStyle = rgb('fg-3');
          ctx.textAlign = 'left';
          ctx.fillText(axis, 0, y);
          ctx.fillStyle = rgb('muted');
          ctx.beginPath();
          ctx.roundRect(x0, y - 4, x1 - x0, 8, 4);
          ctx.fill();
          const len = Math.min(half, Math.abs(s) * half);
          ctx.fillStyle = rgb('accent-solid');
          ctx.beginPath();
          ctx.roundRect(s < 0 ? mx - len : mx, y - 4, Math.max(len, 0.5), 8, 4);
          ctx.fill();
          ctx.fillStyle = rgb('line-strong');
          ctx.fillRect(mx - 0.5, y - 6, 1, 12);
          ctx.fillStyle = rgb('fg-3');
          ctx.textAlign = 'right';
          ctx.fillText(raw.toFixed(2), w, y);
        });

        // ---- tremor sparkline: smooth curve + gradient fill ----
        const ty = 96;
        ctx.fillStyle = rgb('fg-3');
        ctx.textAlign = 'left';
        ctx.fillText('Tremor index (30 s)', 0, ty);
        ctx.textAlign = 'right';
        ctx.fillText(snap.tremorIndex.toFixed(3), w, ty);
        const cy0 = ty + 10;
        const ch = 46;
        const hist = L.tremorHistory;
        if (hist.length > 1) {
          const peak = Math.max(0.05, ...hist.map((p) => p.v)) * 1.15;
          const scale = stepSpring(max, peak, dt, { omega: 3, zeta: 1 }); // the chart rescales smoothly
          const stride = Math.max(1, Math.floor(hist.length / (w / 3)));
          const pts = [];
          for (let i = 0; i < hist.length; i += stride) {
            pts.push([(i / (hist.length - 1)) * w, cy0 + ch - 2 - clamp(hist[i].v / scale) * (ch - 4)]);
          }
          const last = hist.length - 1;
          if ((last % stride) !== 0) pts.push([w, cy0 + ch - 2 - clamp(hist[last].v / scale) * (ch - 4)]);
          const curve = new Path2D();
          curve.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length - 1; i++) {
            curve.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
          }
          const end = pts[pts.length - 1];
          curve.lineTo(end[0], end[1]);
          const area = new Path2D(curve);
          area.lineTo(end[0], cy0 + ch);
          area.lineTo(pts[0][0], cy0 + ch);
          area.closePath();
          const g = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
          g.addColorStop(0, rgb('refer-solid', 0.3));
          g.addColorStop(1, rgb('refer-solid', 0));
          ctx.fillStyle = g;
          ctx.fill(area);
          ctx.lineWidth = 1.6;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = rgb('refer-solid');
          ctx.stroke(curve);
        } else {
          ctx.strokeStyle = rgb('line-strong', 0.6);
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(0, cy0 + ch - 2);
          ctx.lineTo(w, cy0 + ch - 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // ---- mobility meter (damped) ----
        const my = cy0 + ch + 20;
        const m = stepSpring(mob, snap.mobilityScore ?? 0, dt, { omega: 6, zeta: 1 });
        ctx.fillStyle = rgb('fg-3');
        ctx.textAlign = 'left';
        ctx.fillText('Mobility score', 0, my);
        ctx.textAlign = 'right';
        ctx.fillText(snap.mobilityScore == null ? '—' : snap.mobilityScore.toFixed(2), w, my);
        ctx.fillStyle = rgb('muted');
        ctx.beginPath();
        ctx.roundRect(0, my + 9, w, 8, 4);
        ctx.fill();
        ctx.fillStyle = rgb('ok-solid');
        ctx.beginPath();
        ctx.roundRect(0, my + 9, Math.max(0, clamp(m) * w), 8, 4);
        ctx.fill();
      },
    };
  }, [monitor]);

  const q = v.quality.motion;
  const idle = q === 'no-signal' && !v.frozen;
  const a = v.accel;

  return (
    <TileShell title="Motion / activity" sensor="MPU6050" quality={q} frozen={v.frozen}>
      <div className="relative">
        <canvas ref={canvasRef} className="h-[200px] w-full" aria-hidden />
        <span className="sr-only" role="status">
          {a ? `Acceleration X ${a.x?.toFixed?.(2)}, Y ${a.y?.toFixed?.(2)}, Z ${a.z?.toFixed?.(2)}. Tremor index ${v.tremorIndex.toFixed(3)}. Mobility ${v.mobilityScore == null ? 'unknown' : v.mobilityScore.toFixed(2)}.` : 'No motion data'}
        </span>
        {idle && <NoSignal label="No motion data" />}
      </div>
    </TileShell>
  );
}
