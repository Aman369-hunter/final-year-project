# Lab dashboard — Phase 3 notes (Section 6.2)

Built on 2026-11-15. The lab dashboard captures device vitals and lab values and shows **no predictions anywhere** (Section 6.2 / 6.4 rule 5, enforced server-side too).

## Verification done first (per the brief)

- Spec 3.1a (reference ranges), 3.1b (canonical names) and 3.2 (ranking) re-read.
- Engine restarted; the seeded clear-Gaucher case returns **HIGH, Gaucher rank 1, absolute_risk 0.78** (target ~0.75). ✓
- The `mps_i → mps1` translation layer is **removed**; `mps1` is canonical end to end (engine, contract guard, fixtures, UI).
- Differential cards #2 and #3 now filter `factors[]` by the `disease` key, so they show real headline factors instead of "No scoring rule fired".
- Fixtures and the doctor demo cases now carry reference ranges (Section 3.1a); the backend rejects an enzyme/biomarker with no range (`400 validation_failed`).

## Device capture (STEP 1–4)

```
SerialSource (interface)
 ├─ ReplaySource     fixtures/serial-replay.jsonl, real-time, no hardware
 └─ WebSerialSource  real ESP32, 115200 baud, Chrome/Edge
          │  Section 7 protocol: JSON lines, numerics ~10 Hz, ECG batches 250 Hz
          ▼
VitalsMonitor  ── QRS worker (Pan-Tompkins, off-thread)
          │        beats ─► TILE 1 pulse, TILE 3 R-peak ticks
          ▼
 5 tiles read the same monitor; identical with replay or real hardware
```

- **The UI never knows which source it has.** `ReplaySource` and `WebSerialSource` emit the same `numeric` / `ecg` / `status` events through the shared parser.
- **No sample arrays in React state.** ECG samples land in a ring buffer the canvas reads each frame; numeric snapshots are throttled to 10 Hz; all waveforms draw to `<canvas>` via `requestAnimationFrame`.
- **QRS detection runs in a Web Worker** (`workers/qrs.worker.js` wrapping the pure `qrsDetector.js`): band-pass → differentiate → square → moving-window integrate → adaptive threshold, with group-delay compensation so reported R-peak times line up with the complexes. Against the replay fixture's own ground-truth beats: **100% sensitivity, 98.8% precision** (`qrs.test.js`). Swap in the BIDMC PhysioNet record for the number that goes in the report.

### The five tiles

| Tile | Sensor | Animation | Alert thresholds |
|---|---|---|---|
| Heart rate | MAX30102 | heart pulses once per detected beat, pulse scaled to the RR interval; scrolling PPG canvas | green 60–100, else amber |
| SpO₂ | MAX30102 | circular ring fills to value, tweened % | amber < 94, red < 90 |
| ECG | AD8232 | bedside sweep, leading cursor erasing ahead; 250→50 Hz decimation; R-peak ticks; lead-off label | amber trace on lead-off |
| Temperature | DS18B20 | vertical thermometer fill | amber outside 36.1–37.5 |
| Motion | MPU6050 | live X/Y/Z bars, tremor sparkline (30 s), mobility meter | — |

Per-tile state is **no-signal / poor-signal / live**, driven by the sensor itself (MAX30102 perfusion index, AD8232 lead-off, stream freshness). A sensor absent from the stream shows a placeholder, never stale or zero values. On a mid-session disconnect the tiles **freeze and dim with a "signal lost" overlay** (try the "Simulate dropout" button on the replay source); values are not zeroed.

## Recording (STEP 3)

Start → Stop and review → Save to case, or Discard and re-record. On save the dashboard `PATCH`es `/api/cases/:id/vitals` with the **summary only**: median HR, median SpO₂, temperature, respiratory rate, arrhythmia flag, tremor index, mobility score, plus one **10 s raw ECG segment** (2500 samples @ 250 Hz).

## Rest of the dashboard (STEP 5)

- **Worklist:** `SUBMITTED` cases to claim, plus this facility's in-progress and returned cases.
- **Labs entry:** enzymes and biomarkers each capture their **reference range** (Section 3.1a); the form shows the implied % of normal / × ULN and blocks a value with no range. Canonical analyte names (`alpha_Gal_A`, not `GLA`, etc.).
- **Variant autocomplete:** `GET /api/reference/variants/:gene` serves compact ClinVar tables built from `data/variants/` into `data/variants/autocomplete/` (8 genes, ~4,500 pathogenic/likely-pathogenic variants). The genetics field filters as you type.
- **Sample rejection:** reason required → `LAB_REJECTED`.
- **Submit:** → `DOCTOR_REVIEW`, which triggers engine scoring.

## New backend surface

- `GET /api/reference/variants` and `/api/reference/variants/:gene` (any signed-in role; no patient data).
- `labs.enzymes[]` / `labs.biomarkers[]` now accept `reference_low` / `reference_high` / `reference_mean` (Section 3.1a), and **require at least one** form of reference range.

## Auth note

Unlike the doctor dashboard (fixtures, no login), the lab dashboard writes real data, so it signs in as a `lab` user and talks to the live backend (`/lab`). Access + refresh tokens via the Phase 1 auth; the lab still never receives prediction data (checked in `engineProxy`/`predictionFiltering` tests and live).

## Not done

- Beat-detection accuracy is measured against the **synthetic** replay fixture, not BIDMC yet (Section 7 asks for BIDMC — a Phase 6 metric).
- `WebSerialSource` is written to the spec but untested here (no ESP32 on this machine); it shares the parser and event surface the tests cover via `ReplaySource`.
- `respiratory_rate_bpm` in the saved summary is the last streamed value, not a median (the device reports it directly).
