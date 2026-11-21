// i2c_scan — wiring diagnostic, not part of the product.
//
// Flash this when the dashboard or the standalone page reports sensors as
// "connected": false. It answers one question only: does the ESP32 see
// anything on the I2C bus at all? That separates a wiring/power fault from
// a sensor-library or firmware problem, which the main sketch cannot do.
//
// Expected on a correctly wired board:
//   0x57  MAX30105 / MAX30102 (pulse oximeter)
//   0x68  MPU6050 (accelerometer, with AD0 tied to GND)
//
// Nothing found => the bus itself is broken: swapped SDA/SCL, no 3.3 V on
// the breakout's VIN, or no common ground. Check those before suspecting
// the sensors. The DS18B20 is NOT on I2C and will never appear here.
//
// Board: ESP32 Dev Module. Open Serial Monitor at 115200 baud.

#include <Wire.h>

#define I2C_SDA 21  // must match lsd_cdss_esp32.ino
#define I2C_SCL 22

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(I2C_SDA, I2C_SCL);
  Serial.println();
  Serial.println("i2c_scan — SDA=GPIO21, SCL=GPIO22, 100 kHz");
}

void loop() {
  int found = 0;

  Serial.println("scanning 0x01..0x7E ...");
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print("  found 0x");
      if (addr < 16) Serial.print('0');
      Serial.print(addr, HEX);
      if (addr == 0x57) Serial.print("  <- MAX30105/MAX30102");
      if (addr == 0x68) Serial.print("  <- MPU6050");
      if (addr == 0x69) Serial.print("  <- MPU6050 (AD0 is HIGH, tie it to GND)");
      Serial.println();
      found++;
    }
    delay(2);
  }

  if (found == 0) {
    Serial.println("  nothing on the bus.");
    Serial.println("  Check, in this order:");
    Serial.println("   1. breakout VIN on 3.3 V (NOT 5 V), GND shared with the ESP32");
    Serial.println("   2. SDA on GPIO21 and SCL on GPIO22, not swapped");
    Serial.println("   3. jumper wires and the breadboard rail actually making contact");
  } else {
    Serial.print("  ");
    Serial.print(found);
    Serial.println(" device(s) answered — the bus is healthy.");
  }

  Serial.println();
  delay(3000);
}
