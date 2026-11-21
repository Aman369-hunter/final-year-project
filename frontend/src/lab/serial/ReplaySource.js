// Replays fixtures/serial-replay.jsonl in real time (no hardware). Honours each
// line's own timestamp, so numerics arrive at ~10 Hz and ECG batches at 250 Hz,
// exactly as a device would send them. Used on machines without an ESP32 and in
// the viva demo. Identical event surface to WebSerialSource.
import { SerialSource } from './SerialSource.js';
import replayUrl from '@fixtures/serial-replay.jsonl?url';

export class ReplaySource extends SerialSource {
  constructor({ loop = true, speed = 1 } = {}) {
    super();
    this.loop = loop;
    this.speed = speed;
    this._timers = [];
    this._running = false;
  }

  async start() {
    if (this._running) return;
    this._running = true;
    this._setState('connecting');
    let text;
    try {
      text = await (await fetch(replayUrl)).text();
    } catch {
      this._setState('error');
      return;
    }
    const lines = text.split('\n').filter(Boolean);
    const header = JSON.parse(lines[0]);
    this.ecgSampleRateHz = header.ecg_sample_rate_hz ?? 250;
    this.meta = header;
    this._events = lines.slice(1).map((l) => JSON.parse(l));
    this._t0 = this._events[0]?.t ?? 0;
    this._setState('streaming');
    this._schedule();
  }

  _schedule() {
    const startWall = performance.now();
    for (const obj of this._events) {
      const due = ((obj.t - this._t0) / this.speed);
      const id = setTimeout(() => {
        if (!this._running) return;
        // Re-stringify so the shared parser is the single ingestion path.
        this._ingestLine(JSON.stringify(obj));
      }, Math.max(0, due - (performance.now() - startWall)));
      this._timers.push(id);
    }
    const lastDue = (this._events.at(-1).t - this._t0) / this.speed;
    this._timers.push(
      setTimeout(() => {
        if (!this._running) return;
        if (this.loop) {
          this._clearTimers();
          this._schedule();
        } else {
          this._setState('ended');
          this._running = false;
        }
      }, lastDue + 50),
    );
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id);
    this._timers = [];
  }

  async stop() {
    this._running = false;
    this._clearTimers();
    this._setState('disconnected');
  }

  // Test / demo hook: inject a disconnect mid-session.
  simulateDisconnect() {
    this._running = false;
    this._clearTimers();
    this._setState('error');
  }
}
