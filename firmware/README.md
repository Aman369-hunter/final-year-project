# firmware/ — Track A (ESP32, Arduino)

MAX30105 · AD8232 · DS18B20 · MPU6050 → USB serial → lab dashboard (Web Serial).

Sketch: [`lsd_cdss_esp32/lsd_cdss_esp32.ino`](lsd_cdss_esp32/lsd_cdss_esp32.ino).
Speaks the frozen serial protocol in `docs/LSD_CDSS_SPEC.md` Section 7, so the lab
dashboard treats it exactly like the replay fixture — no frontend changes needed.

## Wiring

| Component | Pin | Note |
|---|---|---|
| MAX30105 (or MAX30102) | SDA **GPIO21**, SCL **GPIO22** | I2C addr 0x57 |
| MPU6050 | same I2C bus | addr 0x68 (AD0 to GND), no clash |
| DS18B20 | DQ **GPIO19** | **needs a 4.7 kΩ pull-up from DQ to 3.3 V** |
| AD8232 OUTPUT | **GPIO34** | ADC1 — mandatory, ADC2 is dead while WiFi is on |
| AD8232 LO+ | GPIO13 | lead-off detect |
| AD8232 LO− | GPIO32 | lead-off detect |

All sensors run on 3.3 V, not 5 V.

## Arduino IDE setup

Board: **ESP32 Dev Module**. Install via Library Manager:

- `SparkFun MAX3010x Pulse and Proximity Sensor Library`
- `Adafruit MPU6050` (pulls in `Adafruit Unified Sensor` and `Adafruit BusIO`)
- `OneWire`
- `DallasTemperature`

On Windows you also need the USB-serial driver for your board — **CP2102** or
**CH340** depending on the variant — or no COM port appears.

> **Watch for a duplicate `MAX30105.h`.** This machine has both
> `SparkFun_MAX3010x_Pulse_and_Proximity_Sensor_Library` and `DevLab_MAX30102`
> installed, and both ship a `MAX30105.h` plus a `heartRate.h`. Which one wins is
> down to the IDE's library resolution, not your choice. The sketch compiles
> byte-identically against either (DevLab is an API-compatible fork), but if you
> ever hit a confusing `MAX30105`-related error, delete one of the two from
> `Documents/Arduino/libraries` so resolution is unambiguous.

Flash, then close the Arduino Serial Monitor. It holds the port exclusively and
the browser will not be able to open it.

## Running it with the lab dashboard

Two transports, same tiles. Start the stack (see the root README), open
**http://localhost:5173/lab**, sign in as `lab@lsd.test` and claim a `SUBMITTED`
case, then pick one:

### USB — `ESP32 (Web Serial)`

**Chrome or Edge only** (Web Serial does not exist in Firefox or Safari), and the
Arduino Serial Monitor must be closed. Pick the COM port → **Start stream**.
True 250 Hz streaming, no perceptible latency. Use this while adjusting electrodes.

### WiFi — `ESP32 (WiFi)`

Needs `ENABLE_WIFI 1` (the default). Type the device's address — the boot banner
prints it, e.g. `192.168.82.128` — and **Start stream**. Works in any browser, and
the laptop must be on the same network as the ESP32.

The dashboard polls `GET /stream` once a second. That endpoint returns **every ECG
sample taken since the previous poll** (~250 of them), not a single reading, and the
browser replays them locally at 250 Hz in 25-sample batches. So the waveform and
beat detection are complete — the trade-off is **about 1 second of latency**, not
lost fidelity.

> The old `/data` endpoint carries only one instantaneous ECG sample per response,
> so it cannot drive the ECG tile at any poll rate. It is kept for the standalone
> web page; the dashboard needs `/stream`.

Either way: **Record** → **Stop and review** → **Save to case** stores the medians
plus a 10 s ECG segment.

## What the sketch emits

One JSON object per line, newline-terminated, 115200 baud.

ECG — 25 samples per line, every 100 ms (250 Hz):

```json
{"t":12345,"ecg":[512,514,530,...]}
```

Numerics — every 100 ms (10 Hz):

```json
{"t":12345,"hr":78.0,"spo2":97.1,"temp":36.81,"rr":15.9,"accel":{"x":0.010,"y":-0.001,"z":1.006},"pi":1.87,"lo":false}
```

`t` is **milliseconds** from `millis()`, not epoch seconds. It is only ever used
relatively (the dashboard reconstructs each ECG sample as `t + i*4ms` and derives
BPM from beat spacing), so an uptime counter is fine.

### Conventions the dashboard depends on

| Field | Unit | Why |
|---|---|---|
| `ecg` | 0–1023, centred 512 | `EcgTile` draws around `ADC_MID = 512`. The ESP32 ADC is 12-bit, so every sample is `raw >> 2`. |
| `accel` | **g**, not m/s² | `VitalsMonitor` removes gravity as `z - 1.0`. Adafruit reports m/s², so the sketch divides by 9.80665. |
| `pi` | percent | Quality gate marks HR/SpO₂ *poor-signal* below `0.3`. |
| `temp` | °C | Always present, `null` when there is no probe — the parser **drops any numeric line carrying none of `hr`/`spo2`/`temp`**, which would silently kill the motion tile too. |
| `hr`, `spo2` | `null` when invalid | Never `0`; a literal zero renders as a real measurement. |

## Design notes

**The ECG sampler owns core 0.** Sampling must be an even 250 Hz, because the QRS
detector's filter coefficients assume `fs = 250` and timestamps are reconstructed
arithmetically. I2C reads for the other sensors take 1–3 ms and would swallow whole
samples in a shared loop, so `ecgTask` is pinned to core 0 and does nothing else,
while `loop()` on core 1 handles I2C, serial and WiFi. They share a
single-producer/single-consumer ring buffer, so no mutex is needed.

**WiFi is off by default** (`#define ENABLE_WIFI 0`). The original standalone web
dashboard is preserved behind that flag, but the WiFi stack steals CPU in bursts
that jitter the 250 Hz sampler and show up as a ragged trace. The lab dashboard
talks over USB, so WiFi buys nothing here. GPIO34 is on ADC1, so turning it on will
not break the ECG *reading* — only its timing.

**Boot diagnostics** (`#define DEBUG_BANNER 1`) print an I2C scan and a sensor
roll-call before streaming begins. They are prefixed `#` and are not valid JSON,
which the parser skips. Nothing is printed once streaming starts — a stray line
mid-stream would corrupt a JSON object.

## Caveats worth stating in the report

- **SpO₂ is an estimate.** Ratio-of-ratios over a 1 s window with the standard
  `104 − 17R` approximation on an uncalibrated sensor. Screening-grade triage input,
  not a certified pulse-oximeter reading. Values below 70 % are suppressed rather
  than reported, because the linear approximation stops meaning anything there.
- **Respiratory rate is inferred**, not measured — from respiration-induced
  modulation of the IR baseline, counted over a 30 s window. Chest movement or a
  loose finger will confuse it.
- **Heart rate has two independent sources**: `hr` from the MAX30105's own beat
  detection, and `bpmFromEcg` computed in the browser by the QRS detector from the
  AD8232 trace. They are allowed to disagree; the ECG-derived figure is the better
  one when the leads are attached.
- Per spec Section 7, the app must work fully without a device. Vitals are worth
  ≤10 points and never block a prediction — if nothing connects, use the replay
  fixture.

## Verification done

**Compiles clean** for `esp32:esp32:esp32` (ESP32 Dev Module) on arduino-cli 1.6.0
with ESP32 core 3.3.13 — 998 KB flash (76 %) and 57.7 KB RAM (17 %) with WiFi on,
331 KB (25 %) and 27.5 KB (8 %) with `ENABLE_WIFI 0`. Verified against both
MAX3010x libraries above, with identical output. The only warnings come from inside
third-party libraries (`I2C_BUFFER_LENGTH` redefined by the MAX30105 header, stray
tokens in `OneWire.cpp`), not from this sketch.

**The WiFi path was driven end to end** against a stand-in server replaying the
project's own fixture through the real dashboard: all five tiles went live, the ECG
swept continuously, and a 10 s recording captured **77 beats detected, 76 bpm from
the ECG, 2500 samples @ 250 Hz** — i.e. the 1 Hz poll reconstructs a full-rate
waveform with no gaps.

**Protocol verified against the real consumers.** The sketch's exact output format
was fed through the dashboard's own parser (`frontend/src/lab/serial/SerialSource.js`)
and QRS detector: all line shapes parse, the unit conventions above hold, and the
detector scores **100 % beat sensitivity (80/80)** on 512-centred 10-bit data.

**Not verified on physical hardware** — never flashed to a board, so the sensor
readings themselves and the real AD8232 signal amplitude are still unconfirmed.

Regenerate the no-hardware replay stream with `python3 fixtures/make-serial-replay.py`.
