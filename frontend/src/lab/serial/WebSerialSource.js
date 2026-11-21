// Real ESP32 over the Web Serial API (Section 7: JSON lines, 115200 baud).
// Chrome/Edge only, on localhost or HTTPS. The tiles can't tell this apart from
// ReplaySource — same events, same parser.
import { SerialSource } from './SerialSource.js';

export function webSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export class WebSerialSource extends SerialSource {
  constructor({ baudRate = 115200 } = {}) {
    super();
    this.baudRate = baudRate;
    this._port = null;
    this._reader = null;
    this._keepReading = false;
  }

  async start() {
    if (!webSerialSupported()) {
      this._setState('error');
      throw new Error('Web Serial is not available in this browser. Use Chrome or Edge on localhost or HTTPS.');
    }
    this._setState('connecting');
    try {
      // Must be called from a user gesture (the "Connect device" click).
      this._port = await navigator.serial.requestPort();
      await this._port.open({ baudRate: this.baudRate });
    } catch (err) {
      this._setState(err?.name === 'NotFoundError' ? 'disconnected' : 'error');
      throw err;
    }
    this._keepReading = true;
    this._setState('streaming');
    this._readLoop();
  }

  async _readLoop() {
    const decoder = new TextDecoderStream();
    const closed = this._port.readable.pipeTo(decoder.writable).catch(() => {});
    this._reader = decoder.readable.getReader();
    let buffer = '';
    try {
      while (this._keepReading) {
        const { value, done } = await this._reader.read();
        if (done) break;
        buffer += value;
        // The device newline-terminates every object; split on it.
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) this._ingestLine(line);
        }
        if (buffer.length > 1_000_000) buffer = ''; // runaway guard
      }
    } catch {
      this._setState('error');
    } finally {
      try {
        this._reader.releaseLock();
      } catch {
        /* already released */
      }
      await closed;
    }
  }

  async stop() {
    this._keepReading = false;
    try {
      await this._reader?.cancel();
    } catch {
      /* ignore */
    }
    try {
      await this._port?.close();
    } catch {
      /* ignore */
    }
    this._port = null;
    this._setState('disconnected');
  }
}
