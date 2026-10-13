"""
title: VS Webserial
author: VS Webserial
version: 0.2.0
required_open_webui_version: 0.3.0
description: Connect AI to a VS Code web workspace with board flashing pipeline. The AI can read/write files, compile and flash code to 1000+ boards, run shell commands, and generate private read-write links for users to access the workspace. The flasher API URL is auto-discovered — no manual configuration needed.
"""

import json
import requests
from pydantic import BaseModel, Field
from typing import Optional


class Tools:
    """VS Webserial — AI workspace control + board flashing pipeline."""

    class Valves(BaseModel):
        FLASHER_API_URL: str = Field(
            default="",
            description="Optional: override the flasher API URL. Leave empty for auto-discovery."
        )

    def __init__(self):
        self.valves = self.Valves()
        self._discovered_url = None

    def _get_flasher_url(self) -> str:
        """Return the flasher API URL, auto-discovering if not configured."""
        if self.valves.FLASHER_API_URL:
            return self.valves.FLASHER_API_URL
        if self._discovered_url:
            return self._discovered_url
        # Auto-discover by probing common locations
        candidates = [
            "http://localhost:8001",
            "http://host.docker.internal:8001",
            "http://127.0.0.1:8001",
        ]
        for url in candidates:
            try:
                r = requests.get(f"{url}/api/health", timeout=3)
                if r.status_code == 200 and r.json().get("status") == "ok":
                    self._discovered_url = url
                    return url
            except Exception:
                continue
        return "http://localhost:8001"

    def _post(self, endpoint: str, payload: dict, timeout: int = 120) -> dict:
        r = requests.post(
            f"{self._get_flasher_url()}{endpoint}",
            json=payload,
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json()

    def _get(self, endpoint: str, params: dict = None, timeout: int = 60) -> dict:
        r = requests.get(
            f"{self._get_flasher_url()}{endpoint}",
            params=params,
            timeout=timeout,
        )
        r.raise_for_status()
        return r.json()

    # ---- Workspace tools ----

    def list_files(self, path: str = "/repo/workspace") -> str:
        """List files and directories in the workspace. Use this to explore the project structure.
        :param path: Directory path to list (default: /repo/workspace).
        :return: JSON array of files and directories with names, types, and sizes.
        """
        try:
            data = self._get("/api/workspace/files", params={"path": path})
            return json.dumps(data, indent=2)
        except Exception as e:
            return f"Error listing files: {e}"

    def read_file(self, path: str) -> str:
        """Read the contents of a file in the workspace.
        :param path: Full path to the file to read.
        :return: The file contents as a string.
        """
        try:
            data = self._post("/api/workspace/read", {"path": path})
            return data.get("content", "")
        except Exception as e:
            return f"Error reading file: {e}"

    def write_file(self, path: str, content: str) -> str:
        """Write or create a file in the workspace. Parent directories are created automatically.
        :param path: Full path where the file should be written.
        :param content: The text content to write to the file.
        :return: Confirmation message with the file path.
        """
        try:
            self._post("/api/workspace/write", {"path": path, "content": content})
            return f"File written successfully: {path}"
        except Exception as e:
            return f"Error writing file: {e}"

    def delete_file(self, path: str) -> str:
        """Delete a file or directory from the workspace.
        :param path: Full path to the file or directory to delete.
        :return: Confirmation message.
        """
        try:
            r = requests.delete(
                f"{self._get_flasher_url()}/api/workspace/file",
                params={"path": path},
                timeout=30,
            )
            r.raise_for_status()
            return f"Deleted: {path}"
        except Exception as e:
            return f"Error deleting: {e}"

    def run_command(self, command: str, cwd: str = "/repo/workspace") -> str:
        """Run a shell command in the workspace. Use this for building, running scripts, git, etc.
        :param command: The shell command to execute.
        :param cwd: Working directory for the command (default: /repo/workspace).
        :return: Command output (stdout + stderr) and exit code.
        """
        try:
            data = self._post("/api/workspace/command", {"command": command, "cwd": cwd}, timeout=120)
            output = data.get("stdout", "") + data.get("stderr", "")
            return f"Exit code: {data.get('exit_code')}\n{output}"
        except Exception as e:
            return f"Error running command: {e}"

    # ---- Board flashing tools ----

    def search_boards(self, query: str) -> str:
        """Search for supported hardware boards by name or ID (e.g. 'esp32', 'arduino', 'rp2040').
        :param query: Search term to match board names or IDs.
        :return: JSON array of matching boards with IDs, names, platforms, and frameworks.
        """
        try:
            data = self._get("/api/boards/search", params={"q": query})
            return json.dumps(data, indent=2)
        except Exception as e:
            return f"Error searching boards: {e}"

    def list_devices(self) -> str:
        """List connected serial devices available for flashing.
        :return: JSON object with available serial ports.
        """
        try:
            data = self._get("/api/devices")
            return json.dumps(data, indent=2)
        except Exception as e:
            return f"Error listing devices: {e}"

    def compile_code(self, code: str, board_id: str, framework: str = "arduino", filename: str = "main.cpp") -> str:
        """Compile code for a specific board without flashing. Check the build log for errors.
        :param code: The source code to compile.
        :param board_id: Board ID (e.g. esp32dev, uno, nucleo_f401re). Use search_boards to find IDs.
        :param framework: Framework to use (arduino, espidf, mbed). Default: arduino.
        :param filename: Source filename (default: main.cpp). Use .c for C code.
        :return: Compilation result with success status, build log, and firmware path if successful.
        """
        try:
            data = self._post("/api/compile", {
                "code": code,
                "board_id": board_id,
                "framework": framework,
                "filename": filename,
            }, timeout=300)
            result = f"Success: {data.get('success')}\n"
            if data.get("firmware_path"):
                result += f"Firmware: {data['firmware_path']}\n"
            result += f"Build log:\n{data.get('build_log', '')}"
            return result
        except Exception as e:
            return f"Error compiling: {e}"

    def flash_code(self, code: str, board_id: str, framework: str = "arduino", filename: str = "main.cpp", port: str = "") -> str:
        """Compile and flash code to a connected board. Make sure the board is connected via USB.
        :param code: The source code to compile and flash.
        :param board_id: Board ID (e.g. esp32dev, uno). Use search_boards to find IDs.
        :param framework: Framework to use (arduino, espidf, mbed). Default: arduino.
        :param filename: Source filename (default: main.cpp).
        :param port: Serial port to flash to (e.g. /dev/ttyUSB0). Leave empty for auto-detect.
        :return: Flash result with success status and build/flash log.
        """
        try:
            payload = {
                "code": code,
                "board_id": board_id,
                "framework": framework,
                "filename": filename,
            }
            if port:
                payload["port"] = port
            data = self._post("/api/flash", payload, timeout=300)
            result = f"Success: {data.get('success')}\n"
            result += f"Board: {data.get('board_id')}\n"
            result += f"Port: {data.get('port')}\n"
            result += f"Build log:\n{data.get('build_log', '')}"
            return result
        except Exception as e:
            return f"Error flashing: {e}"

    # ---- Private link generation ----

    def create_workspace_link(self, expires_in_hours: int = 24) -> str:
        """Generate a private link that gives a user read-write access to this workspace.
        The user can open the link in a browser to access the VS Code web editor with full read-write permissions.
        :param expires_in_hours: Link expiration time in hours (default: 24).
        :return: The private workspace link URL and token details.
        """
        try:
            data = self._post("/api/link/generate", {
                "permissions": "read-write",
                "workspace_path": "/repo/workspace",
                "expires_in": expires_in_hours * 3600,
            }, timeout=30)
            result = "Private workspace link created!\n"
            result += f"Link: {data.get('link')}\n"
            result += f"Permissions: {data.get('permissions')}\n"
            result += f"Expires in: {expires_in_hours} hours\n"
            result += "Share this link with the user to give them read-write access to the workspace."
            return result
        except Exception as e:
            return f"Error creating link: {e}"
