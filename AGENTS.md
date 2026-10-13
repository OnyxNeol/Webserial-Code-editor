# Base44 VS Code web development notes

- The former custom Monaco/Express editor is gone. The preview runs the official Microsoft VS Code source checkout in `vscode/`, via Microsoft's `@vscode/test-web` source-mode server. It is Code - OSS for the browser, not code-server or the native ecode application described by the original README.
- `vscode/` is a pinned Git submodule of `https://github.com/microsoft/vscode.git`; `.gitmodules` is required for fresh imports. Compose initializes the submodule if its source checkout is missing.
- Use `docker compose -f docker-compose.base44.yml up -d --build`. Port 3000 serves the workbench. Root and build dependencies are installed sequentially from their current lockfiles into separate Docker volumes at every container start. `--ignore-scripts` intentionally avoids Electron and native desktop install hooks for this browser-only runtime.
- `.base44/vscode-dev.mjs` first copies the dependency-provided codicon font, then invokes the repository's official `build/next/index.ts bundle --target web --out out`. Per-file transpilation alone is not sufficient for the current ESM browser launcher. Source changes are polled and rebuild the browser bundles. Reload the page after rebuilding; this launcher does not inject HMR.
- `.base44/vscode-server.cjs` uses the official test-web app factory. With `BASE44_PREVIEW_MODE` exactly `1`, it enables Koa's forwarded-header handling and normalizes the origin to `https://3000-${BASE44_PUBLIC_HOST_SUFFIX}`. This prevents mixed-content module requests and incorrect sandbox proxy URLs. With the flag unset or any other value, Koa's original direct HTTP/Host behavior is preserved. No authentication, CSP, cookies, or TLS checks are disabled.
- The test-web HTML template contains inline `<script>` tags without nonces, which violate the preview proxy's Content-Security-Policy. The server middleware intercepts HTML responses, extracts inline scripts to external `/inline-scripts/<hash>.js` files (served from an in-memory cache), and replaces them with `<script src>` tags. This is gated on `BASE44_PREVIEW_MODE === '1'` only.
- The web workbench, syntax grammars, and themes load from source. Browser extension bundles are not compiled yet; IntelliSense and features supplied by those extensions need additional extension-specific dependency installation and `npm run compile-web`. Terminal/native filesystem/backend features are not provided by this standalone browser development server. Do not describe this as the full desktop IDE.
- Verification: `curl -f http://localhost:3000/` and request `/static/sources/out/vs/workbench/workbench.web.main.internal.js` plus its `.css`. Then verify the real preview renders `.monaco-workbench`, open a new unsaved text editor, and type into it. Check runtime errors as well as HTTP status; an HTTP 200 page alone previously rendered blank.
- `vscode/out`, dependency directories, and generated codicon fonts are build outputs, not source to commit. Never serve the old prebuilt `app-vscode-web` image: Compose uses plain `node:24-bookworm` with the checkout bind-mounted.

## Board flashing pipeline

- `tools/flasher/server.py` is a FastAPI service that compiles and flashes code to 1000+ hardware boards via PlatformIO Core. It runs as a separate compose service (`flasher`) on port 8001, built from `Dockerfile.flasher` (Python 3.12 + platformio + fastapi + uvicorn).
- API endpoints: `GET /api/boards` (list all boards), `GET /api/boards/search?q=` (search), `GET /api/devices` (serial ports), `POST /api/compile` (compile only), `POST /api/flash` (compile + flash), `POST /api/upload` (upload pre-compiled firmware). See `tools/flasher/README.md` for full API docs.
- Workspace control endpoints give the AI full power: `GET /api/workspace/files`, `POST /api/workspace/read`, `POST /api/workspace/write`, `POST /api/workspace/command` (shell execution), `DELETE /api/workspace/file`.
- The `workspace_data` Docker volume is shared between `vscode-web` (mounted at `/repo/workspace`) and `flasher` (mounted at `/repo/workspace`) so files written by the AI are immediately visible in VS Code.
- `pio_core` volume caches PlatformIO platforms/toolchains across restarts. First board compile downloads platform packages (can take minutes).
- VS Code web receives `FLASHER_API_URL=http://flasher:8001` so it can call the flasher service by container name.

## OpenWebUI extension: VS Webserial

- `tools/openwebui/vs_webserial.py` is an OpenWebUI tool that connects an AI assistant to the workspace and board flashing pipeline. Upload it to OpenWebUI under Workspace → Tools. Configure the `FLASHER_API_URL` valve to point at the flasher service's public URL.
- Tools exposed: `list_files`, `read_file`, `write_file`, `delete_file`, `run_command`, `search_boards`, `list_devices`, `compile_code`, `flash_code`, `create_workspace_link`.
- `create_workspace_link` calls `POST /api/link/generate` on the flasher to produce a private link with read-write permissions. The link includes a UUID token with a configurable expiry (default 24h). The user opens the link in a browser to access the VS Code web editor.
- `tools/openwebui/README.md` has installation and configuration instructions.

## Private link / token system

- The flasher service manages tokens in memory (`link_tokens` dict). Endpoints: `POST /api/link/generate` (create), `GET /api/link/validate?token=` (validate), `DELETE /api/link/revoke?token=` (revoke), `GET /api/links` (list active).
- The VS Code web server (`.base44/vscode-server.cjs`) validates tokens on every request. On first visit with `?token=xxx`, it validates against the flasher and sets an `HttpOnly` cookie (`vs_ws_token`) valid for 24h. Subsequent requests use the cookie. Without a valid token, page requests show an "Access Required" page and resource requests get 403.
- Token validation results are cached for 5 minutes in the VS Code server to avoid calling the flasher on every request.
- The flasher builds the link URL from `VSCODE_WEB_URL` env var, falling back to `https://3000-$BASE44_PUBLIC_HOST_SUFFIX`, then `http://localhost:3000`. `BASE44_PUBLIC_HOST_SUFFIX` is passed to the flasher service in compose.

## Disabled auto-completions

- VS Code editor defaults have been modified in `vscode/src/vs/editor/common/config/editorOptions.ts` and `editorConfigurationSchema.ts` to disable all auto-completions: `quickSuggestions.other` → `'off'`, `suggestOnTriggerCharacters` → `false`, `inlineSuggest.enabled` → `false`, `parameterHints.enabled` → `false`, `wordBasedSuggestions` → `'off'`. These are source-level defaults; users can still re-enable via settings if desired.
