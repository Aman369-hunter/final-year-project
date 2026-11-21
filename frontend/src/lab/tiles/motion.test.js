import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../VitalsMonitor.js';
import {
  beatPulse, beatTimings, clamp, keepPeak, lerpTriple, makeSpring, ppgShape, ringProgress, smoothK, stepSpring, sweepColumn,
} from './motion.js';

describe('two-phase heartbeat', () => {
  const rr = 800;
  it('rests at 0 before the beat and after the cycle completes', () => {
    expect(beatPulse(-10, rr)).toBe(0);
    expect(beatPulse(0, rr)).toBe(0);
    expect(beatPulse(beatTimings(rr).total + 1, rr)).toBe(0);
  });

  it('systole is a quick rise of ~120 ms that peaks at 1', () => {
    const { systole } = beatTimings(rr);
    expect(systole).toBeLessThanOrEqual(120);
    expect(systole).toBeGreaterThanOrEqual(70);
    expect(beatPulse(systole, rr)).toBeCloseTo(1, 5);
    let prev = -1;
    for (let t = 0; t <= systole; t += 4) {
      const p = beatPulse(t, rr);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('systole is sharp ease-out: most of the rise happens in the first half', () => {
    const { systole } = beatTimings(rr);
    expect(beatPulse(systole / 2, rr)).toBeGreaterThan(0.8);
  });

  it('diastole is slower than systole and monotonically relaxes to 0', () => {
    const { systole, diastole } = beatTimings(rr);
    expect(diastole).toBeGreaterThan(systole * 3);
    let prev = 2;
    for (let t = systole; t <= systole + diastole; t += 8) {
      const p = beatPulse(t, rr);
      expect(p).toBeLessThanOrEqual(prev + 1e-9);
      prev = p;
    }
  });

  it('diastole is ease-in-out (gentle at both ends), not linear', () => {
    const { systole, diastole } = beatTimings(rr);
    const early = 1 - beatPulse(systole + diastole * 0.1, rr);
    const mid = 1 - beatPulse(systole + diastole * 0.5, rr);
    expect(early).toBeLessThan(0.1); // slow start
    expect(mid).toBeCloseTo(0.5, 2);
  });

  it('the whole cycle scales with the actual RR interval and always fits inside it', () => {
    for (const bpm of [40, 60, 75, 100, 140, 180]) {
      const interval = 60000 / bpm;
      expect(beatTimings(interval).total).toBeLessThan(interval);
    }
    expect(beatTimings(400).total).toBeLessThan(beatTimings(1200).total);
  });

  it('ring progress runs 0 → 1 over the beat then holds', () => {
    expect(ringProgress(0, rr)).toBe(0);
    expect(ringProgress(rr, rr)).toBe(1);
    expect(ringProgress(rr * 0.45, rr)).toBeCloseTo(0.5, 1);
  });
});

describe('springs', () => {
  const settle = (opts, dt = 1 / 60, seconds = 3) => {
    const s = makeSpring(0);
    let peak = 0;
    for (let t = 0; t < seconds; t += dt) peak = Math.max(peak, stepSpring(s, 1, dt, opts));
    return { s, peak };
  };

  it('critically damped (zeta = 1) converges and NEVER overshoots', () => {
    const { s, peak } = settle({ omega: 10, zeta: 1 });
    expect(peak).toBeLessThanOrEqual(1 + 1e-6);
    expect(s.x).toBeCloseTo(1, 3);
  });

  it('never jumps: the first frame moves only a small fraction of the way', () => {
    const s = makeSpring(0);
    expect(stepSpring(s, 1, 1 / 60, { omega: 10, zeta: 1 })).toBeLessThan(0.05);
  });

  it('underdamped (zeta < 1) has a little momentum: it overshoots, then settles', () => {
    const { s, peak } = settle({ omega: 14, zeta: 0.55 });
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.25);
    expect(s.x).toBeCloseTo(1, 2);
  });

  it('is frame-rate independent (30 / 60 / 144 fps land in the same place)', () => {
    const at = (fps) => {
      const s = makeSpring(0);
      for (let i = 0; i < fps * 0.5; i++) stepSpring(s, 1, 1 / fps, { omega: 10, zeta: 1 });
      return s.x;
    };
    expect(at(30)).toBeCloseTo(at(144), 2);
    expect(at(60)).toBeCloseTo(at(144), 2);
  });

  it('survives a huge frame gap (tab restored after a minute) without blowing up', () => {
    const s = makeSpring(0);
    stepSpring(s, 1, 0.1, { omega: 14, zeta: 1 });
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeLessThanOrEqual(1.0001);
  });

  it('smoothK is 0 at dt = 0, rises toward 1, and is monotonic in dt', () => {
    expect(smoothK(8, 0)).toBe(0);
    expect(smoothK(8, 1 / 60)).toBeGreaterThan(0);
    expect(smoothK(8, 1)).toBeLessThan(1);
    expect(smoothK(8, 0.1)).toBeGreaterThan(smoothK(8, 0.05));
  });

  it('lerpTriple glides colours between states with no hard switch', () => {
    const cur = [10, 20, 30];
    lerpTriple(cur, [110, 120, 130], 0.5);
    expect(cur).toEqual([60, 70, 80]);
  });
});

describe('pulse wave shape', () => {
  it('stays in [0, 1], peaks early (fast upstroke) and has a dicrotic bump', () => {
    let peakAt = 0, peak = 0;
    for (let ph = 0; ph < 1; ph += 0.005) {
      const y = ppgShape(ph);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      if (y > peak) [peak, peakAt] = [y, ph];
    }
    expect(peakAt).toBeGreaterThan(0.1);
    expect(peakAt).toBeLessThan(0.22);
    // dicrotic wave: a local rise after the notch
    expect(ppgShape(0.43)).toBeGreaterThan(ppgShape(0.33));
  });

  it('is continuous across the cycle boundary (no seam when it scrolls)', () => {
    expect(Math.abs(ppgShape(0.9999) - ppgShape(0))).toBeLessThan(0.05);
  });

  it('upstroke is faster than the decay', () => {
    const rise = ppgShape(0.16) - ppgShape(0.06);
    const fall = ppgShape(0.16) - ppgShape(0.26);
    expect(rise).toBeGreaterThan(fall);
  });
});

describe('ECG sweep helpers', () => {
  it('maps a full window of samples onto the columns, in order, wrapping', () => {
    const window = 1250, cols = 625;
    expect(sweepColumn(0, window, cols)).toBe(0);
    expect(sweepColumn(window - 1, window, cols)).toBe(cols - 1);
    expect(sweepColumn(window, window, cols)).toBe(0); // wraps: the cursor sweeps again
    let prev = -1;
    for (let i = 0; i < window; i++) {
      const c = sweepColumn(i, window, cols);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('peak-preserving decimation keeps an R spike instead of averaging it away', () => {
    let col = 512;
    for (const v of [511, 513, 880, 512]) col = keepPeak(col, v);
    expect(col).toBe(880);
    expect(keepPeak(400, 600)).toBe(400); // |-112| vs |88| -> keeps the larger deviation
  });
});

describe('ring buffer counts new samples correctly even when full', () => {
  it('`count` saturates at capacity but `total` keeps counting', () => {
    const rb = new RingBuffer(100);
    for (let i = 0; i < 250; i++) rb.push(i, i);
    expect(rb.count).toBe(100); // capped: useless for "how many are new?"
    expect(rb.total).toBe(250); // monotonic: correct
    const out = new Float32Array(3);
    rb.readInto(out, 3);
    expect([...out]).toEqual([247, 248, 249]);
  });

  it('clamp helper', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-1)).toBe(0);
  });
});
