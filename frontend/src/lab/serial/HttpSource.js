// Real ESP32 over WiFi instead of USB: polls the device's /stream endpoint
// once a second and feeds the result through the same Section 7 parser the
// serial sources use. The tiles can't tell this apart from WebSerialSource.
//
// Why polling can still drive a 250 Hz waveform: /stream returns every ECG
// sample the device took since the previous poll (~250 of them), not a single
// instantaneous reading. Each response is then *replayed* locally at the real
// sample rate — 25-sample batches spaced 100 ms apart — so the ECG tile sweeps
// smoothly and the QRS detector sees a continuous signal.
//
// The cost is latency, not fidelity: everything on screen is up to ~1 s behind
// the patient. For recording medians and a 10 s ECG segment that is harmless.
// For watching a live trace while adjusting electrodes, USB is better.
import { SerialSource } from './SerialSource.js';

const DEFAULT_POLL_MS = 1000;
const ECG_BATCH = 25;

export function normaliseDeviceUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Accept a bare host ("192.168.82.128"), the root page, or an explicit path.
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/stream';
  return url.toString();
}

export class HttpSource extends SerialSource {
  constructor({ url, pollMs = DEFAULT_POLL_MS } = {}) {
    super();
    this.url = normaliseDeviceUrl(url);
    this.pollMs = pollMs;
    this._timers = [];
    this._pollTimer = null;
    this._running = false;
    this._consecutiveFailures = 0;
    this.lastSensors = null;
  }

  async start() {
    if (this._running) return;
    if (!this.url) {
      this._setState('error');
      throw new Error('Enter the ESP32 address, e.g. 192.168.82.128');
    }
    this._setState('connecting');

    // One probe before claiming success, so a wrong address or an older
    // firmware without /stream reports an error instead of hanging on
    // "connecting" forever.
    try {
      await this._poll(true);
    } catch (err) {
      this._setState('error');
      throw err;
    }

    this._running = true;
    this._setState('streaming');
    this._pollTimer = setInterval(() => {
      this._poll(false).catch(() => {});
    }, this.pollMs);
  }

  async _poll(isProbe) {
    let res;
    try {
      res = await fetch(this.url, { cache: 'no-store', signal: AbortSignal.timeout(this.pollMs * 2) });
    } catch (err) {
      // A CORS rejection and an unreachable host look identical from here;
      // both surface as a TypeError with no status.
      if (isProbe) {
        throw new Error(
          `Could not reach ${this.url}. Check the address, that the laptop is on the same network, ` +
            'and that the firmware is new enough to serve /stream with CORS enabled.',
        );
      }
      this._noteFailure();
      return;
    }

    if (!res.ok) {
      if (isProbe) throw new Error(`Device responded ${res.status} for ${this.url}`);
      this._noteFailure();
      return;
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      if (isProbe) throw new Error('Device response was not JSON — is this the /stream endpoint?');
      this._noteFailure();
      return;
    }

    if (isProbe && !Array.isArray(payload.ecg)) {
      throw new Error(
        'Device replied without an "ecg" array. This looks like the old /data endpoint, ' +
          'which only carries one sample — reflash with the current firmware.',
      );
    }

    this._consecutiveFailures = 0;
    if (payload.sensors) this.lastSensors = payload.sensors;
    if (payload.rate) this.ecgSampleRateHz = payload.rate;
    this._dispatch(payload);
  }

  _noteFailure() {
    this._consecutiveFailures++;
    // Three missed polls in a row is a real dropout, not a blip. Freeze the
    // tiles rather than letting them show stale values as if they were live.
    if (this._consecutiveFailures >= 3 && this.state === 'streaming') {
      this._setState('error');
    }
  }

  // Spread one response across the poll interval so the tiles animate at the
  // device's real rate instead of jumping once a second.
  _dispatch(payload) {
    this._clearTimers();

    const samples = Array.isArray(payload.ecg) ? payload.ecg : [];
    const rate = payload.rate || this.ecgSampleRateHz || 250;
    const batchMs = (ECG_BATCH / rate) * 1000; // 100 ms at 250 Hz
    const t0 = Number(payload.t) || 0;
    const batches = Math.floor(samples.length / ECG_BATCH);

    for (let b = 0; b < batches; b++) {
      const slice = samples.slice(b * ECG_BATCH, (b + 1) * ECG_BATCH);
      const t = t0 + Math.round(b * batchMs);
      const id = setTimeout(() => {
        if (this.state !== 'streaming') return;
        this._ingestLine(JSON.stringify({ t, ecg: slice }));
      }, Math.round(b * batchMs));
      this._timers.push(id);
    }

    // Numerics at 10 Hz, matching the serial protocol. The device only gives
    // us one snapshot per poll, so the same values repeat across the interval
    // — that is what keeps the dashboard's freshness check satisfied.
    const numericSteps = Math.max(1, Math.round(this.pollMs / 100));
    for (let i = 0; i < numericSteps; i++) {
      const t = t0 + i * 100;
      const line = {
        t,
        hr: payload.hr ?? null,
        spo2: payload.spo2 ?? null,
        temp: payload.temp ?? null,
        lo: payload.lo ?? false,
      };
      if (payload.rr != null) line.rr = payload.rr;
      if (payload.accel) line.accel = payload.accel;
      if (payload.pi != null) line.pi = payload.pi;

      const id = setTimeout(() => {
        if (this.state !== 'streaming') return;
        this._ingestLine(JSON.stringify(line));
      }, i * 100);
      this._timers.push(id);
    }
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers = [];
  }

  async stop() {
    this._running = false;
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    this._clearTimers();
    this._setState('disconnected');
  }
}
