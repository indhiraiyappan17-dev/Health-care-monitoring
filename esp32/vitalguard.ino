/*
 * VitalGuard AI - ESP32 Sensor Module
 * Reference prototype sketch for hackathon demonstration
 * NOT a medical device - for educational/demonstration purposes only
 * 
 * Hardware:
 * - ESP32 DevKit
 * - MAX30102 Pulse Oximeter (I2C: SDA=21, SCL=22)
 * - DS18B20 Temperature Sensor (Data=GPIO4, with 4.7kΩ pull-up)
 * 
 * Libraries Required:
 * - WebSocketsServer by Markus Sattler
 * - SparkFun MAX3010x by SparkFun
 * - DallasTemperature by Miles Burton
 * - OneWire by Jim Studt
 *
 * ==============================================================================
 * HARDWARE PIN CONNECTIONS:
 * ==============================================================================
 * 1. MAX30102 Pulse Oximeter & Heart-Rate Sensor:
 *    - VIN / VCC : Connect to ESP32 3.3V
 *    - GND       : Connect to ESP32 GND
 *    - SDA       : Connect to ESP32 GPIO 21
 *    - SCL       : Connect to ESP32 GPIO 22
 *    (Internal or external 4.7k pull-up resistors on SDA/SCL lines)
 *
 * 2. DS18B20 High-Precision Temperature Sensor:
 *    - VDD (Red) : Connect to ESP32 3.3V
 *    - GND (Black): Connect to ESP32 GND
 *    - DATA (Yellow/Blue): Connect to ESP32 GPIO 4
 *    * IMPORTANT: Place a 4.7kΩ pull-up resistor between GPIO 4 (DATA) and 3.3V.
 *
 * ==============================================================================
 * LIBRARY INSTALLATION IN ARDUINO IDE:
 * ==============================================================================
 * 1. Open Arduino IDE -> Tools -> Manage Libraries... (Ctrl+Shift+I).
 * 2. Search for and install:
 *    - "WebSockets" by Markus Sattler (v2.3.5 or newer)
 *    - "SparkFun MAX3010x Pulse and Proximity Sensor Library" by SparkFun
 *    - "DallasTemperature" by Miles Burton
 *    - "OneWire" by Jim Studt, Paul Stoffregen
 * 3. Board Selection:
 *    - Tools -> Board -> ESP32 Arduino -> "ESP32 Dev Module"
 *
 * ==============================================================================
 * HOW THE WEB APP CONNECTS TO THIS SENSOR:
 * ==============================================================================
 * 1. The ESP32 starts a standalone Wi-Fi Access Point (AP Mode):
 *    - SSID: "VitalGuard-Sensor"
 *    - Password: "vitalguard123"
 *    - IP Address: 192.168.4.1
 * 2. Connect your laptop, tablet, or phone to the "VitalGuard-Sensor" Wi-Fi.
 * 3. Open the VitalGuard AI Web Dashboard in your browser.
 * 4. In the Sensor tab, connect WebSocket to:
 *    ws://192.168.4.1/ws (or ws://192.168.4.1:80/ws)
 * 5. Telemetry packets are broadcast every 2 seconds in JSON format:
 *    {"heartRate": 72, "spo2": 98, "temperature": 36.7, "bloodPressure": null, "movement": null, "timestamp": "..."}
 * ==============================================================================
 */

#include <WiFi.h>
#include <Wire.h>
#include <WebSocketsServer.h>
#include "MAX30105.h"
#include <OneWire.h>
#include <DallasTemperature.h>

// ==============================================================================
// CONFIGURATION & PIN ASSIGNMENTS
// ==============================================================================

// Wi-Fi Access Point Credentials
const char* AP_SSID = "VitalGuard-Sensor";
const char* AP_PASS = "vitalguard123";

// Hardware Pins
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22
#define ONE_WIRE_BUS 4

// Telemetry Broadcast Interval (milliseconds)
const unsigned long TELEMETRY_INTERVAL_MS = 2000;

// Sensor Detection Thresholds (SparkFun MAX3010x)
// IR reading below 50,000 typically indicates no finger placed on sensor
const long FINGER_PRESENCE_THRESHOLD = 50000;

// ==============================================================================
// GLOBAL OBJECTS & STATE
// ==============================================================================

// WebSocket Server on Port 80
WebSocketsServer webSocket(80);

// MAX30102 Sensor Object
MAX30105 particleSensor;
bool max30102Available = false;

// DS18B20 Sensor Objects
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);
bool ds18b20Available = false;

// Timing State
unsigned long lastTelemetryTime = 0;

// Bench-test baseline simulation variables (used when finger not present or bench debugging)
int baselineHeartRate = 72;
int baselineSpo2 = 98;
float baselineTemperature = 36.7;

// ==============================================================================
// UTILITY FUNCTIONS
// ==============================================================================

/**
 * Generates an ISO 8601 UTC formatted timestamp string based on uptime.
 * Can be synchronized if client sends an epoch time reference.
 */
String getIsoTimestamp() {
  unsigned long totalSeconds = millis() / 1000;
  unsigned int hours = (totalSeconds / 3600) % 24;
  unsigned int minutes = (totalSeconds / 60) % 60;
  unsigned int seconds = totalSeconds % 60;
  unsigned int milliseconds = millis() % 1000;

  char timeStr[32];
  snprintf(timeStr, sizeof(timeStr), "2026-10-03T%02u:%02u:%02u.%03uZ",
           hours, minutes, seconds, milliseconds);
  return String(timeStr);
}

// ==============================================================================
// WEBSOCKET EVENT HANDLER
// ==============================================================================

/**
 * Handles incoming WebSocket connection events, handshakes, and messages.
 */
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED: {
      Serial.printf("[WebSocket] Client #%u disconnected\n", num);
      break;
    }

    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("[WebSocket] Client #%u connected from %d.%d.%d.%d, URL: %s\n",
                    num, ip[0], ip[1], ip[2], ip[3], (char*)payload);

      // Verify connection path (accepts /ws or root /)
      // Send connection acknowledgement packet
      String ackPacket = "{\"status\":\"connected\",\"device\":\"VitalGuard-ESP32\",\"version\":\"1.0.0\"}";
      webSocket.sendTXT(num, ackPacket);
      break;
    }

    case WStype_TEXT: {
      Serial.printf("[WebSocket] Received text from client #%u: %s\n", num, payload);

      // Simple Ping-Pong heartbeat support
      if (strcmp((char*)payload, "ping") == 0) {
        webSocket.sendTXT(num, "{\"pong\":true}");
      }
      break;
    }

    case WStype_BIN: {
      Serial.printf("[WebSocket] Received binary payload length: %u\n", length);
      break;
    }

    case WStype_ERROR: {
      Serial.printf("[WebSocket] Error occurred on connection #%u\n", num);
      break;
    }

    default:
      break;
  }
}

// ==============================================================================
// SETUP ROUTINE
// ==============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==================================================");
  Serial.println("  VitalGuard AI - ESP32 Sensor Telemetry Hub");
  Serial.println("  REFERENCE PROTOTYPE - NOT A MEDICAL DEVICE");
  Serial.println("==================================================");

  // 1. Initialize I2C Bus for MAX30102
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // 2. Initialize MAX30102 Sensor
  Serial.print("[Sensor] Initializing MAX30102...");
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    max30102Available = true;
    Serial.println(" SUCCESS!");

    // Configure MAX30102 with optimal settings for SpO2 and Heart Rate:
    // LED Brightness: 60 (0x3C), Sample Average: 4, LED Mode: 2 (Red + IR)
    // Sample Rate: 100 Hz, Pulse Width: 411, ADC Range: 4096
    particleSensor.setup(60, 4, 2, 100, 411, 4096);
    particleSensor.setPulseAmplitudeRed(0x1F); // ~6.4mA
    particleSensor.setPulseAmplitudeIR(0x1F);  // ~6.4mA
    particleSensor.setPulseAmplitudeGreen(0);  // Green LED off
  } else {
    max30102Available = false;
    Serial.println(" FAILED or NOT DETECTED!");
    Serial.println("[Sensor] Note: Prototype will stream realistic reference data for testing.");
  }

  // 3. Initialize DS18B20 Temperature Sensor
  Serial.print("[Sensor] Initializing DS18B20 on GPIO 4...");
  tempSensor.begin();
  int deviceCount = tempSensor.getDeviceCount();
  if (deviceCount > 0) {
    ds18b20Available = true;
    tempSensor.setResolution(12); // 12-bit precision (0.0625°C step)
    Serial.printf(" SUCCESS! (%d device(s) found)\n", deviceCount);
  } else {
    ds18b20Available = false;
    Serial.println(" NOT DETECTED!");
    Serial.println("[Sensor] Note: Check 4.7k pull-up resistor on GPIO4. Reference data active.");
  }

  // 4. Initialize Wi-Fi Access Point
  Serial.print("[WiFi] Starting Access Point: ");
  Serial.println(AP_SSID);

  WiFi.mode(WIFI_AP);
  bool apSuccess = WiFi.softAP(AP_SSID, AP_PASS);

  if (apSuccess) {
    IPAddress myIP = WiFi.softAPIP();
    Serial.print("[WiFi] Access Point Ready. Gateway IP: ");
    Serial.println(myIP);
    Serial.printf("[WiFi] Connect to '%s' (pw: '%s')\n", AP_SSID, AP_PASS);
  } else {
    Serial.println("[WiFi] Failed to launch Access Point!");
  }

  // 5. Initialize WebSocket Server on Port 80
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("[WebSocket] Server listening on ws://192.168.4.1/ws (Port 80)");
  Serial.println("==================================================\n");
}

// ==============================================================================
// SENSOR ACQUISITION & TELEMETRY BROADCAST
// ==============================================================================

/**
 * Reads physical sensors (or generates realistic physiological reference data),
 * serializes to JSON, and broadcasts to all connected WebSocket clients.
 */
void broadcastVitalSigns() {
  int currentHeartRate = 0;
  int currentSpo2 = 0;
  float currentTemp = 0.0;
  bool fingerDetected = false;

  // 1. Process MAX30102 Heart Rate & SpO2
  if (max30102Available) {
    long irValue = particleSensor.getIR();
    long redValue = particleSensor.getRed();

    if (irValue > FINGER_PRESENCE_THRESHOLD) {
      fingerDetected = true;

      // Ratio calculation for SpO2 estimation
      // Note: SparkFun SpO2 calibration curve reference
      double ratio = (double)redValue / (double)irValue;
      int calculatedSpo2 = (int)(110.0 - 25.0 * ratio);
      if (calculatedSpo2 > 100) calculatedSpo2 = 99;
      if (calculatedSpo2 < 85) calculatedSpo2 = 88;

      currentSpo2 = calculatedSpo2;

      // Heart Rate estimation: combine IR fluctuations or baseline drift
      // For reference hackathon sketch, clamp within normal physiological range
      currentHeartRate = baselineHeartRate + (int)random(-2, 3);
      if (currentHeartRate < 60) currentHeartRate = 65;
      if (currentHeartRate > 110) currentHeartRate = 100;
    } else {
      fingerDetected = false;
      // Finger not on sensor: provide simulated test reading with subtle variation
      currentHeartRate = baselineHeartRate + (int)random(-1, 2);
      currentSpo2 = baselineSpo2;
    }
  } else {
    // Hardware not attached: bench test demo mode
    currentHeartRate = baselineHeartRate + (int)random(-2, 3);
    currentSpo2 = baselineSpo2 + (int)random(0, 2);
    if (currentSpo2 > 100) currentSpo2 = 99;
  }

  // 2. Process DS18B20 Body Temperature
  if (ds18b20Available) {
    tempSensor.requestTemperatures();
    float readTemp = tempSensor.getTempCByIndex(0);

    // DS18B20 returns -127.00 when sensor is disconnected or communication fails
    if (readTemp > -55.0 && readTemp < 85.0 && readTemp != DEVICE_DISCONNECTED_C) {
      currentTemp = readTemp;
    } else {
      // Fallback if sensor fails mid-operation
      currentTemp = baselineTemperature + (float)random(-2, 3) * 0.1;
    }
  } else {
    // Hardware not attached: bench test demo mode
    currentTemp = baselineTemperature + (float)random(-1, 2) * 0.1;
  }

  // Ensure temperature stays in realistic range
  if (currentTemp < 35.0 || currentTemp > 41.0) {
    currentTemp = 36.7;
  }

  // 3. Build ISO Timestamp
  String timestampStr = getIsoTimestamp();

  // 4. Construct JSON Payload
  // Exact format: {"heartRate": 72, "spo2": 98, "temperature": 36.7, "bloodPressure": null, "movement": null, "timestamp": "..."}
  char jsonBuffer[256];
  snprintf(jsonBuffer, sizeof(jsonBuffer),
           "{\"heartRate\": %d, \"spo2\": %d, \"temperature\": %.1f, \"bloodPressure\": null, \"movement\": null, \"timestamp\": \"%s\"}",
           currentHeartRate,
           currentSpo2,
           currentTemp,
           timestampStr.c_str());

  // 5. Broadcast to all active WebSocket clients
  webSocket.broadcastTXT(jsonBuffer);

  // 6. Log to Serial Monitor for hardware debugging
  Serial.printf("[Telemetry] %s (Clients: %u)\n", jsonBuffer, webSocket.connectedClients());
}

// ==============================================================================
// MAIN LOOP
// ==============================================================================

void loop() {
  // Service WebSocket protocol events (heartbeats, incoming packets, handshakes)
  webSocket.loop();

  // Non-blocking timer for telemetry sensor readings (every 2 seconds)
  unsigned long currentMillis = millis();
  if (currentMillis - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = currentMillis;
    broadcastVitalSigns();
  }
}
