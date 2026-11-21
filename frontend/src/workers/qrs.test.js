// Scores the QRS detector against the replay fixture's own ground-truth beat
// list. Reports sensitivity / PPV, the BIDMC-style metric the spec asks for
// (Section 7). Tests the pure detector module the worker wraps.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { createDetector } from './qrsDetector.js';

function matchBeats(detected, truth, toleranceMs = 160) {
  let tp = 0;
  const used = new Set();
  for (const d of detected) {
    const i = truth.findIndex((t, idx) => !used.has(idx) && Math.abs(t - d) <= toleranceMs);
    if (i >= 0) {
      tp++;
      used.add(i);
    }
  }
  return { tp, fp: detected.length - tp, fn: truth.length - tp };
}

describe('QRS detector (simplified Pan-Tompkins)', () => {
  test('detects the fixture beats with high sensitivity and precision', () => {
    const path = fileURLToPath(new URL('../../../fixtures/serial-replay.jsonl', import.meta.url));
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const header = JSON.parse(lines[0]);
    const objs = lines.slice(1).map((l) => JSON.parse(l));
    const batches = objs.filter((o) => Array.isArray(o.ecg));

    const fs = header.ecg_sample_rate_hz;
    const det = createDetector(fs);
    const detected = [];
    const dt = 1000 / fs;
    for (const b of batches) {
      for (let i = 0; i < b.ecg.length; i++) {
        const beat = det.push(b.ecg[i], b.t + i * dt);
        if (beat) detected.push(beat.t);
      }
    }

    // Exclude the 8–14 s lead-off window: the trace there is pure noise, so beats
    // are legitimately undetectable. Drop detector warm-up (first 1 s) too.
    const leadOff = (t) => t >= header.t0 + 8000 && t < header.t0 + 14500;
    const warm = (t) => t < header.t0 + 1000;
    const truth = header.beats.filter((t) => !leadOff(t) && !warm(t));
    const found = detected.filter((t) => !leadOff(t) && !warm(t));

    const { tp, fp, fn } = matchBeats(found, truth);
    const sensitivity = tp / (tp + fn);
    const ppv = tp / (tp + fp);
    // eslint-disable-next-line no-console
    console.log(`QRS: ${tp} TP, ${fp} FP, ${fn} FN -> Se ${(sensitivity * 100).toFixed(1)}%, +P ${(ppv * 100).toFixed(1)}% (n_truth=${truth.length})`);

    expect(sensitivity).toBeGreaterThan(0.9);
    expect(ppv).toBeGreaterThan(0.9);
  });
});
