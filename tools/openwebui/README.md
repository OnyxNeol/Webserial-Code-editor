# VS Webserial — OpenWebUI Extension

An [OpenWebUI](https://github.com/open-webui/open-webui) tool that connects an AI assistant to a VS Code web workspace with a board flashing pipeline.

## What it does

- **Workspace control** — the AI can list, read, write, and delete files, and run shell commands in the shared workspace.
- **Board flashing** — compile and flash code to 1000+ hardware boards (Arduino, ESP32, RP2040, STM32, and more) via PlatformIO Core.
- **Private links** — the AI generates a private link with read-write permissions so a user can open the VS Code web editor in their browser.

## Installation

1. Open your OpenWebUI instance.
2. Go to **Workspace → Tools**.
3. Click **Create Tool** (or the `+` button).
4. Name it `VS Webserial`.
5. Paste the contents of `vs_webserial.py` into the editor.
6. Save.

## Configuration

The flasher API URL is **auto-discovered** — no manual configuration needed. The extension probes `http://localhost:8001`, `http://host.docker.internal:8001`, and `http://127.0.0.1:8001` on first use and caches the working URL.

If your flasher is on a different host, optionally set the **Valves**:

| Valve | Default | Description |
|-------|---------|-------------|
| `FLASHER_API_URL` | _(empty — auto-discover)_ | Optional override for the flasher API URL. Leave empty for auto-discovery. |

## Available tools

| Tool | Description |
|------|-------------|
| `list_files` | List files and directories in the workspace |
| `read_file` | Read a file's contents |
| `write_file` | Write or create a file |
| `delete_file` | Delete a file or directory |
| `run_command` | Run a shell command in the workspace |
| `search_boards` | Search supported hardware boards |
| `list_devices` | List connected serial devices |
| `compile_code` | Compile code for a board |
| `flash_code` | Compile and flash code to a board |
| `create_workspace_link` | Generate a private read-write link for the user |

## How private links work

1. The AI calls `create_workspace_link` which asks the flasher service to generate a token.
2. The flasher creates a unique token (UUID) with read-write permissions and a 24-hour expiry.
3. The AI gives the user a link like `https://3000-your-host.example/?token=<uuid>`.
4. When the user opens the link, the VS Code web server validates the token against the flasher.
5. If valid, a cookie is set and the user gets full read-write access to the workspace in the browser-based VS Code editor.
6. Without a valid token, the user sees an "Access Required" page.

## Architecture

```
User → OpenWebUI → AI → vs_webserial.py → Flasher API (port 8001)
                                              ↓
                                     generates token + link
                                              ↓
User → opens link → VS Code web (port 3000) → validates token → Flasher API
```
