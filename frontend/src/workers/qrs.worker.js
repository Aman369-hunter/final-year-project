// QRS worker (Section 7). Thin glue around the pure detector in qrsDetector.js
// so the same code is unit-tested off the main thread. Runs the Pan-Tompkins
// pipeline off the UI thread so 250 Hz sample handling never blocks rendering.
//
//   postMessage({ type:'config', sampleRate })
//   postMessage({ type:'samples', t, values:[...] })   // each ECG batch
//   postMessage({ type:'reset' })
// Worker -> main:
//   { type:'beat', t, bpm, intervalMs }   // one per R-peak -> TILE 1 pulse, TILE 3 ticks
//   { type:'stats', detected }
import { createDetector } from './qrsDetector.js';

let detector = createDetector(250);
let fs = 250;

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'config') {
    fs = msg.sampleRate || 250;
    detector = createDetector(fs);
  } else if (msg.type === 'reset') {
    detector.reset();
  } else if (msg.type === 'samples') {
    const dt = 1000 / fs;
    for (let i = 0; i < msg.values.length; i++) {
      const beat = detector.push(msg.values[i], msg.t + i * dt);
      if (beat) postMessage({ type: 'beat', ...beat });
    }
    postMessage({ type: 'stats', detected: detector.detected });
  }
};
