/* XIAO ESP32-S3 Sense / OV3660: envia JPEG por HTTPS a Railway.
 * Arduino-ESP32 3.3.x. Placa XIAO_ESP32S3, OPI PSRAM, USB CDC Enabled.
 * Completa config.h. Monitor serie 115200. No requiere assets.h ni SD.
 * El modelo se ejecuta en Railway. La placa hace conexiones salientes:
 * no hay que abrir puertos del router ni mantener un PC conectado.
 */
#include <Arduino.h>
#include <WiFi.h>
#include "esp_camera.h"
#include "esp_http_client.h"
#include "esp_system.h"
#include <time.h>
#include "certificados.h"
#include "capture-schedule.h"
#if __has_include("config.h")
#include "config.h"
#else
#include "config.example.h"
#endif

// Poner false para restaurar la pausa original de CAPTURE_INTERVAL_MS.
static constexpr bool DEMO_MODE = true;
static constexpr uint32_t DEMO_CYCLE_MS = 5000;

static bool configured = false, wifiWasConnected = false;
static uint32_t lastWifiAttempt = 0, lastClockWarning = 0, nextCapture = 0, sequence = 0;
static char bootId[17];

// Se conservan los pines, resolucion y ajustes de tu version funcional.
static esp_err_t initCamera() {
  if (!psramFound()) { Serial.println("ERROR: activa OPI PSRAM."); return ESP_FAIL; }
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = 15; c.pin_d1 = 17; c.pin_d2 = 18; c.pin_d3 = 16;
  c.pin_d4 = 14; c.pin_d5 = 12; c.pin_d6 = 11; c.pin_d7 = 48;
  c.pin_xclk = 10; c.pin_pclk = 13; c.pin_vsync = 38; c.pin_href = 47;
  c.pin_sccb_sda = 40; c.pin_sccb_scl = 39;
  c.pin_pwdn = -1; c.pin_reset = -1;
  c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_SVGA; c.jpeg_quality = 12;
  c.fb_count = 2; c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;
  esp_err_t result = esp_camera_init(&c);
  if (result != ESP_OK) return result;
  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor && sensor->id.PID == OV3660_PID) {
    sensor->set_vflip(sensor, 1);
    sensor->set_brightness(sensor, 1);
    sensor->set_saturation(sensor, -2);
  }
  return ESP_OK;
}

static esp_err_t onHttpEvent(esp_http_client_event_t *event) {
  if (event->event_id == HTTP_EVENT_ON_DATA && event->user_data && event->data_len > 0) {
    String *response = static_cast<String *>(event->user_data);
    const size_t room = response->length() < 768 ? 768 - response->length() : 0;
    const size_t count = static_cast<size_t>(event->data_len) < room ? event->data_len : room;
    if (count) response->concat(static_cast<const char *>(event->data), count);
  }
  return ESP_OK;
}

// HTTPS verifica certificado y nombre del servidor mediante certificados.h.
static bool sendPhoto(camera_fb_t *frame) {
  String response; response.reserve(768);
  esp_http_client_config_t config = {};
  config.url = SERVER_URL;
  config.method = HTTP_METHOD_POST;
  config.cert_pem = TRUSTED_ROOTS;
  config.timeout_ms = 25000;
  config.disable_auto_redirect = true;
  config.event_handler = onHttpEvent; config.user_data = &response;
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) { Serial.println("No se pudo crear el cliente HTTPS."); return false; }
  const String authorization = String("Bearer ") + CAMERA_TOKEN;
  const String frameNumber = String(++sequence);
  esp_http_client_set_header(client, "Authorization", authorization.c_str());
  // El servidor recibe el JPEG como cuerpo binario, sin codificarlo en base64.
  esp_http_client_set_header(client, "Content-Type", "application/octet-stream");
  esp_http_client_set_header(client, "X-Camera-Boot", bootId);
  esp_http_client_set_header(client, "X-Frame-Seq", frameNumber.c_str());
  esp_http_client_set_post_field(client, reinterpret_cast<const char *>(frame->buf), frame->len);
  const uint32_t started = millis();
  const esp_err_t result = esp_http_client_perform(client);
  const int status = esp_http_client_get_status_code(client);
  Serial.printf("Captura %lu | JPEG %u bytes | HTTP %d | %lu ms\n",
    static_cast<unsigned long>(sequence), static_cast<unsigned>(frame->len), status,
    static_cast<unsigned long>(millis() - started));
  if (result != ESP_OK) Serial.printf("Error de conexion HTTPS: %s\n", esp_err_to_name(result));
  else Serial.println(response);
  if (status == 401 || status == 403) Serial.println("Revisa CAMERA_TOKEN y que la URL de produccion permita acceso a la API.");
  if (status >= 300 && status < 400) Serial.println("Redireccion inesperada: usa la URL HTTPS de produccion terminada en /api/ingest.");
  esp_http_client_cleanup(client);
  return result == ESP_OK && status == 200;
}

void setup() {
  Serial.begin(115200); delay(800);
  if (!strlen(WIFI_SSID) || strcmp(WIFI_SSID, "NOMBRE_DE_TU_WIFI") == 0 ||
      strcmp(WIFI_PASSWORD, "CONTRASENA_DE_TU_WIFI") == 0 ||
      strstr(SERVER_URL, "TU_PROYECTO") || strncmp(SERVER_URL, "https://", 8) != 0 ||
      strstr(CAMERA_TOKEN, "COPIA_AQUI") || strlen(CAMERA_TOKEN) < 32 || CAPTURE_INTERVAL_MS < 5000) {
    Serial.println("CONFIGURACION PENDIENTE: copia config.example.h como config.h y completa WiFi, URL y token. Intervalo minimo: 5000 ms.");
    return;
  }
  const esp_err_t result = initCamera();
  if (result != ESP_OK) { Serial.printf("Error de camara: 0x%x\n", static_cast<unsigned>(result)); return; }
  snprintf(bootId, sizeof(bootId), "%08lx%08lx", static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  WiFi.setHostname("xiao-remota"); WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true); WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); lastWifiAttempt = millis();
  // La hora correcta permite verificar la vigencia de los certificados HTTPS.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  configured = true;
  Serial.println("Conectando a Internet. El analisis ocurre en Railway.");
}

void loop() {
  if (!configured) { delay(250); return; }
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiWasConnected) { wifiWasConnected = false; Serial.println("WiFi desconectado. Reconectando..."); }
    if (now - lastWifiAttempt >= 20000) { WiFi.reconnect(); lastWifiAttempt = now; }
    delay(100); return;
  }
  if (!wifiWasConnected) {
    wifiWasConnected = true;
    Serial.printf("WiFi conectado. IP local %s. El monitor remoto usa la URL de Railway.\n", WiFi.localIP().toString().c_str());
  }
  if (time(nullptr) < 1700000000) {
    if (now - lastClockWarning > 15000) { lastClockWarning = now; Serial.println("Esperando hora de Internet (NTP) para HTTPS..."); }
    delay(100); return;
  }
  if (static_cast<int32_t>(now - nextCapture) < 0) { delay(50); return; }
  const uint32_t cycleStarted = millis();
  camera_fb_t *frame = esp_camera_fb_get();
  if (frame) esp_camera_fb_return(frame); // Descartar un cuadro para pedir uno reciente.
  frame = esp_camera_fb_get();
  bool sent = false;
  if (frame) { sent = sendPhoto(frame); esp_camera_fb_return(frame); }
  else Serial.println("No se pudo obtener una captura.");
  const uint32_t elapsed = millis() - cycleStarted;
  const uint32_t interval = DEMO_MODE ? DEMO_CYCLE_MS : CAPTURE_INTERVAL_MS;
  const uint32_t pause = capturePauseMs(sent, DEMO_MODE, interval, elapsed);
  nextCapture = millis() + pause;
  Serial.printf("Ciclo %lu ms | espera %lu ms | modo %s\n", static_cast<unsigned long>(elapsed),
    static_cast<unsigned long>(pause), DEMO_MODE ? "demo 5s" : "estable");
}
