// =====================================================================
// LSD-CDSS — Track A firmware
// ESP32 + MAX30105 + AD8232 + DS18B20 + MPU6050
//   -> USB serial (115200) -> lab dashboard via Web Serial
//
// Speaks the frozen Section 7 protocol (docs/LSD_CDSS_SPEC.md):
//
//   {"t":1234567,"ecg":[512,514,...]}                       25 samples / 100 ms = 250 Hz
//   {"t":1234567,"hr":78.0,"spo2":97.1,"temp":36.81,        10 Hz
//    "rr":15.9,"accel":{"x":0.01,"y":0.00,"z":1.01},
//    "pi":1.87,"lo":false}
//
// One JSON object per line, newline-terminated. Nothing else may be
// printed while streaming — a stray debug line would corrupt the stream.
//
// Derived from the project's standalone WiFi monitor sketch; the web
// dashboard is preserved behind ENABLE_WIFI (see note below).
// =====================================================================

#include <Wire.h>

#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// Two different pulse-oximetry chips are in circulation on these boards and
// they share I2C address 0x57, so an address scan cannot tell them apart —
// only the part-ID register (0xFF) can:
//
//   0x15 -> MAX30102 / MAX30105   SparkFun MAX3010x driver
//   0x11 -> MAX30100              oxullo MAX30100lib driver (different
//                                 register map entirely; the SparkFun
//                                 begin() hard-fails on it)
//
// The sketch probes the ID and loads the matching driver, then funnels both
// into the same (ir, red) maths, so SpO2 / PI / RR / beat detection are
// identical whichever chip is fitted.
#include "MAX30105.h"
#include "heartRate.h"
#include <MAX30100.h>

#include <OneWire.h>
#include <DallasTemperature.h>

// =====================================================================
// 0. BUILD OPTIONS
// =====================================================================

// WiFi: the standalone web page AND the /stream endpoint the lab
// dashboard polls over the network (see HttpSource.js). ON by default.
//
// Cost of leaving it on: the WiFi stack steals CPU in bursts, which can
// jitter the 250 Hz ECG sampler. The sampler runs at a priority above
// the WiFi task to limit this, but USB (Web Serial) is still the
// lower-latency, steadier path. GPIO34 is on ADC1, so WiFi never breaks
// the ECG reading itself — only its timing.
//
// Set to 0 for USB-only operation.
#define ENABLE_WIFI 1

// Print a human-readable boot report (I2C scan, which sensors answered)
// BEFORE streaming starts. Safe: the dashboard's parser skips any line
// that is not valid JSON. Set to 0 for an absolutely silent boot.
#define DEBUG_BANNER 1

#if ENABLE_WIFI
#include <WiFi.h>
#include <WebServer.h>
const char *WIFI_SSID = "narzo50i";
const char *WIFI_PASS = "aman123@";
WebServer server(80);
#endif

// =====================================================================
// 1. PINS  (unchanged from the standalone sketch)
// =====================================================================

#define I2C_SDA 21
#define I2C_SCL 22

#define DS18B20_PIN 19

#define ECG_PIN 34  // ADC1 — required, ADC2 dies when WiFi is on
#define LO_MINUS 32
#define LO_PLUS 13

// =====================================================================
// 2. PROTOCOL CONSTANTS  (Section 7 — frozen, do not retune)
// =====================================================================

static const uint32_t ECG_SAMPLE_RATE_HZ = 250;
static const uint32_t ECG_PERIOD_US = 1000000UL / ECG_SAMPLE_RATE_HZ;  // 4000 us
static const uint32_t ECG_BATCH = 25;                                  // 25 @ 250 Hz = 100 ms
static const uint32_t NUMERIC_PERIOD_MS = 100;                         // 10 Hz

// The dashboard's ECG tile centres its trace on ADC_MID = 512, i.e. a
// 10-bit scale. The ESP32 ADC is 12-bit (0..4095, mid 2048), so every
// sample is shifted down two bits: 4095>>2 = 1023, 2048>>2 = 512.
static inline uint16_t toDashboardAdc(uint16_t raw12) { return raw12 >> 2; }

// =====================================================================
// 3. SENSORS
// =====================================================================

Adafruit_MPU6050 mpu;
MAX30105 maxSensor;    // MAX30102 / MAX30105
MAX30100 max30100;     // MAX30100
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);

enum MaxVariant { MAX_NONE = 0, MAX_3010X = 1, MAX_30100 = 2 };
MaxVariant maxVariant = MAX_NONE;
uint8_t maxPartId = 0x00;
uint8_t mpuAddress = 0x00;

bool mpuConnected = false;
bool maxConnected = false;
bool dsConnected = false;

static const uint8_t MAX_I2C_ADDR = 0x57;
static const uint8_t MAX_REG_PART_ID = 0xFF;

// Read the part-ID register directly, before any driver claims the bus.
static uint8_t probeMaxPartId() {
  Wire.beginTransmission(MAX_I2C_ADDR);
  Wire.write(MAX_REG_PART_ID);
  if (Wire.endTransmission(false) != 0) return 0x00;
  if (Wire.requestFrom((uint8_t)MAX_I2C_ADDR, (uint8_t)1) != 1) return 0x00;
  return Wire.read();
}

static const char *maxVariantName() {
  switch (maxVariant) {
    case MAX_3010X: return "MAX30102/05";
    case MAX_30100: return "MAX30100";
    default: return "none";
  }
}

// ---- DS18B20 ----
float bodyTemperature = 0.0f;
bool temperatureValid = false;
unsigned long lastTempRequest = 0;
bool tempConversionPending = false;
static const unsigned long TEMP_INTERVAL = 1000;
static const unsigned long TEMP_CONVERSION_TIME = 800;

// ---- pulse oximeter ----
// "Is there a finger on the sensor?" threshold. The two chips report on very
// different scales — the MAX30102 FIFO is 18-bit, the MAX30100 is 16-bit — so
// this is set per variant at init rather than being one shared constant.
static const long MIN_IR_3010X = 50000;
static const long MIN_IR_30100 = 5000;
long minValidIr = MIN_IR_3010X;

long irValue = 0;
long redValue = 0;

float heartRate = 0;
bool heartRateValid = false;

static const byte RATE_SIZE = 4;
byte rates[RATE_SIZE] = {0};
byte rateSpot = 0;
long lastBeat = 0;

// ---- MPU6050 ----
// Adafruit reports m/s^2; the dashboard expects g (it removes gravity as
// z - 1.0), so every axis is divided by this on the way out.
static const float G_PER_MS2 = 1.0f / 9.80665f;
float accelX = 0, accelY = 0, accelZ = 0;

unsigned long lastMPURead = 0;
static const unsigned long MPU_INTERVAL = 20;

// ---- AD8232 ----
volatile bool leadOff = true;

// =====================================================================
// 4. SpO2 / PERFUSION INDEX
// =====================================================================
// Classic ratio-of-ratios on a 1 s window of the MAX30105's red and IR
// channels (it samples at 100 Hz):
//
//   R     = (AC_red / DC_red) / (AC_ir / DC_ir)
//   SpO2 ~= 104 - 17 * R          empirical, the usual approximation
//   PI    = AC_ir / DC_ir * 100   perfusion index, the dashboard's
//                                 signal-quality gate (poor below 0.3)
//
// This is a screening-grade estimate from an uncalibrated sensor, not a
// certified pulse oximeter reading. Treated as triage input only.

static const int PPG_WINDOW = 100;  // 1 s @ 100 Hz
long irWin[PPG_WINDOW];
long redWin[PPG_WINDOW];
int ppgCount = 0;
int ppgHead = 0;

float spo2Value = 0;
bool spo2Valid = false;
float perfusionIndex = 0;
bool perfusionValid = false;

static void ppgPush(long ir, long red) {
  irWin[ppgHead] = ir;
  redWin[ppgHead] = red;
  ppgHead = (ppgHead + 1) % PPG_WINDOW;
  if (ppgCount < PPG_WINDOW) ppgCount++;
}

static void ppgReset() {
  ppgCount = 0;
  ppgHead = 0;
  spo2Valid = false;
  perfusionValid = false;
  spo2Value = 0;
  perfusionIndex = 0;
}

static void computeSpO2() {
  if (ppgCount < PPG_WINDOW) return;

  long irMin = irWin[0], irMax = irWin[0];
  long redMin = redWin[0], redMax = redWin[0];
  double irSum = 0, redSum = 0;

  for (int i = 0; i < PPG_WINDOW; i++) {
    long v = irWin[i];
    if (v < irMin) irMin = v;
    if (v > irMax) irMax = v;
    irSum += v;

    long r = redWin[i];
    if (r < redMin) redMin = r;
    if (r > redMax) redMax = r;
    redSum += r;
  }

  double irDC = irSum / PPG_WINDOW;
  double redDC = redSum / PPG_WINDOW;
  double irAC = (double)(irMax - irMin);
  double redAC = (double)(redMax - redMin);

  if (irDC <= 0 || redDC <= 0 || irAC <= 0) {
    perfusionValid = false;
    spo2Valid = false;
    return;
  }

  perfusionIndex = (float)(irAC / irDC * 100.0);
  perfusionValid = true;

  double ratio = (redAC / redDC) / (irAC / irDC);
  double spo2 = 104.0 - 17.0 * ratio;

  if (spo2 > 100.0) spo2 = 100.0;
  // Below ~70 the linear approximation is meaningless — report nothing
  // rather than a number a clinician might read as real.
  if (spo2 < 70.0) {
    spo2Valid = false;
    return;
  }
  spo2Value = (float)spo2;
  spo2Valid = true;
}

// =====================================================================
// 5. RESPIRATORY RATE
// =====================================================================
// Respiration slowly modulates the IR baseline (the DC level rises and
// falls with each breath). Track two moving averages of IR — a fast one
// and a slow one — and count the crossings between them over a 30 s
// window. Each full breath gives two crossings.
//
// An estimate, not a measurement. Chest movement or a loose finger will
// confuse it, which is why it is reported only once it is stable.

static const unsigned long RR_WINDOW_MS = 30000;

double irFast = 0, irSlow = 0;
bool irAvgPrimed = false;
bool rrAbove = false;
int rrCrossings = 0;
unsigned long rrWindowStart = 0;
float respiratoryRate = 0;
bool rrValid = false;

static void rrReset() {
  irAvgPrimed = false;
  rrCrossings = 0;
  rrWindowStart = millis();
  rrValid = false;
  respiratoryRate = 0;
}

static void rrUpdate(long ir) {
  if (!irAvgPrimed) {
    irFast = irSlow = (double)ir;
    irAvgPrimed = true;
    rrWindowStart = millis();
    return;
  }

  // ~0.5 s and ~8 s time constants at the MAX30105's 100 Hz sample rate.
  irFast += ((double)ir - irFast) * 0.02;
  irSlow += ((double)ir - irSlow) * 0.00125;

  bool above = irFast > irSlow;
  if (above != rrAbove) {
    rrAbove = above;
    rrCrossings++;
  }

  unsigned long now = millis();
  unsigned long elapsed = now - rrWindowStart;
  if (elapsed >= RR_WINDOW_MS) {
    float breaths = rrCrossings / 2.0f;
    float rr = breaths * (60000.0f / (float)elapsed);
    // Outside this band it is noise, not breathing.
    if (rr >= 5.0f && rr <= 45.0f) {
      respiratoryRate = rr;
      rrValid = true;
    } else {
      rrValid = false;
    }
    rrCrossings = 0;
    rrWindowStart = now;
  }
}

// =====================================================================
// 6. ECG SAMPLER  (core 0)
// =====================================================================
// The ECG must be sampled at a genuine, even 250 Hz: the dashboard
// reconstructs each sample's timestamp as t + i*4ms, and the QRS
// detector's filter coefficients assume fs = 250. I2C reads for the
// other sensors take 1-3 ms, which would swallow whole samples if
// everything shared one loop.
//
// So the ADC sampler owns core 0 and does nothing else, while core 1
// (loop()) handles I2C, serial and WiFi. The buffer between them is a
// single-producer / single-consumer ring, so no mutex is needed.

static const size_t ECG_RING_SIZE = 1024;  // ~4 s of headroom
volatile uint16_t ecgRing[ECG_RING_SIZE];
volatile uint64_t ecgWriteCount = 0;  // total samples ever written
volatile uint64_t ecgReadCount = 0;   // consumed by the USB serial stream
volatile uint64_t httpReadCount = 0;  // consumed by /stream, independently
volatile uint32_t ecgT0Ms = 0;        // millis() at sample #0
volatile bool ecgOverflow = false;

// Timestamp of ECG sample number `index`, in ms. Sampling is a fixed
// 250 Hz off an absolute wake time, so this is exact rather than drifting.
static inline uint32_t ecgSampleTimeMs(uint64_t index) {
  return ecgT0Ms + (uint32_t)(index * 1000ULL / ECG_SAMPLE_RATE_HZ);
}

static void ecgTask(void *arg) {
  (void)arg;

  // Settle the ADC and the AD8232's output filter before sample #0, so
  // the first second of trace is not a startup transient.
  for (int i = 0; i < 50; i++) {
    analogRead(ECG_PIN);
    vTaskDelay(pdMS_TO_TICKS(2));
  }

  ecgT0Ms = millis();
  TickType_t lastWake = xTaskGetTickCount();

  for (;;) {
    uint16_t raw = (uint16_t)analogRead(ECG_PIN);
    leadOff = (digitalRead(LO_PLUS) == HIGH) || (digitalRead(LO_MINUS) == HIGH);

    uint64_t w = ecgWriteCount;
    if (w - ecgReadCount < ECG_RING_SIZE) {
      ecgRing[w % ECG_RING_SIZE] = toDashboardAdc(raw);
      ecgWriteCount = w + 1;
    } else {
      ecgOverflow = true;  // consumer stalled; drop rather than block
    }

    // 250 Hz from the 1 ms FreeRTOS tick: 4 ms exactly. vTaskDelayUntil
    // works off an absolute wake time, so jitter in one iteration does
    // not accumulate into drift across the session.
    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(1000 / ECG_SAMPLE_RATE_HZ));
  }
}

// =====================================================================
// 7. SENSOR READS  (core 1)
// =====================================================================

static void clearHeartRate() {
  heartRate = 0;
  heartRateValid = false;
  for (byte i = 0; i < RATE_SIZE; i++) rates[i] = 0;
  rateSpot = 0;
  lastBeat = 0;
}

// One sample's worth of work, shared by both chips. Everything downstream —
// SpO2, perfusion index, respiratory rate, beat detection — sees the same
// (ir, red) pair regardless of which part is fitted.
static void processPpgSample(long ir, long red) {
  if (ir < minValidIr) {
    // No finger: drop everything derived from the PPG so the dashboard
    // shows no-signal instead of a stale number.
    clearHeartRate();
    ppgReset();
    rrReset();
    return;
  }

  irValue = ir;
  redValue = red;

  ppgPush(ir, red);
  rrUpdate(ir);

  // heartRate.h's detector is sensor-agnostic (DC removal + band-pass on
  // whatever IR stream it is given), so it serves both chips.
  if (checkForBeat(ir)) {
    unsigned long currentTime = millis();
    if (lastBeat != 0) {
      long delta = currentTime - lastBeat;
      if (delta > 0) {
        float bpm = 60000.0f / delta;
        if (bpm >= 30 && bpm <= 220) {
          rates[rateSpot] = (byte)bpm;
          rateSpot = (rateSpot + 1) % RATE_SIZE;

          float total = 0;
          byte count = 0;
          for (byte i = 0; i < RATE_SIZE; i++) {
            if (rates[i] > 0) {
              total += rates[i];
              count++;
            }
          }
          if (count > 0) {
            heartRate = total / count;
            heartRateValid = true;
          }
        }
      }
    }
    lastBeat = currentTime;
  }
}

static void readMAXSensor() {
  if (!maxConnected) return;

  if (maxVariant == MAX_3010X) {
    maxSensor.check();
    while (maxSensor.available()) {
      processPpgSample(maxSensor.getIR(), maxSensor.getRed());
      maxSensor.nextSample();
    }
  } else if (maxVariant == MAX_30100) {
    max30100.update();
    uint16_t ir = 0, red = 0;
    while (max30100.getRawValues(&ir, &red)) {
      processPpgSample((long)ir, (long)red);
    }
  }

  computeSpO2();
}

static void readMPU() {
  if (!mpuConnected) return;
  if (millis() - lastMPURead < MPU_INTERVAL) return;
  lastMPURead = millis();

  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  accelX = a.acceleration.x * G_PER_MS2;
  accelY = a.acceleration.y * G_PER_MS2;
  accelZ = a.acceleration.z * G_PER_MS2;
}

static void readTemperature() {
  if (!dsConnected) return;

  unsigned long now = millis();

  if (!tempConversionPending && now - lastTempRequest >= TEMP_INTERVAL) {
    ds18b20.requestTemperatures();
    lastTempRequest = now;
    tempConversionPending = true;
  }

  if (tempConversionPending && now - lastTempRequest >= TEMP_CONVERSION_TIME) {
    float temperature = ds18b20.getTempCByIndex(0);
    tempConversionPending = false;

    if (temperature != DEVICE_DISCONNECTED_C && temperature >= -55 && temperature <= 125) {
      bodyTemperature = temperature;
      temperatureValid = true;
    } else {
      temperatureValid = false;
    }
  }
}

// =====================================================================
// 8. PROTOCOL OUTPUT
// =====================================================================

static char lineBuf[512];

// {"t":<ms>,"ecg":[...25 ints...]}
static void emitEcgBatch() {
  // Only emit whole batches, so each line is exactly ECG_BATCH samples.
  while (ecgWriteCount - ecgReadCount >= ECG_BATCH) {
    uint64_t start = ecgReadCount;
    uint32_t tMs = ecgSampleTimeMs(start);

    int n = snprintf(lineBuf, sizeof(lineBuf), "{\"t\":%lu,\"ecg\":[", (unsigned long)tMs);
    for (uint32_t i = 0; i < ECG_BATCH; i++) {
      uint16_t s = ecgRing[(start + i) % ECG_RING_SIZE];
      n += snprintf(lineBuf + n, sizeof(lineBuf) - n, i ? ",%u" : "%u", (unsigned)s);
    }
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, "]}\n");

    Serial.write((const uint8_t *)lineBuf, n);
    ecgReadCount = start + ECG_BATCH;
  }
}

// {"t":<ms>,"hr":..,"spo2":..,"temp":..,"rr":..,"accel":{..},"pi":..,"lo":..}
//
// Invalid readings are sent as null rather than 0 — a literal 0 BPM would
// render as a real measurement. "temp" is always present (null if there is
// no probe) because the dashboard's parser only accepts a numeric line
// that carries at least one of hr / spo2 / temp; without it a motion-only
// line would be silently dropped.
static void emitNumeric() {
  uint32_t tMs = millis();
  int n = snprintf(lineBuf, sizeof(lineBuf), "{\"t\":%lu", (unsigned long)tMs);

  if (heartRateValid) {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"hr\":%.1f", heartRate);
  } else {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"hr\":null");
  }

  if (spo2Valid) {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"spo2\":%.1f", spo2Value);
  } else {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"spo2\":null");
  }

  if (dsConnected && temperatureValid) {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"temp\":%.2f", bodyTemperature);
  } else {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"temp\":null");
  }

  if (rrValid) {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"rr\":%.1f", respiratoryRate);
  }

  if (mpuConnected) {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n,
                  ",\"accel\":{\"x\":%.3f,\"y\":%.3f,\"z\":%.3f}", accelX, accelY, accelZ);
  }

  if (perfusionValid) {
    n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"pi\":%.2f", perfusionIndex);
  }

  n += snprintf(lineBuf + n, sizeof(lineBuf) - n, ",\"lo\":%s}\n", leadOff ? "true" : "false");

  Serial.write((const uint8_t *)lineBuf, n);
}

// =====================================================================
// 9. OPTIONAL WIFI DASHBOARD  (unchanged behaviour, off by default)
// =====================================================================

#if ENABLE_WIFI
const char PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>ESP32 Health Monitoring System</title>
<style>
body{font-family:Arial;background:#101827;color:white;text-align:center;margin:0;}
h1{background:#172554;padding:22px;margin:0;}
.container{max-width:850px;margin:auto;padding:15px;}
.card{background:#1e293b;padding:20px;margin:15px 0;border-radius:12px;box-shadow:0 2px 10px #000;}
.value{font-size:30px;font-weight:bold;color:#38bdf8;}
.small{font-size:17px;line-height:1.8;}
.status{font-size:15px;color:#67e8f9;}
</style></head><body>
<h1>ESP32 HEALTH MONITOR</h1>
<div class='container'>
<div class='card'><h2>Heart Rate</h2><div class='value' id='hr'>--</div></div>
<div class='card'><h2>SpO2</h2><div class='value' id='spo2'>--</div></div>
<div class='card'><h2>AD8232 ECG</h2><div class='value' id='ecg'>--</div>
<p class='status' id='lead'>--</p></div>
<div class='card'><h2>DS18B20 Probe Temperature</h2><p class='status' id='dsStatus'>--</p>
<div class='value' id='temp'>-- &deg;C</div></div>
<div class='card'><h2>MPU6050 Motion Sensor</h2><p class='status' id='mpuStatus'>--</p>
<p class='small' id='acc'>--</p></div>
<p>Updates every second</p>
</div>
<script>
function setText(id,t){document.getElementById(id).textContent=t;}
async function refresh(){
 try{
  const d=await (await fetch('/data')).json();
  setText('hr', d.max.connected && d.max.hr>0 ? d.max.hr.toFixed(1)+' BPM' : '--');
  setText('spo2', d.max.spo2>0 ? d.max.spo2.toFixed(1)+' %' : '--');
  setText('ecg', d.ecg.value);
  setText('lead', d.ecg.leadOff ? 'Electrodes not connected' : 'Lead connections detected');
  setText('dsStatus', d.ds.connected ? 'Sensor Connected' : 'Sensor Not Found');
  setText('temp', d.ds.valid ? d.ds.temp.toFixed(2)+' °C' : '-- °C');
  setText('mpuStatus', d.mpu.connected ? 'Sensor Connected' : 'Sensor Not Found');
  setText('acc','X: '+d.mpu.ax.toFixed(2)+'  Y: '+d.mpu.ay.toFixed(2)+'  Z: '+d.mpu.az.toFixed(2)+' g');
 }catch(e){setText('hr','--');}
}
refresh();setInterval(refresh,1000);
</script></body></html>
)rawliteral";

static void handleRoot() { server.send_P(200, "text/html", PAGE); }

// ---------------------------------------------------------------------
// GET /diag — hardware roll-call, so the bus can be inspected over WiFi
// instead of needing a USB cable and the Serial Monitor.
// ---------------------------------------------------------------------
static void handleDiag() {
  String json = "{\"i2c\":[";
  bool first = true;
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      if (!first) json += ",";
      json += "\"0x" + String(address, HEX) + "\"";
      first = false;
    }
  }
  json += "],\"pulseOx\":{\"partId\":\"0x" + String(maxPartId, HEX) + "\"";
  json += ",\"variant\":\"" + String(maxVariantName()) + "\"";
  json += ",\"ok\":" + String(maxConnected ? "true" : "false") + "}";
  json += ",\"mpu\":{\"ok\":" + String(mpuConnected ? "true" : "false");
  json += ",\"addr\":\"0x" + String(mpuAddress, HEX) + "\"}";
  json += ",\"ds18b20\":{\"ok\":" + String(dsConnected ? "true" : "false");
  json += ",\"count\":" + String(ds18b20.getDeviceCount()) + "}";
  json += ",\"ecg\":{\"raw\":" + String(ecgRing[(ecgWriteCount + ECG_RING_SIZE - 1) % ECG_RING_SIZE] << 2);
  json += ",\"leadOff\":" + String(leadOff ? "true" : "false") + "}";
  json += ",\"uptimeMs\":" + String(millis()) + "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

// ---------------------------------------------------------------------
// GET /stream — what the lab dashboard polls (frontend HttpSource.js)
// ---------------------------------------------------------------------
// Returns every ECG sample taken since the previous poll, plus the
// current numerics. The caller replays that second of ECG at 250 Hz, so
// the waveform stays complete even though the fetch happens at 1 Hz —
// unlike /data, which only ever carried a single instantaneous sample.
//
//   {"t":123456,"rate":250,"ecg":[512,...],
//    "hr":78.0,"spo2":97.1,"temp":36.81,"rr":15.9,
//    "accel":{"x":..,"y":..,"z":..},"pi":1.87,"lo":false,
//    "sensors":{"max":true,"mpu":true,"ds":true},"dropped":false}
//
// CORS is wide open: the dashboard is served from localhost:5173 (or any
// lab machine), this is a read-only endpoint on a private network, and
// there is no credential or state behind it to protect.

static const uint32_t HTTP_MAX_SAMPLES = 500;  // 2 s of catch-up, then skip
static char streamBuf[4600];

static void handleStream() {
  uint64_t write = ecgWriteCount;
  uint64_t start = httpReadCount;

  // First poll, or the consumer fell behind far enough that older samples
  // were overwritten: jump to the newest data rather than serve garbage.
  bool dropped = false;
  if (start < write - (uint64_t)ECG_RING_SIZE || write - start > HTTP_MAX_SAMPLES) {
    if (write > HTTP_MAX_SAMPLES) start = write - HTTP_MAX_SAMPLES;
    else start = 0;
    dropped = true;
  }

  uint32_t count = (uint32_t)(write - start);
  // Whole 25-sample batches only, so the consumer can emit protocol-shaped
  // batches without stitching across polls.
  count -= count % ECG_BATCH;

  int n = snprintf(streamBuf, sizeof(streamBuf), "{\"t\":%lu,\"rate\":%u,\"ecg\":[",
                   (unsigned long)ecgSampleTimeMs(start), (unsigned)ECG_SAMPLE_RATE_HZ);

  for (uint32_t i = 0; i < count && n < (int)sizeof(streamBuf) - 32; i++) {
    uint16_t s = ecgRing[(start + i) % ECG_RING_SIZE];
    n += snprintf(streamBuf + n, sizeof(streamBuf) - n, i ? ",%u" : "%u", (unsigned)s);
  }
  httpReadCount = start + count;

  n += snprintf(streamBuf + n, sizeof(streamBuf) - n, "]");

  if (heartRateValid) n += snprintf(streamBuf + n, sizeof(streamBuf) - n, ",\"hr\":%.1f", heartRate);
  else n += snprintf(streamBuf + n, sizeof(streamBuf) - n, ",\"hr\":null");

  if (spo2Valid) n += snprintf(streamBuf + n, sizeof(streamBuf) - n, ",\"spo2\":%.1f", spo2Value);
  else n += snprintf(streamBuf + n, sizeof(streamBuf) - n, ",\"spo2\":null");

  if (dsConnected && temperatureValid) n += snprintf(streamBuf + n, sizeof(streamBuf) - n, ",\"temp\":%.2f", bodyTemperature);
  else n += snprintf(streamBuf + n, sizeof(streamBuf) - n, ",\"temp\":null");

  if (rrValid) n += snprintf(streamBuf + n, sizeof(streamBuf) - n, ",\"rr\":%.1f", respiratoryRate);
  if (mpuConnected) {
    n += snprintf(streamBuf + n, sizeof(streamBuf) - n,
                  ",\"accel\":{\"x\":%.3f,\"y\":%.3f,\"z\":%.3f}", accelX, accelY, accelZ);
  }
  if (perfusionValid) n += snprintf(streamBuf + n, sizeof(streamBuf) - n, ",\"pi\":%.2f", perfusionIndex);

  n += snprintf(streamBuf + n, sizeof(streamBuf) - n,
                ",\"lo\":%s,\"sensors\":{\"max\":%s,\"mpu\":%s,\"ds\":%s},\"dropped\":%s}",
                leadOff ? "true" : "false",
                maxConnected ? "true" : "false",
                mpuConnected ? "true" : "false",
                dsConnected ? "true" : "false",
                dropped ? "true" : "false");

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", streamBuf);
}

static void handleData() {
  String json = "{";
  json += "\"max\":{\"connected\":" + String(maxConnected ? "true" : "false");
  json += ",\"hr\":" + String(heartRateValid ? heartRate : 0.0f, 1);
  json += ",\"spo2\":" + String(spo2Valid ? spo2Value : 0.0f, 1) + "},";
  json += "\"ecg\":{\"value\":" + String(ecgRing[(ecgWriteCount + ECG_RING_SIZE - 1) % ECG_RING_SIZE]);
  json += ",\"leadOff\":" + String(leadOff ? "true" : "false") + "},";
  json += "\"ds\":{\"connected\":" + String(dsConnected ? "true" : "false");
  json += ",\"valid\":" + String(temperatureValid ? "true" : "false");
  json += ",\"temp\":" + String(bodyTemperature, 2) + "},";
  json += "\"mpu\":{\"connected\":" + String(mpuConnected ? "true" : "false");
  json += ",\"ax\":" + String(accelX, 2) + ",\"ay\":" + String(accelY, 2);
  json += ",\"az\":" + String(accelZ, 2) + "}}";
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}
#endif

// =====================================================================
// 10. BOOT DIAGNOSTICS
// =====================================================================

#if DEBUG_BANNER
static void scanI2C() {
  Serial.println("# --- I2C scan ---");
  int devices = 0;
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.print("# I2C device found: 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
      devices++;
    }
  }
  Serial.print("# total I2C devices: ");
  Serial.println(devices);
}
#endif

// =====================================================================
// 11. SETUP
// =====================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

#if DEBUG_BANNER
  Serial.println("# LSD-CDSS Track A firmware — Section 7 serial protocol");
#endif

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);  // 400 kHz: the MAX30105 FIFO needs the bandwidth
#if DEBUG_BANNER
  scanI2C();
#endif

  // ---- AD8232 ----
  pinMode(LO_PLUS, INPUT);
  pinMode(LO_MINUS, INPUT);
  pinMode(ECG_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(ECG_PIN, ADC_11db);  // full 0-3.3 V swing

  // ---- DS18B20 ----
  ds18b20.begin();
  ds18b20.setResolution(12);
  ds18b20.setWaitForConversion(false);
  dsConnected = (ds18b20.getDeviceCount() > 0);

  // ---- MPU6050 ----
  // AD0 low = 0x68, AD0 high (or tied high on some breakouts) = 0x69.
  // Trying only 0x68 makes a correctly-wired board look missing.
  if (mpu.begin(0x68, &Wire)) {
    mpuConnected = true;
    mpuAddress = 0x68;
  } else if (mpu.begin(0x69, &Wire)) {
    mpuConnected = true;
    mpuAddress = 0x69;
  }
  if (mpuConnected) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }

  // ---- pulse oximeter: identify the part, then load its driver ----
  maxPartId = probeMaxPartId();

  if (maxPartId == 0x15) {
    // MAX30102 or MAX30105 — SparkFun MAX3010x driver.
    if (maxSensor.begin(Wire, I2C_SPEED_FAST)) {
      maxVariant = MAX_3010X;
      maxConnected = true;
      minValidIr = MIN_IR_3010X;
      // ledBrightness, sampleAverage, ledMode, sampleRate, pulseWidth, adcRange
      // ledMode 2 = red + IR, which SpO2 needs.
      maxSensor.setup(0x3F, 4, 2, 100, 411, 4096);
      maxSensor.setPulseAmplitudeRed(0x3F);
      maxSensor.setPulseAmplitudeIR(0x3F);
      maxSensor.setPulseAmplitudeGreen(0);
    }
  } else if (maxPartId == 0x11) {
    // MAX30100 — completely different register map, needs its own driver.
    if (max30100.begin()) {
      maxVariant = MAX_30100;
      maxConnected = true;
      minValidIr = MIN_IR_30100;
      max30100.setMode(MAX30100_MODE_SPO2_HR);  // red + IR, required for SpO2
      max30100.setLedsCurrent(MAX30100_LED_CURR_50MA, MAX30100_LED_CURR_27_1MA);
      max30100.setLedsPulseWidth(MAX30100_SPC_PW_1600US_16BITS);
      max30100.setSamplingRate(MAX30100_SAMPRATE_100HZ);
      max30100.setHighresModeEnabled(true);
      max30100.resetFifo();
    }
  }

#if DEBUG_BANNER
  Serial.print("# pulse-ox  partId=0x");
  if (maxPartId < 16) Serial.print("0");
  Serial.print(maxPartId, HEX);
  Serial.print(" -> ");
  Serial.print(maxVariantName());
  Serial.print(maxConnected ? " (ok)" : " (MISSING)");
  if (maxPartId == 0x00) Serial.print("  [nothing answered at 0x57 — check wiring/power]");
  else if (maxVariant == MAX_NONE) Serial.print("  [unknown part id — not a MAX30100/02/05]");
  Serial.println();

  Serial.print("# sensors   MPU6050:");
  if (mpuConnected) { Serial.print("ok@0x"); Serial.print(mpuAddress, HEX); }
  else Serial.print("MISSING");
  Serial.print("  DS18B20:");
  Serial.print(dsConnected ? "ok" : "MISSING");
  Serial.println("  AD8232:analog");
  Serial.println("# streaming Section 7 JSON lines at 115200 — no further debug output");
#endif

#if ENABLE_WIFI
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.on("/stream", handleStream);
  server.begin();
#if DEBUG_BANNER
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("# lab dashboard endpoint: http://");
    Serial.print(WiFi.localIP());
    Serial.println("/stream");
  } else {
    Serial.println("# WiFi NOT connected — /stream unavailable, use USB");
  }
#endif
#endif

  rrReset();

  // ECG sampler pinned to core 0; loop() runs on core 1.
  // The ESP32 WiFi task also lives on core 0 at priority 23, so with WiFi
  // enabled the sampler must sit above it or network bursts would stall
  // sampling and tear the waveform.
  xTaskCreatePinnedToCore(ecgTask, "ecg", 4096, nullptr, configMAX_PRIORITIES - 1, nullptr, 0);
}

// =====================================================================
// 12. MAIN LOOP  (core 1)
// =====================================================================

void loop() {
  static unsigned long lastNumeric = 0;

  readMAXSensor();
  readMPU();
  readTemperature();

  // ECG first: it is the rate-critical line and must not queue behind
  // anything else.
  emitEcgBatch();

  unsigned long now = millis();
  if (now - lastNumeric >= NUMERIC_PERIOD_MS) {
    lastNumeric = now;
    emitNumeric();
  }

#if ENABLE_WIFI
  server.handleClient();

  // Keep the dashboard's endpoint reachable across router hiccups.
  static unsigned long lastWiFiCheck = 0;
  if (now - lastWiFiCheck >= 10000) {
    lastWiFiCheck = now;
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
  }
#endif
}
