// =============================================================================
// @migrare/core — local web server
//
// Serves the web UI and exposes the migrare engine as a local REST API.
// Launched by: npx migrare ui  OR the wizard's "Open web UI" option.
//
// ARCHITECTURE: This is intentionally a zero-dependency HTTP server built
// on Node's built-in http module. It serves two purposes:
//   1. Static host for web/dist (the built React UI)
//   2. Local API proxy so the browser UI can call the engine
//
// API SURFACE:
//   POST /api/scan          { source } → ScanReport
//   POST /api/migrate       { source, targetAdapter, ... } → MigrationResult
//   GET  /api/adapters      list registered output adapters
//   GET  /api/health        version heartbeat
//   GET  /api/progress      SSE stream — pushes ProgressEvent to the browser
//
// SSE PROGRESS: The /api/progress endpoint holds HTTP connections open and
// writes "data: {...}\n\n" frames whenever the engine emits a progress event.
// The web UI connects to this once per migration and renders live updates.
//
// TOKEN PASSTHROUGH: For the hosted migrare.dev version, all GitHub API calls
// happen client-side. This local server only handles the token code-exchange
// endpoint (/api/auth/github/token) when running locally.
// Serves the web UI and exposes the engine as a local REST API.
// Launched by: npx migrare ui  OR  npx migrare (wizard → option 3)
//
// API routes:
//   POST /api/scan          { source: "path" | { zip: base64 } | { github: url } }
//   POST /api/migrate       { source, targetAdapter, targetPath, dryRun, options }
//   GET  /api/adapters      list registered output adapters
//   GET  /api/health        heartbeat
//   WS   /api/progress      server-sent events for migration progress
// =============================================================================

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "../index.js";
import type { MigrareEngine } from "../core/types/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface ServerOptions {
  port: number;
  openBrowser?: boolean;
}

export async function startServer(options: ServerOptions): Promise<void> {
  const { port, openBrowser = false } = options;

  const engine = await createEngine({ runtime: "cli" });

  // SSE clients waiting for progress events
  const progressClients = new Set<ServerResponse>();

  engine.on("progress", (event) => {
    const data = JSON.stringify(event);
    for (const client of progressClients) {
      client.write(`data: ${data}\n\n`);
    }
  });

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, engine, progressClients);
    } catch (err) {
      console.error("[migrare:server] Unhandled error", err);
      if (!res.headersSent) {
        jsonError(res, 500, "Internal server error");
      }
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  const url = `http://localhost:${port}`;
  console.log(`\n  \x1b[32m▸\x1b[0m migrare web UI  \x1b[36m${url}\x1b[0m`);
  console.log(`  \x1b[2mCtrl+C to stop\x1b[0m\n`);

  if (openBrowser) {
    const { exec } = await import("node:child_process");
    const cmd =
      process.platform === "darwin" ? `open ${url}` :
      process.platform === "win32"  ? `start ${url}` :
                                      `xdg-open ${url}`;
    exec(cmd);
  }

  // Keep alive
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  engine: MigrareEngine,
  progressClients: Set<ServerResponse>
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // CORS for the hosted migrare.dev frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------

  if (path === "/api/health" && method === "GET") {
    return json(res, { ok: true, version: "0.1.0" });
  }

  if (path === "/api/adapters" && method === "GET") {
    return json(res, {
      adapters: [
        { id: "vite",     name: "Vite + React",  description: "Framework-agnostic (recommended)" },
        { id: "nextjs",   name: "Next.js",        description: "App Router structure" },
        { id: "local-fs", name: "Local FS",       description: "Write to local filesystem" },
      ],
    });
  }

  if (path === "/api/scan" && method === "POST") {
    const body = await readBody(req);
    const { source } = JSON.parse(body);
    if (!source) return jsonError(res, 400, "Missing source");

    const report = await engine.scan(source);
    return json(res, report);
  }

  if (path === "/api/migrate" && method === "POST") {
    const body = await readBody(req);
    const { source, targetAdapter, targetPath, dryRun, options: adapterOptions } = JSON.parse(body);
    if (!source || !targetAdapter || !targetPath) {
      return jsonError(res, 400, "Missing required fields: source, targetAdapter, targetPath");
    }

    const result = await engine.migrate(source, {
      targetAdapter,
      targetPath,
      dryRun: dryRun ?? false,
      adapterOptions,
    });
    return json(res, result);
  }

  // SSE progress stream
  if (path === "/api/progress" && method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write(": connected\n\n");
    progressClients.add(res);
    req.on("close", () => progressClients.delete(res));
    return; // keep connection open
  }

  // ---------------------------------------------------------------------------
  // Static web UI
  // ---------------------------------------------------------------------------

  // Serve the built web UI from web/dist, or fallback HTML for dev
  if (method === "GET") {
    const webDistPath = resolve(__dirname, "../../web/dist");
    const staticFile = path === "/" ? "/index.html" : path;

    try {
      const filePath = join(webDistPath, staticFile);
      const content = await readFile(filePath);
      const contentType = getContentType(staticFile);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
      return;
    } catch {
      // Web UI not built yet — serve inline fallback
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getDevFallbackHTML());
      return;
    }
  }

  jsonError(res, 404, `Not found: ${path}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function jsonError(res: ServerResponse, status: number, message: string): void {
  json(res, { error: message }, status);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function getContentType(file: string): string {
  if (file.endsWith(".js"))   return "application/javascript";
  if (file.endsWith(".css"))  return "text/css";
  if (file.endsWith(".html")) return "text/html";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".svg"))  return "image/svg+xml";
  return "application/octet-stream";
}

function getDevFallbackHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>migrare</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a; color: #e0e0e0;
      font-family: 'Berkeley Mono', 'Fira Code', 'Courier New', monospace;
      display: flex; align-items: center; justify-content: center;
      height: 100vh; flex-direction: column; gap: 1rem;
    }
    .logo { color: #00ff88; font-size: 1.5rem; letter-spacing: 0.2em; }
    .msg  { color: #666; font-size: 0.85rem; }
    .cmd  { color: #00ff88; background: #111; padding: 0.5rem 1rem;
            border: 1px solid #222; border-radius: 4px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="logo">MIGRARE</div>
  <div class="msg">Web UI not built yet. To build it:</div>
  <div class="cmd">cd web && npm install && npm run build</div>
  <div class="msg">API is running — <a style="color:#00ff88" href="/api/health">/api/health</a></div>
</body>
</html>`;
}
