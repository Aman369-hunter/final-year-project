import { describe, expect, test } from 'vitest';
import { SerialSource } from './SerialSource.js';

// A concrete subclass just to reach the protected parser.
class TestSource extends SerialSource {
  feed(line) {
    this._ingestLine(line);
  }
}

describe('SerialSource protocol parser (Section 7)', () => {
  test('a numeric line becomes a numeric event', () => {
    const s = new TestSource();
    const got = [];
    s.on('numeric', (m) => got.push(m));
    s.feed('{"t":1,"hr":78,"spo2":97,"temp":36.8,"rr":16,"accel":{"x":0.01,"y":0.02,"z":0.98},"pi":1.8,"lo":false}');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ hr: 78, spo2: 97, temp: 36.8, pi: 1.8, lo: false });
    expect(got[0].accel).toEqual({ x: 0.01, y: 0.02, z: 0.98 });
  });

  test('an ECG batch becomes an ecg event with its samples', () => {
    const s = new TestSource();
    const got = [];
    s.on('ecg', (m) => got.push(m));
    s.feed('{"t":2,"ecg":[512,514,530]}');
    expect(got).toEqual([{ t: 2, samples: [512, 514, 530] }]);
  });

  test('lead-off defaults to false when absent', () => {
    const s = new TestSource();
    let m;
    s.on('numeric', (x) => (m = x));
    s.feed('{"t":3,"hr":80}');
    expect(m.lo).toBe(false);
  });

  test('a malformed line is ignored, not thrown', () => {
    const s = new TestSource();
    let fired = false;
    s.on('numeric', () => (fired = true));
    expect(() => s.feed('{not json')).not.toThrow();
    expect(fired).toBe(false);
  });

  test('status transitions emit once', () => {
    const s = new TestSource();
    const states = [];
    s.on('status', (x) => states.push(x.state));
    s._setState('streaming');
    s._setState('streaming'); // duplicate suppressed
    s._setState('ended');
    expect(states).toEqual(['streaming', 'ended']);
  });
});
