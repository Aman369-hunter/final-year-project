// Simplified Pan-Tompkins QRS detector (Section 7), as a pure factory so it can
// run in the worker and be unit-tested off-thread. Pipeline: band-pass (low-pass
// then high-pass) -> derivative -> square -> moving-window integrate -> adaptive
// threshold. createDetector() returns an object with isolated state; call
// push(value, tMs) per sample and it returns a beat descriptor or null.

export function createDetector(fs = 250) {
  const winSize = Math.round(0.15 * fs);
  const refractory = Math.round(0.2 * fs);
  // The band-pass + derivative + integration chain delays the detection point
  // well past the true R-peak. Compensate the group delay so reported beat times
  // line up with the peak (keeps TILE 3's R-peak ticks on the QRS complexes).
  // ~ lowpass 6 + highpass 16 + derivative 2 + half the integration window.
  const groupDelaySamples = 6 + 16 + 2 + Math.floor(winSize / 2);
  const delayMs = (groupDelaySamples / fs) * 1000;

  let lpx = [], lpy = [], hpx = [], hpy = [], deriv = [], mwi = [], mwiSum = 0;
  let threshold = 0, signalPeak = 0, noisePeak = 0, lastPeakValue = 0, rising = false;
  let n = 0, lastBeatSample = -1e9, detected = 0;

  const lowPass = (x) => {
    lpx.push(x); if (lpx.length > 13) lpx.shift();
    const x6 = lpx[lpx.length - 7] ?? 0;
    const x12 = lpx[lpx.length - 13] ?? 0;
    const y1 = lpy[lpy.length - 1] ?? 0;
    const y2 = lpy[lpy.length - 2] ?? 0;
    const y = 2 * y1 - y2 + x - 2 * x6 + x12;
    lpy.push(y); if (lpy.length > 3) lpy.shift();
    return y;
  };
  const highPass = (x) => {
    hpx.push(x); if (hpx.length > 33) hpx.shift();
    const x16 = hpx[hpx.length - 17] ?? 0;
    const x17 = hpx[hpx.length - 18] ?? 0;
    const x32 = hpx[hpx.length - 33] ?? 0;
    const y1 = hpy[hpy.length - 1] ?? 0;
    const y = y1 - x / 32 + x16 - x17 + x32 / 32;
    hpy.push(y); if (hpy.length > 2) hpy.shift();
    return y;
  };
  const differentiate = (x) => {
    deriv.push(x); if (deriv.length > 5) deriv.shift();
    const [a = 0, b = 0, , d = 0, e = 0] = deriv.slice(-5);
    return (2 * e + d - b - 2 * a) / 8;
  };
  const integrate = (x) => {
    mwi.push(x); mwiSum += x;
    if (mwi.length > winSize) mwiSum -= mwi.shift();
    return mwiSum / mwi.length;
  };

  return {
    get detected() {
      return detected;
    },
    reset() {
      lpx = []; lpy = []; hpx = []; hpy = []; deriv = []; mwi = []; mwiSum = 0;
      threshold = 0; signalPeak = 0; noisePeak = 0; lastPeakValue = 0; rising = false;
      n = 0; lastBeatSample = -1e9; detected = 0;
    },
    push(raw, tMs) {
      const filtered = highPass(lowPass(raw));
      const d = differentiate(filtered);
      const integrated = integrate(d * d);
      n++;

      if (n < fs) {
        signalPeak = Math.max(signalPeak, integrated);
        threshold = 0.3 * signalPeak;
        return null;
      }

      let beat = null;
      if (integrated > lastPeakValue) {
        rising = true;
        lastPeakValue = integrated;
      } else if (rising && integrated < lastPeakValue * 0.7) {
        rising = false;
        const peak = lastPeakValue;
        lastPeakValue = integrated;
        if (peak > threshold && n - lastBeatSample > refractory) {
          signalPeak = 0.125 * peak + 0.875 * signalPeak;
          const intervalMs = ((n - lastBeatSample) / fs) * 1000;
          lastBeatSample = n;
          detected++;
          beat = {
            t: Math.round(tMs - delayMs),
            bpm: intervalMs > 0 && intervalMs < 60000 ? Math.round(60000 / intervalMs) : null,
            intervalMs: Math.round(intervalMs),
          };
        } else {
          noisePeak = 0.125 * peak + 0.875 * noisePeak;
        }
        threshold = noisePeak + 0.25 * (signalPeak - noisePeak);
      }
      return beat;
    },
  };
}
