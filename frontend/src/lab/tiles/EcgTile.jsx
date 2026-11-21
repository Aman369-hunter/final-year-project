// TILE 3: ECG (AD8232). A bedside-monitor display, not a scrolling chart:
//  - dark panel with real ECG-paper geometry: 25 mm/s, small squares = 40 ms,
//    large squares = 200 ms, drawn from the time base (5 s across), square boxes
//  - the TRACE STAYS PUT and a sweep cursor moves across it, erasing a thin band
//    ahead of itself, like a real monitor
//  - phosphor look: bright leading edge with a short glow, older trace fading behind
//  - antialiased 1.7 px line with a slight bloom; R-peaks are small ticks, not dots
// Canvas + rAF only. The 250 Hz stream never touches React state: it is read from the
// monitor's ring buffer, reduced to one peak-preserving value per pixel column, and
// painted. The grid is cached on an offscreen canvas and only rebuilt on resize.
import { TileShell } from './TileShell.jsx';
import { rgb } from '../../lib/tokens.js';
import { FONT, useCanvasLoop } from './canvasKit.js';
import { keepPeak, sweepColumn } from './motion.js';
import { useVitals } from '../useMonitor.js';

const WINDOW_S = 5;
const SMALL_MS = 40;
const LARGE_MS = 200;
const BUCKETS = 22; // age steps for the fading trail: 22 strokes beats one stroke per column
const ADC_MID = 512;

export default function EcgTile({ monitor }) {
  const v = useVitals(monitor);

  const canvasRef = useCanvasLoop(({ ctx }) => {
    const sr = monitor.sampleRate;
    const M = sr * WINDOW_S; // samples per full sweep
    const ring = monitor.ecgRing;
    const tmp = new Float32Array(M);
    let N = 0;
    let trace = new Float32Array(0);
    let has = new Uint8Array(0);
    let tick = new Uint8Array(0);
    let grid = null;
    let g0 = ring.total; // global index of the next sample to ingest
    let lastTotal = ring.total;
    let lastCol = -1;
    let cursorCol = -1;
    let lastBeatT = -Infinity;

    function buildGrid(f) {
      const { w, h, dpr } = f;
      grid = document.createElement('canvas');
      grid.width = Math.round(w * dpr);
      grid.height = Math.round(h * dpr);
      const g = grid.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = rgb('mon-bg');
      g.fillRect(0, 0, w, h);
      // one small square = 40 ms across; boxes are square, so the same pixel size vertically
      const small = w / ((WINDOW_S * 1000) / SMALL_MS);
      const perLarge = LARGE_MS / SMALL_MS;
      const rows = Math.floor(h / small);
      const y0 = (h - rows * small) / 2;
      for (let i = 0; i <= (WINDOW_S * 1000) / SMALL_MS; i++) {
        const major = i % perLarge === 0;
        g.strokeStyle = rgb('mon-grid', major ? 0.17 : 0.06);
        g.lineWidth = 1;
        const x = Math.round(i * small) + 0.5;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      for (let j = 0; j <= rows; j++) {
        const major = j % perLarge === 0;
        g.strokeStyle = rgb('mon-grid', major ? 0.17 : 0.06);
        const y = Math.round(y0 + j * small) + 0.5;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      // vignette, so the panel reads as a recessed display
      const vg = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.28)');
      g.fillStyle = vg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = rgb('mon-text', 0.5);
      g.font = `500 10px ${FONT}`;
      g.textBaseline = 'alphabetic';
      g.fillText('25 mm/s · 10 mm/mV', 10, h - 8);
    }

    return {
      resize(f) {
        N = Math.max(150, Math.min(M, f.w)); // about one column per CSS pixel
        trace = new Float32Array(N);
        has = new Uint8Array(N);
        tick = new Uint8Array(N);
        lastCol = -1;
        cursorCol = -1;
        buildGrid(f);
      },

      paint(f) {
        const { w, h, now, reduced } = f;
        const L = monitor.live;

        // ---- ingest new samples (monotonic `total`, not the saturating `count`) ----
        let k = ring.total - lastTotal;
        if (k > M) {
          // we fell far behind (tab was hidden): drop the gap and restart the sweep
          lastTotal = ring.total;
          g0 = ring.total;
          has.fill(0);
          tick.fill(0);
          lastCol = -1;
          k = 0;
        }
        if (k > 0) {
          ring.readInto(tmp, k);
          for (let i = 0; i < k; i++) {
            const col = sweepColumn(g0 + i, M, N);
            if (col !== lastCol) {
              trace[col] = tmp[i]; // the cursor entered a new column: overwrite what was there
              has[col] = 1;
              tick[col] = 0;
              lastCol = col;
            } else {
              trace[col] = keepPeak(trace[col], tmp[i], ADC_MID);
            }
          }
          g0 += k;
          lastTotal = ring.total;
          cursorCol = lastCol;
        }

        // ---- R-peak ticks: place each beat at the column of its sample ----
        const newestT = ring.times[(ring.head - 1 + ring.capacity) % ring.capacity];
        const dtMs = 1000 / sr;
        for (const bt of L.beatTimes) {
          if (bt <= lastBeatT) continue;
          lastBeatT = bt;
          const back = Math.round((newestT - bt) / dtMs);
          if (back >= 0 && back < M) tick[sweepColumn(g0 - 1 - back, M, N)] = 1;
        }

        // ---- draw ----
        ctx.drawImage(grid, 0, 0, w, h);
        const warn = L.lo;
        const tone = warn ? 'mon-trace-warn' : 'mon-trace';
        const mid = h / 2;
        const yk = h / 640;
        const colW = w / N;
        const Y = (val) => Math.max(2, Math.min(h - 2, mid - (val - ADC_MID) * yk));
        const X = (c) => (c + 0.5) * colW;

        if (cursorCol < 0) {
          ctx.strokeStyle = rgb('mon-text', 0.25);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.moveTo(0, mid);
          ctx.lineTo(w, mid);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = rgb('mon-text', 0.55);
          ctx.font = `500 12px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText('Waiting for ECG signal…', w / 2, mid - 12);
          ctx.textAlign = 'start';
          return;
        }

        // The cursor erases a thin band AHEAD of itself: the oldest columns stay blank.
        const gap = Math.ceil(N * 0.035);
        const visible = N - gap;
        const per = Math.ceil(visible / BUCKETS);
        const colAt = (j) => (cursorCol + 1 + gap + j) % N;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        let headPath = null;

        for (let b = 0; b < BUCKETS; b++) {
          const j0 = b * per;
          const j1 = Math.min((b + 1) * per, visible - 1);
          if (j0 > j1) break;
          const age = (b + 1) / BUCKETS; // 0 = oldest, 1 = newest
          const path = new Path2D();
          let prev = -1;
          let started = false;
          for (let j = j0; j <= j1; j++) {
            const c = colAt(j);
            if (!has[c]) {
              started = false;
              continue;
            }
            const x = X(c);
            const y = Y(trace[c]);
            if (!started || c < prev) path.moveTo(x, y); // break the line where the sweep wraps
            else path.lineTo(x, y);
            started = true;
            prev = c;
          }
          ctx.strokeStyle = rgb(tone, 0.16 + 0.84 * age ** 1.7); // phosphor persistence
          ctx.lineWidth = 1.7;
          ctx.stroke(path);
          if (b >= BUCKETS - 2) headPath = path; // newest ~9% of the sweep gets the glow
        }

        if (headPath && !reduced) {
          ctx.strokeStyle = rgb(tone, 0.13);
          ctx.lineWidth = 6;
          ctx.stroke(headPath);
          ctx.strokeStyle = rgb(tone, 0.24);
          ctx.lineWidth = 3.4;
          ctx.stroke(headPath);
        }

        // R-peak ticks: subtle, fading with the trail
        ctx.fillStyle = rgb('mon-tick', 0.5);
        for (let j = 0; j < visible; j++) {
          const c = colAt(j);
          if (tick[c] && has[c]) {
            ctx.globalAlpha = 0.25 + 0.75 * (j / visible);
            ctx.fillRect(X(c) - 0.6, 3, 1.2, 7);
          }
        }
        ctx.globalAlpha = 1;

        // bright leading edge
        const hx = X(cursorCol);
        const hy = Y(trace[cursorCol]);
        if (!reduced) {
          ctx.fillStyle = rgb(tone, 0.2);
          ctx.beginPath();
          ctx.arc(hx, hy, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgb('mon-text');
        ctx.beginPath();
        ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
        ctx.fill();

        if (warn) {
          ctx.fillStyle = rgb('mon-trace-warn');
          ctx.font = `600 11px ${FONT}`;
          ctx.fillText('LEAD OFF · check electrodes (AD8232 LO+/LO-)', 10, 18);
        }
        void now;
      },
    };
  }, [monitor]);

  const rhythm = v.lo ? 'lead-off' : v.bpmFromEcg ? (v.quality.ecg === 'poor-signal' ? 'noisy' : 'sinus') : '—';
  const footer = `Rhythm: ${rhythm}` + (v.bpmFromEcg ? ` · ${v.bpmFromEcg} bpm (ECG) · ${v.beatsDetected} beats detected` : '') + (v.lo ? ' · electrodes off' : '');

  return (
    <TileShell title="ECG" sensor="AD8232 · 250 Hz" quality={v.quality.ecg} frozen={v.frozen} footer={footer}>
      <canvas ref={canvasRef} className="h-44 w-full rounded-lg" role="img" aria-label={`ECG trace. ${footer}`} />
    </TileShell>
  );
}
