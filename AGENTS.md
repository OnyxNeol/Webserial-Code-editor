# Base44 Setup Notes

## What This Repo Is

This repository is the **ecode** project — a documentation-only repo for a native C++ code editor. The actual source code lives in the [eepp repository](https://github.com/SpartanJ/eepp). This repo contains only README, docs, issue templates, and a release workflow.

## What Was Built

Since the original repo has no runnable web application, a **Monaco-based web code editor** (the same editor engine as VS Code) was added to provide a VS Code-like web experience that works in the preview. The preview proxy does not support WebSocket, so code-server (which requires WebSocket) doesn't work — this HTTP-only editor does.

### Architecture
- **Backend**: Express.js server (`server.js`) serving static files and a REST file API (list, read, write, delete)
- **Frontend**: Vanilla JS + Monaco Editor loaded from CDN (`public/`)
- **Workspace**: Files are stored in `workspace/` directory
- **No WebSocket required** — all communication is over HTTP

### Running
```bash
docker compose -f docker-compose.base44.yml up -d
```
App serves on port 3000. Health check at `/healthz`.

### Key Files
- `server.js` — Express server with file API
- `public/index.html` — Main page
- `public/app.js` — Editor logic (file tree, tabs, search, save)
- `public/style.css` — VS Code dark theme styling
- `docker-compose.base44.yml` — Compose setup
