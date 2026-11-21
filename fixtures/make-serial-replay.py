#!/usr/bin/env python3
"""Generate fixtures/serial-replay.jsonl: ~60 s of simulated ESP32 output.

Matches the Section 7 serial protocol exactly: one JSON object per line.
  numerics, ~10 Hz : {"t":...,"hr":78,"spo2":97,"temp":36.8,"rr":16,
                      "accel":{"x":..,"y":..,"z":..},"pi":1.8,"lo":false}
  ECG batches, 250 Hz in 25-sample chunks : {"t":...,"ecg":[512,...]}

SIMULATED DATA, NOT A RECORDING FROM A PATIENT. It exists so the lab dashboard
can be built and demonstrated without hardware. Replace it with a real capture
from the ESP32 once firmware is ready; the format is identical either way.

The waveform is a synthetic PQRST built from Gaussians on a 10-bit ADC scale,
which is what the AD8232 feeds an ESP32 ADC pin. It is not physiological truth;
it exists to exercise the drawing and QRS code against a known beat list.

Extra fields beyond Section 7, all optional and ignored by anything that does
not know them:
  pi   MAX30102 perfusion index -> per-tile signal quality
  lo   AD8232 lead-off (LO+ or LO- high) -> electrode detached
  beat ground-truth R-peak marker, for scoring the QRS detector

The session is scripted to exercise the UI: a clean start, an electrode coming
loose, a brief tachycardia, poor perfusion, then recovery.
"""
import json, math, random
from pathlib import Path

random.seed(20261115)

OUT = Path(__file__).resolve().parent / "serial-replay.jsonl"
T0 = 1731650000_000          # ms since epoch
DURATION_S = 60
ECG_HZ = 250
ECG_BATCH = 25               # 25 samples -> one batch every 100 ms
NUM_HZ = 10

BASELINE = 512.0             # 10-bit ADC midpoint


def segments(t):
    """What the session is doing at time t seconds."""
    if t < 8:
        return dict(hr=78, spo2=97, temp=36.8, rr=16, pi=1.9, lead_off=False, motion=0.015)
    if t < 14:
        # electrode works loose: ECG is junk, lead-off asserted, pulse ox fine
        return dict(hr=80, spo2=97, temp=36.9, rr=16, pi=1.8, lead_off=True, motion=0.02)
    if t < 22:
        return dict(hr=84, spo2=97, temp=36.9, rr=17, pi=1.7, lead_off=False, motion=0.018)
    if t < 34:
        # brief tachycardia with a dip in saturation
        f = (t - 22) / 12
        return dict(hr=96 + 42 * math.sin(math.pi * f), spo2=97 - 5 * math.sin(math.pi * f),
                    temp=37.0, rr=22, pi=1.4, lead_off=False, motion=0.06)
    if t < 42:
        # poor perfusion: the finger clip shifts, PI collapses
        return dict(hr=88, spo2=95, temp=37.1, rr=19, pi=0.15, lead_off=False, motion=0.11)
    if t < 52:
        return dict(hr=82, spo2=97, temp=37.0, rr=17, pi=1.6, lead_off=False, motion=0.03)
    return dict(hr=76, spo2=98, temp=36.9, rr=15, pi=2.0, lead_off=False, motion=0.012)


def gauss(x, mu, sigma, amp):
    return amp * math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))


def pqrst(phase, amp_scale=1.0):
    """One beat of a synthetic ECG, phase in [0,1) of the RR interval."""
    ms = phase * 1000.0
    v = 0.0
    v += gauss(ms, 180, 26, 28)     # P
    v -= gauss(ms, 272, 10, 34)     # Q
    v += gauss(ms, 300, 11, 330)    # R
    v -= gauss(ms, 332, 14, 86)     # S
    v += gauss(ms, 460, 46, 62)     # T
    return v * amp_scale


def main():
    lines = []
    beats = []                       # ground-truth R-peak times (ms)

    # ---- ECG, 250 Hz, emitted in 25-sample batches ----
    n_samples = DURATION_S * ECG_HZ
    phase = 0.0
    batch, batch_start_ms = [], 0
    for i in range(n_samples):
        t_s = i / ECG_HZ
        t_ms = T0 + int(t_s * 1000)
        st = segments(t_s)
        rr_interval = 60.0 / st["hr"]            # seconds per beat

        prev_phase = phase
        phase += (1.0 / ECG_HZ) / rr_interval
        if phase >= 1.0:
            phase -= 1.0
        # R peak sits at 0.30 of the beat; record when we cross it
        if prev_phase < 0.30 <= phase or (phase < prev_phase and prev_phase < 0.30):
            beats.append(t_ms + int(1000 * (0.30 - phase) * rr_interval))

        if st["lead_off"]:
            # electrode detached: rail-ish noise, no recoverable signal
            sample = BASELINE + random.gauss(0, 120) + 180 * math.sin(t_s * 2 * math.pi * 50)
        else:
            wander = 7 * math.sin(2 * math.pi * 0.25 * t_s)          # slow baseline drift
            mains = 1.6 * math.sin(2 * math.pi * 50 * t_s)           # 50 Hz hum (India)
            emg = random.gauss(0, 1.5 + 40 * st["motion"])           # movement artefact
            sample = BASELINE + pqrst(phase) + wander + mains + emg

        batch.append(max(0, min(1023, int(round(sample)))))
        if len(batch) == 1:
            batch_start_ms = t_ms
        if len(batch) == ECG_BATCH:
            lines.append((batch_start_ms, {"t": batch_start_ms, "ecg": batch}))
            batch = []

    # ---- numerics, 10 Hz ----
    for i in range(DURATION_S * NUM_HZ):
        t_s = i / NUM_HZ
        t_ms = T0 + int(t_s * 1000)
        st = segments(t_s)
        g = st["motion"]
        obj = {
            "t": t_ms,
            "hr": round(st["hr"] + random.gauss(0, 0.8), 1),
            "spo2": round(min(100, st["spo2"] + random.gauss(0, 0.4)), 1),
            "temp": round(st["temp"] + random.gauss(0, 0.03), 2),
            "rr": round(st["rr"] + random.gauss(0, 0.5), 1),
            "accel": {
                "x": round(random.gauss(0, g), 3),
                "y": round(random.gauss(0, g), 3),
                "z": round(0.98 + random.gauss(0, g), 3),
            },
            "pi": round(max(0.0, st["pi"] + random.gauss(0, 0.05)), 2),
            "lo": st["lead_off"],
        }
        lines.append((t_ms, obj))

    # Interleave by timestamp, as the device would emit them.
    lines.sort(key=lambda x: x[0])
    with OUT.open("w") as fh:
        fh.write(json.dumps({
            "meta": "SIMULATED ESP32 session, not a patient recording",
            "generated_by": "fixtures/make-serial-replay.py",
            "protocol": "spec Section 7", "ecg_sample_rate_hz": ECG_HZ,
            "numeric_rate_hz": NUM_HZ, "duration_s": DURATION_S,
            "t0": T0, "beats": beats,
        }) + "\n")
        for _, obj in lines:
            fh.write(json.dumps(obj, separators=(",", ":")) + "\n")

    print(f"{OUT}: {len(lines)} lines, {len(beats)} beats, "
          f"{DURATION_S}s, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
