// Pure motion maths for the sensor tiles. No DOM, no React: everything here is unit
// tested (motion.test.js) so the visuals' timing is verified rather than eyeballed.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const easeOutCubic = (u) => 1 - (1 - clamp(u)) ** 3;
export const easeInOutSine = (u) => -(Math.cos(Math.PI * clamp(u)) - 1) / 2;
export const lerp = (a, b, k) => a + (b - a) * k;

// Frame-rate-independent smoothing factor: k = 1 - e^(-rate·dt).
export const smoothK = (rate, dt) => 1 - Math.exp(-rate * dt);

// ---- heartbeat ------------------------------------------------------------
// A two-phase beat envelope in [0, 1], scaled to the patient's real RR interval:
//   systole   a quick, sharp ease-out rise, ~120 ms (shorter at very fast rates)
//   diastole  a slower ease-in-out relaxation back to rest
// A single linear scale pulse looks cheap; this has the snap and the settle.
export function beatTimings(rrMs) {
  const rr = clamp(rrMs, 300, 2000);
  const systole = clamp(rr * 0.16, 70, 120);
  const diastole = rr * 0.6;
  return { systole, diastole, total: systole + diastole };
}

export function beatPulse(msSinceBeat, rrMs) {
  if (!(msSinceBeat >= 0)) return 0;
  const { systole, diastole } = beatTimings(rrMs);
  if (msSinceBeat < systole) return easeOutCubic(msSinceBeat / systole);
  const u = (msSinceBeat - systole) / diastole;
  return u >= 1 ? 0 : 1 - easeInOutSine(u);
}

// Progress 0→1 of the faint expanding ring that follows each beat.
export const ringProgress = (msSinceBeat, rrMs) => clamp(msSinceBeat / (clamp(rrMs, 300, 2000) * 0.9));

// ---- pulse wave (PPG) -----------------------------------------------------
// One cardiac cycle of a photoplethysmogram, phase in [0, 1): fast systolic upstroke,
// slower decay, then the dicrotic wave. Asymmetric on purpose.
const g = (x, mu, s) => Math.exp(-((x - mu) ** 2) / (2 * s * s));
export function ppgShape(phase) {
  const ph = ((phase % 1) + 1) % 1;
  const systolic = ph < 0.16 ? g(ph, 0.16, 0.045) : g(ph, 0.16, 0.08);
  return clamp(systolic * 0.95 + g(ph, 0.42, 0.05) * 0.24, 0, 1); // decay is quick enough to leave a visible dicrotic notch
}

// ---- springs --------------------------------------------------------------
// Second-order spring for numbers and bars. zeta = 1 is critically damped: it reaches
// the target as fast as possible with NO overshoot (the tweened readouts). zeta < 1
// adds a little momentum (the motion bars). Sub-stepped so a long frame (a tab coming
// back to the foreground) cannot blow it up.
export const makeSpring = (x = 0) => ({ x, v: 0 });

export function stepSpring(s, target, dt, { omega = 10, zeta = 1 } = {}) {
  const steps = Math.max(1, Math.ceil(dt * 120));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += (omega * omega * (target - s.x) - 2 * zeta * omega * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
}

// Move an [r, g, b] triple toward a target, in place.
export function lerpTriple(cur, target, k) {
  for (let i = 0; i < 3; i++) cur[i] = lerp(cur[i], target[i], k);
  return cur;
}

export function mixTriple(a, b, k) {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

// ---- ECG sweep ------------------------------------------------------------
// Column for the n-th sample of the sweep: the trace stays put and the cursor moves,
// like a bedside monitor. `window` is the number of samples per full sweep.
export const sweepColumn = (sampleIndex, window, columns) => Math.floor(((sampleIndex % window) / window) * columns);

// Largest-deviation-wins decimation, so a 250 Hz QRS spike is never averaged away.
export const keepPeak = (current, next, baseline = 512) => (Math.abs(next - baseline) > Math.abs(current - baseline) ? next : current);
