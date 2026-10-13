# Board Flashing Pipeline

A FastAPI service that compiles and flashes code to 1000+ hardware boards using PlatformIO Core.

## Supported Board Families

- **Arduino** (AVR, SAMD, SAM) — Uno, Mega, Nano, Leonardo, Due, etc.
- **Espressif** — ESP32, ESP32-S2/S3/C3, ESP8266
- **Raspberry Pi** — Pico (RP2040), Pico W
- **STMicroelectronics** — STM32 (Blue Pill, Black Pill, Nucleo)
- **Nordic** — nRF52, nRF51
- **Microchip** — PIC32
- **And many more** — PlatformIO supports 1000+ boards across 40+ platforms

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Service health + PlatformIO availability |
| GET | `/api/boards` | List all supported boards |
| GET | `/api/boards/search?q=esp32` | Search boards by name/ID |
| GET | `/api/devices` | List connected serial devices |
| POST | `/api/compile` | Compile code for a board (no flash) |
| POST | `/api/flash` | Compile + flash to a connected board |
| POST | `/api/upload` | Upload pre-compiled firmware |

### Workspace Control (AI full power)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspace/files?path=...` | List files in a directory |
| POST | `/api/workspace/read` | Read a file |
| POST | `/api/workspace/write` | Write/create a file |
| POST | `/api/workspace/command` | Run a shell command |
| DELETE | `/api/workspace/file?path=...` | Delete a file or directory |

## Usage

```bash
# Compile code for an ESP32
curl -X POST http://localhost:8001/api/compile \
  -H "Content-Type: application/json" \
  -d '{"code": "void setup(){}\nvoid loop(){}", "board_id": "esp32dev", "framework": "arduino"}'

# Flash to a connected board
curl -X POST http://localhost:8001/api/flash \
  -H "Content-Type: application/json" \
  -d '{"code": "void setup(){}\nvoid loop(){}", "board_id": "esp32dev", "port": "/dev/ttyUSB0"}'
```
