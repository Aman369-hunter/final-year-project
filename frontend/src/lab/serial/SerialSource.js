// SerialSource: the single interface every tile and the recorder read from.
// The UI never knows whether the bytes come from a replay file (ReplaySource,
// no hardware) or a real ESP32 over WebSerial (WebSerialSource). Both parse the
// Section 7 protocol and emit the same two event kinds.
//
//   source.on('numeric', ({ t, hr, spo2, temp, rr, accel, pi, lo }) => …)   ~10 Hz
//   source.on('ecg',     ({ t, samples }) => …)                              250 Hz, batched
//   source.on('status',  ({ state }) => …)   disconnected|connecting|streaming|error|ended
//
// ECG samples are delivered as plain arrays and must go straight to a ring
// buffer / canvas, never into React state (250 Hz would lock the tab).

export const SOURCE_STATES = ['disconnected', 'connecting', 'streaming', 'error', 'ended'];

export class SerialSource {
  constructor() {
    this._listeners = { numeric: new Set(), ecg: new Set(), status: new Set() };
    this.state = 'disconnected';
    this.ecgSampleRateHz = 250;
  }

  on(event, fn) {
    this._listeners[event]?.add(fn);
    return () => this._listeners[event]?.delete(fn);
  }

  _emit(event, payload) {
    for (const fn of this._listeners[event] ?? []) fn(payload);
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this._emit('status', { state });
  }

  // Parse one protocol line (Section 7) and emit it. Shared by both sources.
  _ingestLine(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // partial or malformed line: skip, never throw into the stream
    }
    if (Array.isArray(obj.ecg)) {
      this._emit('ecg', { t: obj.t, samples: obj.ecg });
    } else if (obj.hr !== undefined || obj.spo2 !== undefined || obj.temp !== undefined) {
      this._emit('numeric', {
        t: obj.t,
        hr: obj.hr, spo2: obj.spo2, temp: obj.temp, rr: obj.rr,
        accel: obj.accel ?? null,
        pi: obj.pi ?? null,          // MAX30102 perfusion index -> signal quality
        lo: obj.lo ?? false,         // AD8232 lead-off
      });
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async start() {
    throw new Error('SerialSource.start() is abstract');
  }

  // eslint-disable-next-line class-methods-use-this
  async stop() {}
}
