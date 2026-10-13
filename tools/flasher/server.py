"""
Board flashing pipeline service.
Uses PlatformIO Core for multi-board compilation and flashing.
Supports 1000+ boards: Arduino, ESP32, ESP8266, RP2040, STM32, and more.
"""
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Board Flasher API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR", "/repo/workspace")
PLATFORMIO_CORE_DIR = os.environ.get("PLATFORMIO_CORE_DIR", "/root/.platformio")


# ---------- Models ----------

class CompileRequest(BaseModel):
    code: str
    board_id: str
    framework: str = "arduino"  # arduino, espidf, mbed, etc.
    filename: str = "main.cpp"


class FlashRequest(BaseModel):
    code: str
    board_id: str
    framework: str = "arduino"
    filename: str = "main.cpp"
    port: Optional[str] = None  # auto-detect if None


class UploadRequest(BaseModel):
    firmware_path: str
    board_id: str
    port: Optional[str] = None


# ---------- Helpers ----------

def run_cmd(cmd: list[str], cwd: str | None = None, timeout: int = 120) -> dict:
    """Run a command and return stdout/stderr/exit code."""
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        return {
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "exit_code": proc.returncode,
            "success": proc.returncode == 0,
        }
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "Command timed out", "exit_code": -1, "success": False}
    except FileNotFoundError as e:
        return {"stdout": "", "stderr": str(e), "exit_code": -1, "success": False}


def pio_cmd(args: list[str], cwd: str | None = None, timeout: int = 180) -> dict:
    """Run a PlatformIO CLI command."""
    cmd = ["platformio"] + args
    return run_cmd(cmd, cwd=cwd, timeout=timeout)


def create_project(board_id: str, framework: str, code: str, filename: str) -> str:
    """Create a temporary PlatformIO project with the given code."""
    project_dir = tempfile.mkdtemp(prefix="pio_project_")

    # Write platformio.ini
    ini_content = f"""
[env:flash]
platform = package:framework-{framework}
board = {board_id}
framework = {framework}
build_flags = -Wall
"""
    # PlatformIO uses board-specific platforms; let pio auto-resolve
    ini_content = f"""
[env:flash]
board = {board_id}
framework = {framework}
"""
    (Path(project_dir) / "platformio.ini").write_text(ini_content.strip())

    # Write source code
    src_dir = Path(project_dir) / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / filename).write_text(code)

    return project_dir


def list_serial_ports() -> list[dict]:
    """List available serial ports."""
    result = pio_cmd(["device", "list", "--json-output"])
    if result["success"] and result["stdout"]:
        try:
            return json.loads(result["stdout"])
        except json.JSONDecodeError:
            pass
    # Fallback: scan /dev for serial devices
    ports = []
    for name in os.listdir("/dev"):
        if name.startswith(("ttyUSB", "ttyACM", "ttyS", "cu.")):
            ports.append({"port": f"/dev/{name}", "description": name})
    return ports


# ---------- Endpoints ----------

@app.get("/api/health")
async def health():
    return {"status": "ok", "pio_available": shutil.which("platformio") is not None}


@app.get("/api/boards")
async def list_boards():
    """List all supported boards from PlatformIO's registry."""
    result = pio_cmd(["boards", "--json-output"], timeout=60)
    if result["success"] and result["stdout"]:
        try:
            boards = json.loads(result["stdout"])
            # Return a compact list
            return [
                {
                    "id": b.get("id"),
                    "name": b.get("name"),
                    "platform": b.get("platform"),
                    "frameworks": b.get("frameworks", []),
                    "mcu": b.get("mcu", ""),
                    "vendor": b.get("vendor", ""),
                }
                for b in boards
            ]
        except json.JSONDecodeError:
            pass
    return {"boards": [], "error": result.get("stderr", "Could not list boards")}


@app.get("/api/boards/search")
async def search_boards(q: str):
    """Search boards by name or ID."""
    result = pio_cmd(["boards", "--json-output"], timeout=60)
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result.get("stderr"))
    try:
        boards = json.loads(result["stdout"])
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse board list")

    q_lower = q.lower()
    matches = [
        {
            "id": b.get("id"),
            "name": b.get("name"),
            "platform": b.get("platform"),
            "frameworks": b.get("frameworks", []),
        }
        for b in boards
        if q_lower in (b.get("id", "") + " " + b.get("name", "")).lower()
    ]
    return matches


@app.get("/api/devices")
async def list_devices():
    """List connected serial devices."""
    return {"ports": list_serial_ports()}


@app.post("/api/compile")
async def compile_code(req: CompileRequest):
    """Compile code for a specific board without flashing."""
    project_dir = create_project(req.board_id, req.framework, req.code, req.filename)
    result = pio_cmd(["run"], cwd=project_dir, timeout=300)

    # Find firmware binary
    firmware_path = None
    firmware_dir = Path(project_dir) / ".pio/build/flash"
    if firmware_dir.exists():
        for ext in [".hex", ".bin", ".uf2"]:
            matches = list(firmware_dir.glob(f"*{ext}"))
            if matches:
                firmware_path = str(matches[0])
                break

    # Read build output
    build_log = result["stdout"] + "\n" + result["stderr"]

    # Clean up project (keep firmware if compiled)
    if firmware_path and os.path.exists(firmware_path):
        # Copy firmware to a persistent location
        dest = Path(WORKSPACE_DIR) / f"firmware_{int(time.time())}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(firmware_path, dest)
        shutil.rmtree(project_dir, ignore_errors=True)
        firmware_path = str(dest)
    else:
        shutil.rmtree(project_dir, ignore_errors=True)

    return {
        "success": result["success"],
        "firmware_path": firmware_path,
        "build_log": build_log,
        "board_id": req.board_id,
    }


@app.post("/api/flash")
async def flash_code(req: FlashRequest):
    """Compile and flash code to a connected board."""
    project_dir = create_project(req.board_id, req.framework, req.code, req.filename)

    # Build and upload
    upload_args = ["run", "--target", "upload"]
    if req.port:
        upload_args += ["--upload-port", req.port]
    result = pio_cmd(upload_args, cwd=project_dir, timeout=300)

    build_log = result["stdout"] + "\n" + result["stderr"]

    # Clean up
    shutil.rmtree(project_dir, ignore_errors=True)

    return {
        "success": result["success"],
        "build_log": build_log,
        "board_id": req.board_id,
        "port": req.port or "auto",
    }


@app.post("/api/upload")
async def upload_firmware(req: UploadRequest):
    """Upload a pre-compiled firmware binary to a board."""
    if not os.path.exists(req.firmware_path):
        raise HTTPException(status_code=404, detail="Firmware file not found")

    project_dir = tempfile.mkdtemp(prefix="pio_upload_")
    ini_content = f"""
[env:flash]
board = {req.board_id}
framework = arduino
"""
    (Path(project_dir) / "platformio.ini").write_text(ini_content.strip())

    # Copy firmware into project
    firmware_dir = Path(project_dir) / ".pio/build/flash"
    firmware_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(req.firmware_path, firmware_dir / Path(req.firmware_path).name)

    upload_args = ["run", "--target", "upload"]
    if req.port:
        upload_args += ["--upload-port", req.port]
    result = pio_cmd(upload_args, cwd=project_dir, timeout=180)

    shutil.rmtree(project_dir, ignore_errors=True)

    return {
        "success": result["success"],
        "output": result["stdout"] + "\n" + result["stderr"],
    }


# ---------- Workspace control (AI full power) ----------

class FileWriteRequest(BaseModel):
    path: str
    content: str


class FileReadRequest(BaseModel):
    path: str


class CommandRequest(BaseModel):
    command: str
    cwd: str = "/repo/workspace"
    timeout: int = 60


@app.get("/api/workspace/files")
async def list_files(path: str = "/repo/workspace"):
    """List files in a directory."""
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    items = []
    for item in sorted(p.iterdir()):
        items.append({
            "name": item.name,
            "path": str(item),
            "type": "directory" if item.is_dir() else "file",
            "size": item.stat().st_size if item.is_file() else 0,
        })
    return {"path": path, "items": items}


@app.post("/api/workspace/read")
async def read_file(req: FileReadRequest):
    """Read a file's contents."""
    p = Path(req.path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not p.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    return {"path": req.path, "content": p.read_text()}


@app.post("/api/workspace/write")
async def write_file(req: FileWriteRequest):
    """Write content to a file."""
    p = Path(req.path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(req.content)
    return {"path": req.path, "success": True}


@app.post("/api/workspace/command")
async def run_command(req: CommandRequest):
    """Run a shell command in the workspace."""
    result = run_cmd(["sh", "-c", req.command], cwd=req.cwd, timeout=req.timeout)
    return {
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "exit_code": result["exit_code"],
        "success": result["success"],
    }


@app.delete("/api/workspace/file")
async def delete_file(path: str):
    """Delete a file or directory."""
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    return {"path": path, "deleted": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
