// The hub between a SerialSource, the QRS worker, and the tiles.
//
// Design constraints (spec STEP 2/4 requirements):
//  - ECG samples NEVER enter React state. They land in a ring buffer the ECG
//    canvas reads each frame. Putting a 250 Hz array in state locks the tab.
//  - Numeric readouts update at 10 Hz max. Tiles subscribe to throttled snapshots.
//  - Beats come from the worker, not a timer, so TILE 1 pulses in time with the
//    patient and TILE 3 can tick each R-peak.
//  - Per-tile signal state (no-signal / poor-signal / live) is derived from the
//    sensor itself: MAX30102 perfusion index, AD8232 lead-off, stream freshness.
//  - On disconnect, tiles freeze and dim; values are never zeroed.

const NUMERIC_HZ = 10;
const STALE_MS = 1200; // no fresh numeric within this -> sensor considered absent

export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity);
    this.times = new Float64Array(capacity);
    this.head = 0;
    this.count = 0;
    this.total = 0; // monotonic: samples ever pushed. `count` saturates at capacity, so it cannot tell a reader how many are new.
  }

  push(value, t) {
    this.data[this.head] = value;
    this.times[this.head] = t;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.total++;
  }

  // Copy the most recent n samples in chronological order into out.
  readInto(out, n) {
    const take = Math.min(n, this.count);
    for (let i = 0; i < take; i++) {
      const idx = (this.head - take + i + this.capacity) % this.capacity;
      out[i] = this.data[idx];
    }
    return take;
  }

  clear() {
    this.head = 0;
    this.count = 0;
  }
}

export class VitalsMonitor {
  constructor(source, { ecgSeconds = 6 } = {}) {
    this.source = source;
    this.sampleRate = source.ecgSampleRateHz ?? 250;
    this.ecgRing = new RingBuffer(this.sampleRate * ecgSeconds);
    this.recordRing = new RingBuffer(this.sampleRate * 15); // keep last 15 s for the saved segment

    // Live, non-React mutable state read by canvases every animation frame.
    this.live = {
      hr: null, spo2: null, temp: null, rr: null,
      accel: { x: 0, y: 0, z: 0 }, pi: null, lo: false,
      lastNumericT: 0, lastNumericWall: 0,
      beatTimes: [],        // recent R-peak sample-times (ms) for the ECG ticks
      lastBeatWall: 0, lastIntervalMs: 800,
      accelHistory: [],     // {t, mag} for the motion sparkline (30 s)
      tremorHistory: [],
      connection: source.state,
    };

    // Rolling medians for the saved summary (STEP 3).
    this._hrSamples = [];
    this._spo2Samples = [];
    this._tempSamples = [];
    this._tremorSamples = [];
    this._mobilitySamples = [];
    this._arrhythmia = false;
    this._recording = false;
    this._recordStartT = null;

    this._numericSubs = new Set();
    this._statusSubs = new Set();
    this._snapshot = this._emptySnapshot();
    this._lastEmit = 0;

    this._worker = new Worker(new URL('../workers/qrs.worker.js', import.meta.url), { type: 'module' });
    this._worker.postMessage({ type: 'config', sampleRate: this.sampleRate });
    this._worker.onmessage = (e) => this._onWorker(e.data);

    this._unsub = [
      source.on('numeric', (m) => this._onNumeric(m)),
      source.on('ecg', (m) => this._onEcg(m)),
      source.on('status', (m) => this._onStatus(m)),
    ];
  }

  // ---- subscriptions (React tiles use useSyncExternalStore) ----
  subscribeNumeric(fn) {
    this._numericSubs.add(fn);
    return () => this._numericSubs.delete(fn);
  }

  subscribeStatus(fn) {
    this._statusSubs.add(fn);
    return () => this._statusSubs.delete(fn);
  }

  getSnapshot() {
    return this._snapshot;
  }

  _emptySnapshot() {
    return {
      hr: null, spo2: null, temp: null, rr: null, pi: null, lo: false,
      accel: { x: 0, y: 0, z: 0 }, tremorIndex: 0, mobilityScore: null,
      connection: this.source.state, bpmFromEcg: null, beatsDetected: 0,
      quality: { hr: 'no-signal', spo2: 'no-signal', ecg: 'no-signal', temp: 'no-signal', motion: 'no-signal' },
      frozen: false,
    };
  }

  // ---- stream handlers ----
  _onNumeric(m) {
    const now = performance.now();
    const L = this.live;
    if (m.hr != null) { L.hr = m.hr; this._pushCapped(this._hrSamples, m.hr); }
    if (m.spo2 != null) { L.spo2 = m.spo2; this._pushCapped(this._spo2Samples, m.spo2); }
    if (m.temp != null) { L.temp = m.temp; this._pushCapped(this._tempSamples, m.temp); }
    if (m.rr != null) L.rr = m.rr;
    if (m.pi != null) L.pi = m.pi;
    L.lo = m.lo;
    if (m.accel) {
      L.accel = m.accel;
      const mag = Math.sqrt(m.accel.x ** 2 + m.accel.y ** 2 + (m.accel.z - 1) ** 2); // gravity-removed
      L.accelHistory.push({ t: m.t, mag });
      if (L.accelHistory.length > 300) L.accelHistory.shift(); // 30 s @ 10 Hz
      const tremor = this._tremorIndex();
      L.tremorHistory.push({ t: m.t, v: tremor });
      if (L.tremorHistory.length > 300) L.tremorHistory.shift();
      this._pushCapped(this._tremorSamples, tremor);
      this._pushCapped(this._mobilitySamples, this._mobility(mag));
    }
    L.lastNumericT = m.t;
    L.lastNumericWall = now;
    this._maybeEmit(now);
  }

  _onEcg(m) {
    const dt = 1000 / this.sampleRate;
    for (let i = 0; i < m.samples.length; i++) {
      const t = m.t + i * dt;
      this.ecgRing.push(m.samples[i], t);
      if (this._recording) this.recordRing.push(m.samples[i], t);
    }
    // Hand the batch to the QRS worker off the main thread.
    this._worker.postMessage({ type: 'samples', t: m.t, values: m.samples });
  }

  _onWorker(msg) {
    if (msg.type === 'beat') {
      const L = this.live;
      L.beatTimes.push(msg.t);
      if (L.beatTimes.length > 64) L.beatTimes.shift();
      L.lastBeatWall = performance.now();
      if (msg.intervalMs > 0) L.lastIntervalMs = msg.intervalMs;
      L.bpmFromEcg = msg.bpm;
      // Simple arrhythmia heuristic for the saved summary: wide RR variability.
      this._rrIntervals = (this._rrIntervals ?? []);
      this._rrIntervals.push(msg.intervalMs);
      if (this._rrIntervals.length > 20) this._rrIntervals.shift();
      if (this._rrIntervals.length >= 8) {
        const mean = this._rrIntervals.reduce((a, b) => a + b, 0) / this._rrIntervals.length;
        const sd = Math.sqrt(this._rrIntervals.reduce((a, b) => a + (b - mean) ** 2, 0) / this._rrIntervals.length);
        if (sd / mean > 0.18) this._arrhythmia = true;
      }
    } else if (msg.type === 'stats') {
      this.live.beatsDetected = msg.detected;
    }
  }

  _onStatus(m) {
    this.live.connection = m.state;
    for (const fn of this._statusSubs) fn(m.state);
    this._emit(performance.now(), true);
  }

  // ---- derived quantities ----
  _tremorIndex() {
    // RMS of gravity-removed acceleration over the last ~2 s.
    const recent = this.live.accelHistory.slice(-20);
    if (recent.length === 0) return 0;
    const ms = recent.reduce((a, b) => a + b.mag ** 2, 0) / recent.length;
    return Math.sqrt(ms);
  }

  _mobility(mag) {
    // Smooth, bounded 0..1: more sustained movement -> higher mobility.
    const prev = this._mobilitySamples.at(-1) ?? 0.8;
    const target = Math.max(0, Math.min(1, mag * 6));
    return prev * 0.9 + target * 0.1;
  }

  _pushCapped(arr, v) {
    arr.push(v);
    if (arr.length > 6000) arr.shift();
  }

  _quality() {
    const L = this.live;
    const fresh = performance.now() - L.lastNumericWall < STALE_MS;
    const streaming = L.connection === 'streaming';
    const q = (ok, poor) => (!streaming && L.connection !== 'ended' ? 'no-signal' : !ok ? 'no-signal' : poor ? 'poor-signal' : 'live');
    return {
      hr: q(L.hr != null && fresh, L.pi != null && L.pi < 0.3),
      spo2: q(L.spo2 != null && fresh, L.pi != null && L.pi < 0.3),
      ecg: q(this.ecgRing.count > 0, L.lo), // AD8232 lead-off -> poor
      temp: q(L.temp != null && fresh, false),
      motion: q(L.accelHistory.length > 0 && fresh, false),
    };
  }

  _maybeEmit(now) {
    if (now - this._lastEmit >= 1000 / NUMERIC_HZ) this._emit(now);
  }

  _emit(now, force = false) {
    this._lastEmit = now;
    const L = this.live;
    const frozen = L.connection === 'error' || L.connection === 'ended';
    this._snapshot = {
      hr: L.hr, spo2: L.spo2, temp: L.temp, rr: L.rr, pi: L.pi, lo: L.lo,
      accel: L.accel,
      tremorIndex: L.tremorHistory.at(-1)?.v ?? 0,
      mobilityScore: this._mobilitySamples.at(-1) ?? null,
      connection: L.connection,
      bpmFromEcg: L.bpmFromEcg,
      beatsDetected: L.beatsDetected,
      quality: this._quality(),
      frozen,
      recording: this._recording,
    };
    for (const fn of this._numericSubs) fn(this._snapshot);
    void force;
  }

  // ---- live reads for canvases (not React) ----
  readEcgInto(out, n) {
    return this.ecgRing.readInto(out, n);
  }

  // ---- recording (STEP 3) ----
  startRecording() {
    this._recording = true;
    this._recordStartT = this.live.lastNumericT || Date.now();
    this.recordRing.clear();
    this._hrSamples = []; this._spo2Samples = []; this._tempSamples = [];
    this._tremorSamples = []; this._mobilitySamples = []; this._arrhythmia = false;
  }

  cancelRecording() {
    this._recording = false;
    this.recordRing.clear();
  }

  // Returns the Section 3.1 vitals summary + one 10 s raw ECG segment.
  stopRecording() {
    this._recording = false;
    const seconds = 10;
    const want = this.sampleRate * seconds;
    const buf = new Float32Array(want);
    const got = this.recordRing.readInto(buf, want);
    const samples = Array.from(buf.slice(0, got)).map((v) => Math.round(v));
    return {
      source: 'device',
      heart_rate_bpm: round(median(this._hrSamples)),
      spo2_pct: round(median(this._spo2Samples)),
      temperature_c: round(median(this._tempSamples), 1),
      respiratory_rate_bpm: this.live.rr != null ? Math.round(this.live.rr) : undefined,
      ecg: {
        rhythm: this._arrhythmia ? 'irregular' : 'sinus',
        arrhythmia_flag: this._arrhythmia,
      },
      activity: {
        tremor_index: round(median(this._tremorSamples), 3),
        mobility_score: round(median(this._mobilitySamples), 2),
      },
      ecg_segment: { sample_rate_hz: this.sampleRate, samples },
    };
  }

  destroy() {
    for (const u of this._unsub) u();
    this._worker.terminate();
  }
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round(v, dp = 0) {
  if (v == null) return undefined;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
