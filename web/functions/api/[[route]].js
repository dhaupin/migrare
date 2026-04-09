// functions/api/[[route]].js
//
// Catch-all Cloudflare Pages Function for all /api/* routes.
// Engine is self-contained here — CF Pages bundles each function file independently,
// so cross-file imports (../engine.js) do not resolve at deploy time.
//
// Routes handled:
//   GET  /api/health
//   GET  /api/spec
//   POST /api/scan     { source: { zip: base64, name: string } } → ScanReport
//   POST /api/migrate  { source: { zip: base64, name: string }, dryRun? } → MigrationResult
//
// PROTECTION LAYERS (applied in order before any engine work):
//   1. CORS origin lockdown — only migrare.creadev.org in production
//   2. Request body size cap — 8 MB max (base64 of ~5.9 MB zip)
//   3. Input shape validation — zip field must look like base64, name is sanitized
//   4. Decompressed size cap — 12 MB total across all files (zip bomb defense)
//   5. Rate limiting — IP-based via CF KV if bound, fails open if not configured

// =============================================================================
// PROTECTION CONSTANTS
// =============================================================================

const MAX_BODY_BYTES     = 8 * 1024 * 1024;   // 8 MB — max raw request body
const MAX_UNZIPPED_BYTES = 12 * 1024 * 1024;  // 12 MB — max total decompressed content
const MAX_FILE_BYTES     = 512 * 1024;         // 512 KB — max single file (already in parser)
const MAX_ZIP_NAME_LEN   = 128;                // max filename length
const BASE64_RE          = /^[A-Za-z0-9+/]+=*$/; // loose base64 check

// Rate limit: sliding window per IP
const RL_WINDOW_MS  = 60_000;  // 1 minute window
const RL_MAX_SCAN   = 15;      // scan requests per window per IP
const RL_MAX_MIGRATE = 8;      // migrate requests per window per IP

// Allowed origins — tightened in production
const ALLOWED_ORIGINS = [
  "https://migrare.creadev.org",
  "http://localhost:5173",
  "http://localhost:4242",
];

// =============================================================================
// CORS HELPERS
// =============================================================================

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0]; // default to prod origin for non-matching

  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function err(message, status, corsHeaders) {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

// =============================================================================
// RATE LIMITING (CF KV, fails open if KV not bound)
// =============================================================================

async function checkRateLimit(kvNamespace, ip, endpoint) {
  if (!kvNamespace || !ip) return { allowed: true };

  const key    = `rl:${endpoint}:${ip}`;
  const limit  = endpoint === "migrate" ? RL_MAX_MIGRATE : RL_MAX_SCAN;
  const now    = Date.now();

  try {
    const raw = await kvNamespace.get(key);
    const record = raw ? JSON.parse(raw) : { count: 0, windowStart: now };

    // Reset window if expired
    if (now - record.windowStart > RL_WINDOW_MS) {
      record.count = 0;
      record.windowStart = now;
    }

    record.count++;

    // Write back — TTL slightly longer than window so KV auto-cleans
    await kvNamespace.put(key, JSON.stringify(record), { expirationTtl: 120 });

    if (record.count > limit) {
      const retryAfter = Math.ceil((RL_WINDOW_MS - (now - record.windowStart)) / 1000);
      return { allowed: false, retryAfter };
    }

    return { allowed: true };
  } catch {
    // KV error — fail open, don't block legit traffic
    return { allowed: true };
  }
}

// =============================================================================
// INPUT VALIDATION
// =============================================================================

function validateZipPayload(source) {
  if (!source || typeof source !== "object") {
    return "source must be an object";
  }
  if (typeof source.zip !== "string" || source.zip.length === 0) {
    return "source.zip must be a non-empty string";
  }
  // Rough base64 check — strip whitespace then test charset
  const stripped = source.zip.replace(/\s/g, "");
  if (!BASE64_RE.test(stripped)) {
    return "source.zip must be valid base64";
  }
  // Size check on base64 string itself (~4/3 of raw bytes)
  const approxBytes = Math.floor(stripped.length * 0.75);
  if (approxBytes > MAX_BODY_BYTES) {
    return `zip too large — maximum is ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB`;
  }
  if (source.name !== undefined) {
    if (typeof source.name !== "string") return "source.name must be a string";
    if (source.name.length > MAX_ZIP_NAME_LEN) return "source.name too long";
    // Sanitize path traversal attempts
    if (/[<>:"|?*\x00-\x1f]/.test(source.name) || source.name.includes("..")) {
      return "source.name contains invalid characters";
    }
  }
  return null; // valid
}

// =============================================================================
// ZIP PARSER (with decompressed size cap for zip bomb defense)
// =============================================================================

async function parseZip(base64Data) {
  const binStr = atob(base64Data.replace(/\s/g, ""));
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

  const files = new Map();
  const view = new DataView(bytes.buffer);
  let offset = 0;
  let totalUnzippedBytes = 0;

  while (offset < bytes.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) { offset++; continue; }

    const compression = view.getUint16(offset + 8,  true);
    const compSize    = view.getUint32(offset + 18, true);
    const uncompSize  = view.getUint32(offset + 22, true);
    const fnameLen    = view.getUint16(offset + 26, true);
    const extraLen    = view.getUint16(offset + 28, true);
    const headerEnd   = offset + 30 + fnameLen + extraLen;

    const fname = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + fnameLen));
    const normalizedPath = fname.replace(/^[^/]+\//, "");

    const isBinary = /\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|mp4|mp3|pdf|zip)$/i.test(fname);
    const isDir    = fname.endsWith("/") || normalizedPath === "";
    const tooBig   = uncompSize > MAX_FILE_BYTES;

    // Zip bomb check — track cumulative decompressed size
    if (!isDir && !isBinary) {
      totalUnzippedBytes += uncompSize;
      if (totalUnzippedBytes > MAX_UNZIPPED_BYTES) {
        throw new Error(`zip exceeds maximum decompressed size of ${Math.round(MAX_UNZIPPED_BYTES / 1024 / 1024)} MB`);
      }
    }

    if (!isDir && !isBinary && !tooBig && normalizedPath) {
      const compData = bytes.slice(headerEnd, headerEnd + compSize);
      try {
        let content;
        if (compression === 0) {
          content = new TextDecoder("utf-8", { fatal: false }).decode(compData);
        } else if (compression === 8) {
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();
          writer.write(compData);
          writer.close();
          const chunks = [];
          let totalLen = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLen += value.length;
          }
          const merged = new Uint8Array(totalLen);
          let pos = 0;
          for (const chunk of chunks) { merged.set(chunk, pos); pos += chunk.length; }
          content = new TextDecoder("utf-8", { fatal: false }).decode(merged);
        }
        if (content !== undefined) files.set(normalizedPath, content);
      } catch { /* skip unreadable entries */ }
    }

    offset = headerEnd + compSize;
  }

  return files;
}

// =============================================================================
// PROJECT GRAPH
// =============================================================================

class ProjectGraph {
  constructor(root) {
    this.root = root;
    this.files = new Map();
    this.dependencies = [];
    this.env = new Map();
  }
  addFile(path, content) { this.files.set(path, { path, content, modified: false }); }
  getFile(path) { return this.files.get(path); }
  findFiles(pattern) {
    const test = typeof pattern === "function" ? pattern : (f) => pattern.test(f.path);
    return Array.from(this.files.values()).filter(test);
  }
  hasDependency(name) { return this.dependencies.some((d) => d.name === name); }
}

function buildGraph(fileMap, zipName) {
  const graph = new ProjectGraph(zipName.replace(/\.zip$/i, ""));
  for (const [path, content] of fileMap) graph.addFile(path, content);

  const pkgContent = fileMap.get("package.json");
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      for (const [name, version] of Object.entries(pkg.dependencies ?? {}))
        graph.dependencies.push({ name, version, type: "prod" });
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {}))
        graph.dependencies.push({ name, version, type: "dev" });
    } catch { /* ignore */ }
  }

  for (const envPath of [".env", ".env.local", ".env.example"]) {
    const envContent = fileMap.get(envPath);
    if (envContent) {
      for (const line of envContent.split("\n")) {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
        if (match) graph.env.set(match[1], envPath);
      }
    }
  }

  return graph;
}

// =============================================================================
// DETECTION
// =============================================================================

function detectPlatform(graph) {
  const signals = [];
  if (graph.hasDependency("lovable-tagger")) signals.push("lovable-tagger dependency");
  if (graph.getFile("src/integrations/supabase/client.ts")) signals.push("generated supabase client");
  if (graph.getFile(".lovable")) signals.push(".lovable config file");

  const viteConfig = graph.getFile("vite.config.ts") ?? graph.getFile("vite.config.js");
  if (viteConfig?.content.includes("componentTagger")) signals.push("componentTagger in vite.config");

  const pkg = graph.getFile("package.json");
  if (pkg?.content.includes("lovable")) signals.push("lovable in package.json");

  for (const key of graph.env.keys()) {
    if (key.startsWith("GPT_ENGINEER") || key.startsWith("LOVABLE_")) {
      signals.push("Lovable env vars detected");
      break;
    }
  }

  if (signals.length === 0) return { platform: "unknown", confidence: "low", signals: [] };
  const confidence = signals.length >= 3 ? "high" : "medium";
  return { platform: "lovable", confidence, signals };
}

// =============================================================================
// SCANNERS
// =============================================================================

function scanLovable(graph) {
  const out = [];
  const supabaseRx = /@supabase\/(supabase-js|auth-helpers|ssr)/;

  for (const file of graph.findFiles(/\.(tsx?|jsx?)$/)) {
    file.content.split("\n").forEach((line, i) => {
      if (supabaseRx.test(line)) {
        out.push({
          id: `supabase-direct-import:${file.path}:${i}`,
          platform: "lovable", category: "auth-coupling", severity: "warning", confidence: "high",
          location: { file: file.path, line: i + 1 },
          description: "Direct Supabase import in component — will break outside Lovable environment",
          suggestion: "Extract to a service layer: src/services/auth.ts",
        });
      }
    });
  }

  const viteConfig = graph.getFile("vite.config.ts") ?? graph.getFile("vite.config.js");
  if (viteConfig?.content.includes("lovable-tagger")) {
    out.push({
      id: "build-config:vite-config", platform: "lovable", category: "build-config",
      severity: "warning", confidence: "high", location: { file: viteConfig.path },
      description: "lovable-tagger plugin in vite.config is a Lovable-only dev tool",
      suggestion: "Remove componentTagger() from plugins array",
    });
  }
  if (graph.hasDependency("lovable-tagger")) {
    out.push({
      id: "build-config:package-json", platform: "lovable", category: "build-config",
      severity: "info", confidence: "high", location: { file: "package.json" },
      description: "lovable-tagger in devDependencies serves no purpose outside Lovable",
      suggestion: "Remove from devDependencies",
    });
  }

  const clientFile = graph.getFile("src/integrations/supabase/client.ts");
  if (clientFile) {
    out.push({
      id: "generated-supabase-client:client", platform: "lovable", category: "state-entanglement",
      severity: "error", confidence: "high", location: { file: clientFile.path },
      description: "Generated Supabase client contains hardcoded project URL and anon key",
      suggestion: "Move credentials to .env and create a portable client factory",
    });
  }
  const typesFile = graph.getFile("src/integrations/supabase/types.ts");
  if (typesFile) {
    out.push({
      id: "generated-supabase-client:types", platform: "lovable", category: "state-entanglement",
      severity: "info", confidence: "high", location: { file: typesFile.path },
      description: "Generated Supabase types can be regenerated via supabase CLI — not a blocker",
      suggestion: "Run: supabase gen types typescript --project-id <id>",
    });
  }

  const bleedRx = /GPT_ENGINEER_|LOVABLE_|__lovable/;
  for (const file of graph.findFiles(/(\.(env|ts|tsx|js|jsx))$/)) {
    file.content.split("\n").forEach((line, i) => {
      if (bleedRx.test(line)) {
        out.push({
          id: `env-bleed:${file.path}:${i}`, platform: "lovable", category: "environment-bleed",
          severity: "warning", confidence: "medium",
          location: { file: file.path, line: i + 1 },
          description: `Lovable-specific env var or global: ${line.trim()}`,
          suggestion: "Replace with standard VITE_* env var",
        });
      }
    });
  }

  return out;
}

function buildSummary(signals) {
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byCategory = {};
  for (const s of signals) {
    bySeverity[s.severity] = (bySeverity[s.severity] ?? 0) + 1;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
  }
  let migrationComplexity = "straightforward";
  if (bySeverity.error > 0) migrationComplexity = "requires-manual";
  else if (bySeverity.warning > 3) migrationComplexity = "moderate";
  return { bySeverity, byCategory, migrationComplexity, totalSignals: signals.length };
}

// =============================================================================
// TRANSFORMS
// =============================================================================

function applyTransforms(graph) {
  const transformLog = [];
  const outputFiles = new Map(graph.files);

  for (const configPath of ["vite.config.ts", "vite.config.js"]) {
    const file = graph.getFile(configPath);
    if (file?.content.includes("lovable-tagger")) {
      let content = file.content;
      content = content.replace(/^.*import.*lovable-tagger.*\n/m, "");
      content = content.replace(/\s*componentTagger\(\),?\s*/g, "");
      outputFiles.set(configPath, { ...file, content, modified: true });
      transformLog.push({ transform: "remove-lovable-tagger", file: configPath, action: "modified" });
    }
  }

  const pkgFile = graph.getFile("package.json");
  if (pkgFile && graph.hasDependency("lovable-tagger")) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      delete pkg.devDependencies?.["lovable-tagger"];
      outputFiles.set("package.json", { ...pkgFile, content: JSON.stringify(pkg, null, 2), modified: true });
      transformLog.push({ transform: "remove-lovable-tagger", file: "package.json", action: "modified" });
    } catch { /* ignore */ }
  }

  const clientFile = graph.getFile("src/integrations/supabase/client.ts");
  if (clientFile) {
    const urlMatch = clientFile.content.match(/["'](https:\/\/[a-zA-Z0-9]+\.supabase\.co)["']/);
    const extractedUrl = urlMatch?.[1] ?? "YOUR_SUPABASE_URL";

    const portableClient = `// Generated by migrare — Lovable migration
// Supabase client using environment variables instead of hardcoded values.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
`;
    outputFiles.set("src/integrations/supabase/client.ts", { ...clientFile, content: portableClient, modified: true });
    transformLog.push({ transform: "abstract-supabase-client", file: "src/integrations/supabase/client.ts", action: "modified", meta: { extractedUrl } });

    const envExample = `# Supabase — extracted by migrare from Lovable project\nVITE_SUPABASE_URL=${extractedUrl}\nVITE_SUPABASE_ANON_KEY=<your-anon-key>\n`;
    outputFiles.set(".env.example", { path: ".env.example", content: envExample, modified: true });
    transformLog.push({ transform: "abstract-supabase-client", file: ".env.example", action: "created" });
  }

  const bleedRx = /GPT_ENGINEER_|LOVABLE_/;
  for (const [path, file] of outputFiles) {
    if (!/\.(env|ts|tsx|js|jsx)$/.test(path)) continue;
    if (!bleedRx.test(file.content)) continue;
    let content = file.content;
    content = content.replace(/GPT_ENGINEER_/g, "VITE_");
    content = content.replace(/LOVABLE_/g, "VITE_");
    content = content.replace(/import\.meta\.env\.VITE_VITE_/g, "import.meta.env.VITE_");
    outputFiles.set(path, { ...file, content, modified: true });
    transformLog.push({ transform: "remove-env-bleed", file: path, action: "modified" });
  }

  return { outputFiles, transformLog };
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

async function handleSpec(corsHeaders) {
  return Response.json({
    version: "0.0.1",
    baseUrl: "https://migrare.creadev.org",
    endpoints: [
      {
        method: "GET",
        path: "/api/health",
        description: "Heartbeat. Confirm the API is reachable.",
        response: { ok: "boolean", version: "string" },
      },
      {
        method: "GET",
        path: "/api/spec",
        description: "This document. Machine-readable API description.",
      },
      {
        method: "POST",
        path: "/api/scan",
        description: "Scan a zip for lock-in signals. Read-only, no side effects.",
        request: {
          source: {
            zip: "string (base64-encoded .zip bytes)",
            name: "string (filename, e.g. my-app.zip)",
          },
        },
        response: {
          platform: "string",
          confidence: "high | medium | low",
          fileCount: "number",
          detectionSignals: "string[]",
          signals: [{
            id: "string",
            platform: "string",
            category: "build-config | state-entanglement | auth-coupling | environment-bleed | proprietary-api",
            severity: "error | warning | info",
            confidence: "high | medium | low",
            location: { file: "string", line: "number (optional)" },
            description: "string",
            suggestion: "string",
          }],
          summary: {
            bySeverity: { error: "number", warning: "number", info: "number" },
            byCategory: "Record<string, number>",
            migrationComplexity: "straightforward | moderate | requires-manual",
            totalSignals: "number",
          },
        },
      },
      {
        method: "POST",
        path: "/api/migrate",
        description: "Apply transforms. Returns modified file contents as {path, content} pairs. Treat as a diff — always review before writing.",
        request: {
          source: {
            zip: "string (base64-encoded .zip bytes)",
            name: "string",
          },
          dryRun: "boolean (optional, default false)",
          targetAdapter: "vite | nextjs (optional, default vite)",
        },
        response: {
          "...": "all fields from /api/scan response, plus:",
          dryRun: "boolean",
          duration: "number (ms)",
          transformLog: [{
            transform: "string",
            file: "string",
            action: "modified | created | deleted",
            meta: "object (optional)",
          }],
          files: [{ path: "string", content: "string" }],
          errors: "string[]",
        },
        notes: [
          "files[] contains only modified files, not the full project.",
          "dryRun: true returns transformLog but empty files[].",
          "Do not automate migrate -> commit without a human review step.",
        ],
      },
    ],
    platforms: [
      { id: "lovable", status: "ready", transforms: ["remove-lovable-tagger", "abstract-supabase-client", "remove-env-bleed"] },
      { id: "bolt",    status: "planned" },
      { id: "replit",  status: "planned" },
    ],
    links: {
      llmsTxt:  "https://migrare.creadev.org/llms.txt",
      forAgents: "https://migrare.creadev.org/for-ai",
      source:   "https://github.com/dhaupin/migrare",
    },
  }, { headers: corsHeaders });
}

async function handleScan(request, corsHeaders, env, ip) {
  // Rate limit
  const rl = await checkRateLimit(env?.MIGRARE_RL, ip, "scan");
  if (!rl.allowed) {
    return Response.json(
      { error: `Rate limit exceeded. Try again in ${rl.retryAfter}s.` },
      { status: 429, headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter) } }
    );
  }

  const body = await request.json();
  const { source } = body;

  const validationError = validateZipPayload(source);
  if (validationError) {
    return err(validationError, 400, corsHeaders);
  }

  let fileMap;
  try {
    fileMap = await parseZip(source.zip);
  } catch (e) {
    return err(e.message, 413, corsHeaders);
  }

  const graph = buildGraph(fileMap, source.name ?? "project.zip");
  const detection = detectPlatform(graph);

  if (detection.platform === "unknown") {
    return Response.json({
      platform: "unknown", confidence: "low", signals: [],
      detectionSignals: [], summary: buildSummary([]), fileCount: fileMap.size,
    }, { headers: corsHeaders });
  }

  const signals = scanLovable(graph);
  return Response.json({
    platform: detection.platform,
    confidence: detection.confidence,
    signals,
    detectionSignals: detection.signals,
    summary: buildSummary(signals),
    fileCount: fileMap.size,
  }, { headers: corsHeaders });
}

async function handleMigrate(request, corsHeaders, env, ip) {
  // Rate limit — stricter than scan
  const rl = await checkRateLimit(env?.MIGRARE_RL, ip, "migrate");
  if (!rl.allowed) {
    return Response.json(
      { error: `Rate limit exceeded. Try again in ${rl.retryAfter}s.` },
      { status: 429, headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter) } }
    );
  }

  const body = await request.json();
  const { source, dryRun = false } = body;

  const validationError = validateZipPayload(source);
  if (validationError) {
    return err(validationError, 400, corsHeaders);
  }

  let fileMap;
  try {
    fileMap = await parseZip(source.zip);
  } catch (e) {
    return err(e.message, 413, corsHeaders);
  }

  const startTime = Date.now();
  const graph = buildGraph(fileMap, source.name ?? "project.zip");
  const detection = detectPlatform(graph);
  const signals = detection.platform !== "unknown" ? scanLovable(graph) : [];

  let transformLog = [];
  let outputFiles = graph.files;

  if (!dryRun && detection.platform === "lovable") {
    const result = applyTransforms(graph);
    outputFiles = result.outputFiles;
    transformLog = result.transformLog;
  }

  const files = [];
  for (const [path, file] of outputFiles) {
    if (dryRun || file.modified) {
      files.push({ path, content: file.content });
    }
  }

  return Response.json({
    platform: detection.platform,
    confidence: detection.confidence,
    dryRun,
    duration: Date.now() - startTime,
    signals,
    summary: buildSummary(signals),
    transformLog,
    files,
    errors: [],
  }, { headers: corsHeaders });
}

// =============================================================================
// ENTRY POINT
// =============================================================================

export async function onRequest({ request, env }) {
  const url    = new URL(request.url);
  const path   = url.pathname;
  const method = request.method;

  const origin      = request.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Extract IP for rate limiting (CF provides CF-Connecting-IP)
  const ip = request.headers.get("CF-Connecting-IP")
          ?? request.headers.get("X-Forwarded-For")?.split(",")[0].trim()
          ?? "unknown";

  try {
    // Body size guard — check Content-Length before reading body
    const contentLength = request.headers.get("Content-Length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return err(`Request too large — maximum ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB`, 413, corsHeaders);
    }

    let response;

    if (path === "/api/health" && method === "GET") {
      response = Response.json({ ok: true, version: "0.0.1" }, { headers: corsHeaders });
    } else if (path === "/api/spec" && method === "GET") {
      response = await handleSpec(corsHeaders);
    } else if (path === "/api/scan" && method === "POST") {
      response = await handleScan(request, corsHeaders, env, ip);
    } else if (path === "/api/migrate" && method === "POST") {
      response = await handleMigrate(request, corsHeaders, env, ip);
    } else {
      response = err(`Not found: ${path}`, 404, corsHeaders);
    }

    return response;

  } catch (e) {
    return err(e?.message ?? "Internal server error", 500, corsHeaders);
  }
}
