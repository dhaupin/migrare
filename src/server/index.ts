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
//   GET  /api/auth/status    check auth state
//   POST /api/auth/github/token  exchange OAuth code for token (local dev only)
//
// SSE PROGRESS: The /api/progress endpoint holds HTTP connections open and
// writes "data: {...}\n\n" frames whenever the engine emits a progress event.
// The web UI connects to this once per migration and renders live updates.
//
// TOKEN PASSTHROUGH: For the hosted migrare.dev version, all GitHub API calls
// happen client-side. This local server only handles the token code-exchange
// endpoint (/api/auth/github/token) when running locally.
//
// SECURITY:
//   - Tokens stored in memory only, never logged or persisted
//   - CORS restricted in production
//   - Input validation on all endpoints
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

// @creadev.org security & QoS layers
import { 
  RateLimiter, 
  sanitizePath, 
  sanitizeRepoName,
  createWaf, 
  getSecurityHeaders,
  getClientIP,
  firewall
} from '@creadev.org/security';

import { 
  withRetry, 
  CircuitBreaker
} from '@creadev.org/qos';

// See: https://github.com/creadev

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Security layer initialization (@creadev.org/security)
// ---------------------------------------------------------------------------

// Rate limiter - 30 requests per minute per key
const rateLimiter = new RateLimiter({ maxRequests: 30, windowMs: 60000 });

// WAF for query string attack detection
const waf = createWaf();

// Security headers for all responses
const securityHeaders = getSecurityHeaders();

// Circuit breaker for external API calls (GitHub API)
const githubBreaker = new CircuitBreaker({ 
  failureThreshold: 5, 
  successThreshold: 3,
  resetTimeoutMs: 30000 
});

// Token cache with TTL
interface TokenCacheEntry {
  user: AuthState["user"];
  scopes: string[];
  expires: number;
}
const tokenCache = new Map<string, TokenCacheEntry>();
const TOKEN_CACHE_TTL = 300000; // 5 minutes

// Token cache helpers
function getCachedToken(token: string): TokenCacheEntry | null {
  const cached = tokenCache.get(token);
  if (cached && Date.now() < cached.expires) {
    return cached;
  }
  tokenCache.delete(token);
  return null;
}

function setCachedToken(token: string, user: AuthState["user"], scopes: string[]): void {
  tokenCache.set(token, { user, scopes, expires: Date.now() + TOKEN_CACHE_TTL });
}

// Clean up expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokenCache) {
    if (now > entry.expires) {
      tokenCache.delete(token);
    }
  }
}, 60000);

// ---------------------------------------------------------------------------
// Resilient GitHub API wrapper (@creadev.org/qos)
// ---------------------------------------------------------------------------

/** Execute with circuit breaker and retry */
async function githubFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return githubBreaker.execute(async () => {
    return withRetry(() => fetch(url, options), {
      retries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    });
  });
}

// ---------------------------------------------------------------------------
// Auth state (in-memory only, never persisted)
// ---------------------------------------------------------------------------

interface AuthState {
  token?: string;
  user?: {
    id: string;
    login: string;
    name: string;
    avatar: string;
  };
  scopes: string[];
  expiresAt?: number;
}

// In-memory auth state - cleared on server restart
// SECURITY: This is intentionally ephemeral for local dev
const authState: AuthState = {
  scopes: [],
};

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

  // Check body size limit using WAF
  if (!waf.checkBodySize(req.headers)) {
    return jsonError(res, 413, "Request too large");
  }

  // Check for attack patterns in query string via WAF
  if (url.search && !waf.checkQuery(url.search).allowed) {
    return jsonError(res, 400, "Invalid request");
  }

  // Apply security headers to all responses
  for (const [key, value] of Object.entries(securityHeaders)) {
    res.setHeader(key, String(value));
  }

  // CORS for the hosted migrare.dev frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.github.com https://localhost:*; frame-ancestors 'none'");
  
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  
  // Basic WAF: block common attack patterns in query
  const query = url.searchParams.toString();
  if (query && /(<script|javascript:|onerror=|onload=|eval\(|expression\()/i.test(query)) {
    return jsonError(res, 400, "Invalid query");
  }

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------

  if (path === "/api/health" && method === "GET") {
    return json(res, { ok: true, version: "0.1.0" });
  }

  // ---------------------------------------------------------------------------
  // Auth endpoints
  // ---------------------------------------------------------------------------

  if (path === "/api/auth/status" && method === "GET") {
    // Rate limit status checks using @creadev.org/security RateLimiter
    const ip = getClientIP(req.headers, 'x-forwarded-for') ?? 'unknown';
    const rateCheck = rateLimiter.check(ip, 'auth-status');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter ?? 1));
      return jsonError(res, 429, "Too many requests");
    }
    
    // Return auth state without exposing the token
    if (authState.token && authState.user) {
      return json(res, {
        authenticated: true,
        user: authState.user,
        scopes: authState.scopes,
      });
    }
    return json(res, { authenticated: false });
  }

  if (path === "/api/auth/github/token" && method === "POST") {
    // Rate limit token requests using @creadev.org/security
    const ip = getClientIP(req.headers, 'x-forwarded-for') ?? 'unknown';
    const rateCheck = rateLimiter.check(ip, 'auth-token');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter ?? 1));
      return jsonError(res, 429, "Too many requests");
    }

    const body = await readBody(req);
    const { code, token: inputToken } = JSON.parse(body);

    try {
      let token = inputToken;

      if (code && !token) {
        // OAuth code exchange
        const clientSecret = process.env.MIGRARE_GITHUB_CLIENT_SECRET;
        if (!clientSecret) {
          return jsonError(res, 500, "OAuth not configured");
        }
        
        // Exchange code for token
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: process.env.MIGRARE_GITHUB_CLIENT_ID || "Ov23lijPqkbtomPfV1aY",
            client_secret: clientSecret,
            code,
          }),
        });
        
        if (!tokenRes.ok) {
          return jsonError(res, 401, "OAuth code exchange failed");
        }
        
        const tokenData = await tokenRes.json();
        token = tokenData.access_token;
        
        if (!token) {
          return jsonError(res, 401, "No access token returned");
        }
      }

      if (!token) {
        return jsonError(res, 400, "Token required");
      }

      // Check token cache first
      const cached = getCachedToken(token);
      if (cached) {
        return json(res, { user: cached.user, scopes: cached.scopes, cached: true });
      }

      // Validate the token using resilient GitHub API wrapper
      const userRes = await githubFetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (!userRes.ok) {
        return jsonError(res, 401, "Invalid token");
      }

      const user = await userRes.json();
      const scopeHeader = userRes.headers.get("x-oauth-scopes") ?? "";
      const scopes = scopeHeader.split(",").map((s: string) => s.trim()).filter(Boolean);

      // Cache the validation result
      setCachedToken(token, authState.user!, scopes);

      // Store token in auth state only if OAuth code exchange
      if (code && !authState.token) {
        authState.token = token;
      }

      // Return user info (never the token)
      authState.user = {
        id: String(user.id),
        login: user.login,
        name: user.name ?? user.login,
        avatar: user.avatar_url,
      };
      authState.scopes = scopes;

      // Return user info + token (for OAuth code exchange, include token)
      return json(res, {
        user: authState.user,
        scopes,
        token: code ? authState.token : undefined,
      });
    } catch (err) {
      return jsonError(res, 500, "Auth failed");
    }
  }

  if (path === "/api/auth/logout" && method === "POST") {
    // Clear auth state - reset to initial
    authState.token = undefined as unknown as string;
    authState.user = undefined as unknown as { id: string; login: string; name: string; avatar: string };
    authState.scopes = [];
    return json(res, { ok: true });
  }

  // Get user's repos (for picker)
  if (path === "/api/auth/repos" && method === "GET") {
    // Rate limit repo requests using @creadev.org/security
    const ip = getClientIP(req.headers, 'x-forwarded-for') ?? 'unknown';
    const rateCheck = rateLimiter.check(ip, 'auth-repos');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter ?? 1));
      return jsonError(res, 429, "Too many requests");
    }

    if (!authState.token) {
      return jsonError(res, 401, "Not authenticated");
    }

    // Optional query params for filtering
    const rawVisibility = url.searchParams.get("visibility");
    const rawAffiliation = url.searchParams.get("affiliation");
    const rawPerPage = url.searchParams.get("per_page"); 
    
    // Validate query params
    const visibility = (rawVisibility === "private" || rawVisibility === "public") ? rawVisibility : undefined;
    const affiliation = rawAffiliation ? sanitizeRepoName(rawAffiliation) : undefined;
    const perPage = Math.min(parseInt(rawPerPage ?? "30", 10) || 30, 100);

    const params = new URLSearchParams({ sort: "updated", per_page: String(perPage) });
    if (visibility) params.set("visibility", visibility);
    if (affiliation) params.set("affiliation", affiliation);

    try {
      // Fetch repos using resilient GitHub API wrapper
      const ghRes = await githubFetch(`https://api.github.com/user/repos?${params}`, {
        headers: {
          Authorization: `Bearer ${authState.token}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (!ghRes.ok) {
        const status = ghRes.status;
        return jsonError(res, status, "Failed to fetch repos");
      }

      const repos = await ghRes.json();
      // Return sanitized repo list
      const sanitized = repos.map((r: any) => ({
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        description: r.description,
        updated: r.updated_at,
        language: r.language,
        stars: r.stargazers_count,
      }));

      return json(res, { repos: sanitized });
    } catch (err) {
      return jsonError(res, 500, "Failed to fetch repos");
    }
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
    // Rate limit scan requests using @creadev.org/security
    const ip = getClientIP(req.headers, 'x-forwarded-for') ?? 'unknown';
    const rateCheck = rateLimiter.check(ip, 'scan');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter ?? 1));
      return jsonError(res, 429, "Too many scan requests");
    }

    const body = await readBody(req);
    const { source } = JSON.parse(body);
    if (!source) return jsonError(res, 400, "Missing source");

    // Validate and sanitize the source path using @creadev.org/security
    if (typeof source === "object" && "path" in source) {
      const sanitized = sanitizePath(source.path);
      if (!sanitized) return jsonError(res, 400, "Invalid source path");
      source.path = sanitized;
    }

    const report = await engine.scan(source);
    return json(res, report);
  }

  if (path === "/api/migrate" && method === "POST") {
    // Rate limit migrate requests using @creadev.org/security
    const ip = getClientIP(req.headers, 'x-forwarded-for') ?? 'unknown';
    const rateCheck = rateLimiter.check(ip, 'migrate');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter ?? 1));
      return jsonError(res, 429, "Too many migrate requests");
    }

    const body = await readBody(req);
    const { source, targetAdapter, targetPath, dryRun, options: adapterOptions } = JSON.parse(body);
    if (!source || !targetAdapter || !targetPath) {
      return jsonError(res, 400, "Missing required fields: source, targetAdapter, targetPath");
    }

    // Validate and sanitize source path using @creadev.org/security
    if (typeof source === "object" && "path" in source) {
      const sanitized = sanitizePath(source.path);
      if (!sanitized) return jsonError(res, 400, "Invalid source path");
      source.path = sanitized;
    }

    // Validate targetPath using @creadev.org/security
    const sanitizedTarget = sanitizePath(targetPath);
    if (!sanitizedTarget) return jsonError(res, 400, "Invalid target path");

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
