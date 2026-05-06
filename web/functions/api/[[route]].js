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

    // Bounds check: verify we have enough bytes for this entry header
    if (headerEnd + compSize > bytes.length) {
      break; // malformed zip, stop processing
    }

    const fname = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + fnameLen));
    // Reject path traversal attempts
    if (fname.includes("..") || fname.startsWith("/")) {
      offset = headerEnd + compSize;
      continue;
    }
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

  // Bolt detection
  const boltSignals = [];
  if (graph.getFile(".bolt")) boltSignals.push(".bolt config file");
  if (graph.getFile(".stackblitz")) boltSignals.push(".stackblitz config");
  const hasBoltDep = graph.hasDependency("@boltdev/vite-plugin");
  const hasBoltDeps = graph.hasDependency("@boltdev/plugins");
  if (hasBoltDep || hasBoltDeps) {
    boltSignals.push("@boltdev/vite-plugin dependency");
  }
  const boltViteConfig = graph.getFile("vite.config.ts") ?? graph.getFile("vite.config.js");
  if (boltViteConfig?.content.includes("@boltdev") || boltViteConfig?.content.includes("boltPlugin")) {
    boltSignals.push("Bolt plugin in vite.config");
  }
  for (const key of graph.env.keys()) {
    if (key.startsWith("BOLT_") || key.startsWith("GPT_ENGINEER")) {
      boltSignals.push("Bolt env vars detected");
      break;
    }
  }

  // Return platform with highest confidence
  if (boltSignals.length > 0) {
    const confidence = boltSignals.length >= 2 ? "high" : "medium";
    return { platform: "bolt", confidence, signals: boltSignals };
  }

  // Replit detection
  const replitSignals = [];
  if (graph.getFile(".replit")) replitSignals.push(".replit config file");
  if (graph.getFile("replit.nix")) replitSignals.push("replit.nix config");
  const replitPkg = graph.getFile("package.json");
  if (replitPkg?.content.includes("replit") || replitPkg?.content.includes("@replit")) {
    replitSignals.push("replit dependency in package.json");
  }
  for (const key of graph.env.keys()) {
    if (key.startsWith("REPLIT_") || key.startsWith("REPL_")) {
      replitSignals.push("Replit env vars detected");
      break;
    }
  }

  if (replitSignals.length > 0) {
    const confidence = replitSignals.length >= 2 ? "high" : "medium";
    return { platform: "replit", confidence, signals: replitSignals };
  }

  // v0 detection (Vercel)
  const v0Signals = [];
  if (graph.getFile(".v0")) v0Signals.push(".v0 config folder");
  if (graph.getFile(".v0config.json")) v0Signals.push("v0 config file");
  const v0Pkg = graph.getFile("package.json");
  if (v0Pkg?.content.includes("@vercel/v0") || v0Pkg?.content.includes("v0-core")) {
    v0Signals.push("v0 dependency in package.json");
  }

  if (v0Signals.length > 0) {
    const confidence = v0Signals.length >= 2 ? "high" : "medium";
    return { platform: "v0", confidence, signals: v0Signals };
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

// =============================================================================
// BOLT SCANNER
// =============================================================================

function scanBolt(graph) {
  const out = [];
  const supabaseRx = /@supabase\/(supabase-js|auth-helpers|ssr)/;

  // Supabase direct imports (same as Lovable)
  for (const file of graph.findFiles(/\.(tsx?|jsx?)$/)) {
    file.content.split("\n").forEach((line, i) => {
      if (supabaseRx.test(line)) {
        out.push({
          id: `supabase-direct-import:${file.path}:${i}`,
          platform: "bolt", category: "auth-coupling", severity: "warning", confidence: "high",
          location: { file: file.path, line: i + 1 },
          description: "Direct Supabase import in component — will break outside Bolt environment",
          suggestion: "Extract to a service layer: src/services/auth.ts",
        });
      }
    });
  }

  // Bolt plugin in vite.config
  const viteConfig = graph.getFile("vite.config.ts") ?? graph.getFile("vite.config.js");
  if (viteConfig?.content.includes("@boltdev") || viteConfig?.content.includes("boltPlugin")) {
    out.push({
      id: "build-config:vite-config", platform: "bolt", category: "build-config",
      severity: "warning", confidence: "high", location: { file: viteConfig.path },
      description: "Bolt vite plugin in config - Bolt-only dev tool",
      suggestion: "Remove Bolt plugin from plugins array",
    });
  }

  // Bolt plugin dependency
  const hasBoltDep = graph.hasDependency("@boltdev/vite-plugin");
  const hasBoltDep2 = graph.hasDependency("@boltdev/plugins");
  if (hasBoltDep || hasBoltDep2) {
    out.push({
      id: "build-config:package-json", platform: "bolt", category: "build-config",
      severity: "info", confidence: "high", location: { file: "package.json" },
      description: "@boltdev/vite-plugin in devDependencies serves no purpose outside Bolt",
      suggestion: "Remove from devDependencies",
    });
  }

  // Generated Supabase client (same pattern as Lovable)
  const clientFile = graph.getFile("src/integrations/supabase/client.ts");
  if (clientFile) {
    out.push({
      id: "generated-supabase-client:client", platform: "bolt", category: "state-entanglement",
      severity: "error", confidence: "high", location: { file: clientFile.path },
      description: "Generated Supabase client contains hardcoded project URL and anon key",
      suggestion: "Move credentials to .env and create a portable client factory",
    });
  }

  // Bolt env var bleed
  const boltBleedRx = /GPT_ENGINEER_|BOLT_|__bolt/;
  for (const file of graph.findFiles(/(\.(env|ts|tsx|js|jsx))$/)) {
    file.content.split("\n").forEach((line, i) => {
      if (boltBleedRx.test(line)) {
        out.push({
          id: `env-bleed:${file.path}:${i}`, platform: "bolt", category: "environment-bleed",
          severity: "warning", confidence: "medium",
          location: { file: file.path, line: i + 1 },
          description: `Bolt-specific env var: ${line.trim()}`,
          suggestion: "Replace with standard VITE_* env var",
        });
      }
    });
  }

  return out;
}

// =============================================================================
// REPLIT SCANNER
// =============================================================================

function scanReplit(graph) {
  const out = [];
  const supabaseRx = /@supabase\/(supabase-js|auth-helpers|ssr)/;

  // Supabase direct imports (same as Lovable/Bolt)
  for (const file of graph.findFiles(/\.(tsx?|jsx?)$/)) {
    file.content.split("\n").forEach((line, i) => {
      if (supabaseRx.test(line)) {
        out.push({
          id: `supabase-direct-import:${file.path}:${i}`,
          platform: "replit", category: "auth-coupling", severity: "warning", confidence: "high",
          location: { file: file.path, line: i + 1 },
          description: "Direct Supabase import in component — will break outside Replit environment",
          suggestion: "Extract to a service layer: src/services/auth.ts",
        });
      }
    });
  }

  // Replit config files
  if (graph.getFile(".replit") || graph.getFile("replit.nix")) {
    out.push({
      id: "build-config:replit-config", platform: "replit", category: "build-config",
      severity: "warning", confidence: "high", location: { file: ".replit" },
      description: "Replit configuration file present - Replit-specific setup",
      suggestion: "Remove .replit and replit.nix, use standard package.json scripts",
    });
  }

  // Replit dependencies
  const replitPkg = graph.getFile("package.json");
  if (replitPkg?.content.includes("replit")) {
    out.push({
      id: "build-config:replit-deps", platform: "replit", category: "build-config",
      severity: "info", confidence: "high", location: { file: "package.json" },
      description: "Replit-specific packages in dependencies",
      suggestion: "Remove replit packages from dependencies",
    });
  }

  // Generated Supabase client (same pattern as Lovable/Bolt)
  const clientFile = graph.getFile("src/integrations/supabase/client.ts");
  if (clientFile) {
    out.push({
      id: "generated-supabase-client:client", platform: "replit", category: "state-entanglement",
      severity: "error", confidence: "high", location: { file: clientFile.path },
      description: "Generated Supabase client contains hardcoded project URL and anon key",
      suggestion: "Move credentials to .env and create a portable client factory",
    });
  }

  // Replit env var bleed
  const replitBleedRx = /GPT_ENGINEER_|REPLIT_|REPL_/;
  for (const file of graph.findFiles(/(\.(env|ts|tsx|js|jsx))$/)) {
    file.content.split("\n").forEach((line, i) => {
      if (replitBleedRx.test(line)) {
        out.push({
          id: `env-bleed:${file.path}:${i}`, platform: "replit", category: "environment-bleed",
          severity: "warning", confidence: "medium",
          location: { file: file.path, line: i + 1 },
          description: `Replit-specific env var: ${line.trim()}`,
          suggestion: "Replace with standard VITE_* env var",
        });
      }
    });
  }

  return out;
}

// =============================================================================
// v0 SCANNER (Vercel)
// =============================================================================

function scanV0(graph) {
  const out = [];
  const supabaseRx = /@supabase\/(supabase-js|auth-helpers|ssr)/;

  // Supabase direct imports (same pattern)
  for (const file of graph.findFiles(/\.(tsx?|jsx?)$/)) {
    file.content.split("\n").forEach((line, i) => {
      if (supabaseRx.test(line)) {
        out.push({
          id: `supabase-direct-import:${file.path}:${i}`,
          platform: "v0", category: "auth-coupling", severity: "warning", confidence: "high",
          location: { file: file.path, line: i + 1 },
          description: "Direct Supabase import in component — verify credentials work outside v0",
          suggestion: "Extract to a service layer: src/lib/supabase.ts",
        });
      }
    });
  }

  // v0 config folder
  if (graph.getFile(".v0")) {
    out.push({
      id: "build-config:v0-config", platform: "v0", category: "build-config",
      severity: "info", confidence: "high", location: { file: ".v0" },
      description: "v0 prompt history folder - contains your prompts to the AI",
      suggestion: "Optional: Remove if you no longer need the prompt history",
    });
  }

  // v0 dependencies
  const v0Pkg = graph.getFile("package.json");
  if (v0Pkg?.content.includes("@vercel/v0") || v0Pkg?.content.includes("v0-core")) {
    out.push({
      id: "build-config:v0-deps", platform: "v0", category: "build-config",
      severity: "info", confidence: "high", location: { file: "package.json" },
      description: "v0-specific packages in dependencies",
      suggestion: "Remove v0 packages if not needed outside v0",
    });
  }

  // Generated Supabase client (same pattern as Lovable/Bolt/Replit)
  const clientFile = graph.getFile("src/integrations/supabase/client.ts");
  if (clientFile) {
    out.push({
      id: "generated-supabase-client:client", platform: "v0", category: "state-entanglement",
      severity: "error", confidence: "high", location: { file: clientFile.path },
      description: "Generated Supabase client contains hardcoded project URL and anon key",
      suggestion: "Move credentials to .env and create a portable client factory",
    });
  }

  // v0 env var bleed
  const v0BleedRx = /V0_|GPT_ENGINEER_/;
  for (const file of graph.findFiles(/(\.(env|ts|tsx|js|jsx))$/)) {
    file.content.split("\n").forEach((line, i) => {
      if (v0BleedRx.test(line)) {
        out.push({
          id: `env-bleed:${file.path}:${i}`, platform: "v0", category: "environment-bleed",
          severity: "warning", confidence: "medium",
          location: { file: file.path, line: i + 1 },
          description: `v0-specific env var: ${line.trim()}`,
          suggestion: "Replace with standard env var (VITE_* or NEXT_PUBLIC_*)",
        });
      }
    });
  }

  // Vercel deployment preference (info only - not really lock-in)
  if (graph.getFile("vercel.json") || graph.getFile(".vercel")) {
    out.push({
      id: "deployment:vercel", platform: "v0", category: "deployment",
      severity: "info", confidence: "high", location: { file: "vercel.json" },
      description: "Vercel deployment configuration detected",
      suggestion: "Code is portable - can deploy to any Node.js host",
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
// MIGRATION GUIDE GENERATOR
// Called by applyTransforms when a Supabase client is detected.
// Produces a project-specific MIGRATION_GUIDE.md included in the output zip.
// =============================================================================

function generateMigrationGuide({ extractedUrl, projectRef, migrationCount, hasMigrations, migrationFiles }) {
  const newRef = "<new-project-ref>";
  const today  = new Date().toISOString().split("T")[0];

  const migrationSection = hasMigrations ? `
## Your migration files

This project has **${migrationCount} migration file${migrationCount === 1 ? "" : "s"}** in \`supabase/migrations/\`.
These are the complete schema history — every table, RLS policy, function, trigger, and index
that was ever applied to the original database, in chronological order.

\`\`\`
${migrationFiles.map(f => "supabase/migrations/" + f.split("supabase/migrations/").pop()).join("\n")}${migrationCount > 5 ? `\n... and ${migrationCount - 5} more` : ""}
\`\`\`

You do not need to run them one by one. \`supabase db push\` replays all of them in order.
` : `
## No migration files found

This project's \`supabase/migrations/\` folder was not included in the export.
You will need to export the schema manually from the Lovable Supabase project
using the Supabase dashboard SQL editor or the CLI dump command (see path C below).
`;

  return `# Supabase migration guide
Generated by migrare on ${today}.

Your Lovable project was connected to:
\`${extractedUrl}\` (project ref: \`${projectRef}\`)

Lovable manages Supabase on your behalf — you do not have direct ownership of that
database instance. This guide explains how to connect your migrated app to a
Supabase database you control.

---
${migrationSection}
---

## Path A — Keep using the same Supabase project (fastest)

If you have access to the Lovable project's Supabase account, you can point your
migrated app directly at the existing database. No schema migration needed.

1. Log in to [supabase.com](https://supabase.com) with the account that owns the
   Lovable project (or ask whoever does to share the keys with you).

2. Go to **Project Settings → API** and copy:
   - **Project URL** → \`VITE_SUPABASE_URL\`
   - **anon (public)** key → \`VITE_SUPABASE_ANON_KEY\`

3. Create a \`.env\` file in your project root:
   \`\`\`
   VITE_SUPABASE_URL=${extractedUrl}
   VITE_SUPABASE_ANON_KEY=<paste-anon-key-here>
   \`\`\`

4. Run your app. Done.

> Note: Lovable may retain admin access to this Supabase project. For full
> ownership, use path B to migrate to a new project you control.

---

## Path B — Move to a new Supabase project (recommended)

This gives you a database you fully own. ${hasMigrations
  ? `Your migration files are already in the repo — one command replays them all.`
  : `You will need to export the schema first.`}

### 1. Create a new Supabase project

Go to [supabase.com/dashboard](https://supabase.com/dashboard) → New project.
Note the **project ref** from the project URL: \`https://supabase.com/dashboard/project/${newRef}\`

### 2. Install the Supabase CLI

\`\`\`bash
npm install -g supabase
supabase login
\`\`\`

### 3. Link to your new project

Run this from your project root (where \`supabase/\` lives):

\`\`\`bash
supabase link --project-ref ${newRef}
\`\`\`

### 4. Push all migrations to the new database

\`\`\`bash
supabase db push
\`\`\`

This replays all ${migrationCount > 0 ? migrationCount : ""} migration files in chronological order.
One command — all tables, RLS policies, functions, and indexes created in the correct sequence.

If prompted for a database password, find it at:
**Project Settings → Database → Database password**

### 5. Update your .env

Get your new project's keys from **Project Settings → API**:

\`\`\`
VITE_SUPABASE_URL=https://${newRef}.supabase.co
VITE_SUPABASE_ANON_KEY=<new-anon-key>
\`\`\`

### 6. Verify

Open the Supabase dashboard → **Table Editor**. Your tables should be there.
Run your app — it should connect and work against the new project.

---

## Path C — Self-host Supabase (advanced)

Supabase is open source and can be run on your own infrastructure via Docker.

\`\`\`bash
# Clone the Supabase repo and start the stack
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY
docker compose up -d
\`\`\`

Once running, push your migrations the same way as path B:

\`\`\`bash
# Point the CLI at your local instance
supabase db push --db-url postgresql://postgres:[password]@localhost:5432/postgres
\`\`\`

Update your \`.env\` to point at \`http://localhost:54321\` (or your server's address).

Self-hosting docs: https://supabase.com/docs/guides/self-hosting/docker

---

## Data migration (if you have existing data)

The steps above recreate your **schema** — tables and structure — but not your **data**.
If the Lovable project had real user data you need to carry over:

\`\`\`bash
# Dump data from the original project
supabase db dump --db-url postgresql://postgres:[password]@db.${projectRef}.supabase.co:5432/postgres \\
  --data-only -f data.sql

# Restore into the new project
psql postgresql://postgres:[password]@db.${newRef}.supabase.co:5432/postgres < data.sql
\`\`\`

You will need the **database password** for the original project to run the dump.
This is available in **Project Settings → Database** if you have admin access.

---

## Storage buckets

If your app uses Supabase Storage, buckets are not included in migrations.
Recreate them manually in **Storage → New bucket**, matching the bucket names
your app references. Files stored in the original project must be re-uploaded
or copied via the Supabase API.

---

## RLS policies

Row Level Security policies are included in the migration files and will be
replayed automatically by \`supabase db push\`. No extra steps needed.

---

## Edge Functions

If your app uses Supabase Edge Functions, deploy them to the new project:

\`\`\`bash
supabase functions deploy --project-ref ${newRef}
\`\`\`

---

*Generated by [migrare](https://migrare.creadev.org) — escape vendor lock-in.*
`;
}

// =============================================================================
// TRANSFORMS
// =============================================================================

function applyTransforms(graph, targetAdapter = "vite", platform = "lovable") {
  const transformLog = [];
  const outputFiles = new Map(graph.files);

  const isNextjs = targetAdapter === "nextjs";
  const envPrefix = isNextjs ? "NEXT_PUBLIC_" : "VITE_";

  // Remove Lovable plugin
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

  // Remove Bolt plugin
  for (const configPath of ["vite.config.ts", "vite.config.js"]) {
    const file = graph.getFile(configPath);
    if (file?.content.includes("@boltdev") || file?.content.includes("boltPlugin")) {
      let content = file.content;
      // Remove @boltdev imports
      content = content.replace(/^.*import.*@boltdev.*\n/m, "");
      // Remove boltPlugin calls
      content = content.replace(/\s*boltPlugin\(\),?\s*/g, "");
      outputFiles.set(configPath, { ...file, content, modified: true });
      transformLog.push({ transform: "remove-bolt-plugin", file: configPath, action: "modified" });
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

  // Remove Bolt plugin from devDependencies
  const hasBoltPlugin = graph.hasDependency("@boltdev/vite-plugin");
  const hasBoltPlugins = graph.hasDependency("@boltdev/plugins");
  if (pkgFile && (hasBoltPlugin || hasBoltPlugins)) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      delete pkg.devDependencies?.["@boltdev/vite-plugin"];
      delete pkg.devDependencies?.["@boltdev/plugins"];
      outputFiles.set("package.json", { ...pkgFile, content: JSON.stringify(pkg, null, 2), modified: true });
      transformLog.push({ transform: "remove-bolt-plugin", file: "package.json", action: "modified" });
    } catch { /* ignore */ }
  }

  // Remove Replit config files
  if (graph.getFile(".replit")) {
    outputFiles.set(".replit", { path: ".replit", content: "", modified: true, deleted: true });
    transformLog.push({ transform: "remove-replit-config", file: ".replit", action: "deleted" });
  }
  if (graph.getFile("replit.nix")) {
    outputFiles.set("replit.nix", { path: "replit.nix", content: "", modified: true, deleted: true });
    transformLog.push({ transform: "remove-replit-config", file: "replit.nix", action: "deleted" });
  }

  // Remove v0 config folder
  if (graph.getFile(".v0")) {
    outputFiles.set(".v0", { path: ".v0", content: "", modified: true, deleted: true });
    transformLog.push({ transform: "remove-v0-config", file: ".v0", action: "deleted" });
  }

  const clientFile = graph.getFile("src/integrations/supabase/client.ts");
  if (clientFile) {
    const urlMatch = clientFile.content.match(/["'](https:\/\/([a-zA-Z0-9]+)\.supabase\.co)["']/);
    const extractedUrl  = urlMatch?.[1] ?? "YOUR_SUPABASE_URL";
    const projectRef    = urlMatch?.[2] ?? "your-project-ref";

    const envUrlKey = `${envPrefix}SUPABASE_URL`;
    const envAnonKey = `${envPrefix}SUPABASE_ANON_KEY`;

    const portableClient = `// Generated by migrare — ${graph.platform === "v0" ? "v0" : graph.platform === "replit" ? "Replit" : graph.platform === "bolt" ? "Bolt" : "Lovable"} migration
// Supabase client using environment variables instead of hardcoded values.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.${envUrlKey};
const supabaseAnonKey = import.meta.env.${envAnonKey};

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Set ${envUrlKey} and ${envAnonKey} in .env"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
`;
    outputFiles.set("src/integrations/supabase/client.ts", { ...clientFile, content: portableClient, modified: true });
    transformLog.push({ transform: "abstract-supabase-client", file: "src/integrations/supabase/client.ts", action: "modified", meta: { extractedUrl } });

    // Count migration files so the guide can reference them accurately
    const migrationFiles = Array.from(graph.files.keys())
      .filter(p => p.includes("supabase/migrations/") && p.endsWith(".sql"))
      .sort(); // timestamp-prefix order
    const migrationCount = migrationFiles.length;
    const hasMigrations = migrationCount > 0;

    // .env.example — include both app vars and DB connection string format
    const envExample = `# ── App environment ──────────────────────────────────────────────────────────
# Copy this file to .env and fill in real values. Never commit .env to git.

# Supabase project URL — from: Project Settings → API → Project URL
${envUrlKey}=${extractedUrl}

# Supabase anon key — from: Project Settings → API → anon (public)
${envAnonKey}=<your-anon-key>

# ── Database connection (only needed for supabase db push) ────────────────────
# From: Project Settings → Database → Connection string → URI
# DB_URL=postgresql://postgres:[password]@db.<new-project-ref>.supabase.co:5432/postgres
`;
    outputFiles.set(".env.example", { path: ".env.example", content: envExample, modified: true });
    transformLog.push({ transform: "abstract-supabase-client", file: ".env.example", action: "created" });

    // MIGRATION_GUIDE.md — generated with project-specific values filled in
    const migrationGuide = generateMigrationGuide({
      extractedUrl,
      projectRef,
      migrationCount,
      hasMigrations,
      migrationFiles: migrationFiles.slice(0, 5), // first 5 for the example listing
    });
    outputFiles.set("MIGRATION_GUIDE.md", { path: "MIGRATION_GUIDE.md", content: migrationGuide, modified: true });
    transformLog.push({ transform: "abstract-supabase-client", file: "MIGRATION_GUIDE.md", action: "created" });
  }

  const bleedRx = /GPT_ENGINEER_|LOVABLE_|BOLT_|REPLIT_|V0_/;
  const newEnvPrefix = isNextjs ? "NEXT_PUBLIC_" : "VITE_";
  for (const [path, file] of outputFiles) {
    if (!/\.(env|ts|tsx|js|jsx)$/.test(path)) continue;
    if (!bleedRx.test(file.content)) continue;
    let content = file.content;
    content = content.replace(/GPT_ENGINEER_/g, newEnvPrefix);
    content = content.replace(/LOVABLE_/g, newEnvPrefix);
    content = content.replace(/BOLT_/g, newEnvPrefix);
    content = content.replace(/REPLIT_/g, newEnvPrefix);
    content = content.replace(/V0_/g, newEnvPrefix);
    content = content.replace(new RegExp(`${newEnvPrefix}${newEnvPrefix}`, "g"), `${newEnvPrefix}`);
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
          targetAdapter: "vite | nextjs",
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
      { id: "bolt",    status: "ready", transforms: ["remove-bolt-plugin", "abstract-supabase-client", "remove-env-bleed"] },
      { id: "replit",  status: "ready", transforms: ["remove-replit-config", "abstract-supabase-client", "remove-env-bleed"] },
      { id: "v0",      status: "ready", transforms: ["remove-v0-config", "abstract-supabase-client", "remove-env-bleed"] },
      { id: "base44",  status: "research", notes: "AI app builder. Backend locked to Base44 infrastructure. Uses proprietary entity access system. Frontend exports to GitHub but backend cannot self-host. Data stored on Base44. Lock-in: backend code, entity access queries, proprietary API calls." },
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

  const signals = detection.platform === "v0" ? scanV0(graph)
    : detection.platform === "replit" ? scanReplit(graph)
    : detection.platform === "bolt" ? scanBolt(graph)
    : detection.platform === "lovable" ? scanLovable(graph)
    : [];
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
  const { source, dryRun = false, targetAdapter = "vite" } = body;

  // Validate target adapter
  if (targetAdapter !== "vite" && targetAdapter !== "nextjs") {
    return err("Invalid targetAdapter. Must be 'vite' or 'nextjs'", 400, corsHeaders);
  }

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
  const signals = detection.platform === "v0" ? scanV0(graph)
    : detection.platform === "replit" ? scanReplit(graph)
    : detection.platform === "bolt" ? scanBolt(graph)
    : detection.platform === "lovable" ? scanLovable(graph)
    : [];

  let transformLog = [];
  let outputFiles = graph.files;

  if (!dryRun && (detection.platform === "lovable" || detection.platform === "bolt" || detection.platform === "replit" || detection.platform === "v0")) {
    const result = applyTransforms(graph, targetAdapter, detection.platform);
    outputFiles = result.outputFiles;
    transformLog = result.transformLog;
  }

  const files = [];
  for (const [path, file] of outputFiles) {
    if (file.deleted) {
      files.push({ path, content: "", deleted: true });
    } else if (dryRun || file.modified) {
      files.push({ path, content: file.content });
    }
  }

  return Response.json({
    platform: detection.platform,
    confidence: detection.confidence,
    targetAdapter,
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
// GITHUB OAUTH TOKEN HANDLER
// Exchanges OAuth code for token, validates token, returns user info
// =============================================================================

async function handleGitHubToken(request, corsHeaders, env, ip) {
  const body = await request.json();
  const { code, token: inputToken } = body;

  let token = inputToken;

  // OAuth code exchange
  if (code && !token) {
    const clientSecret = env.MIGRARE_GITHUB_CLIENT_SECRET;
    if (!clientSecret) {
      return err("OAuth not configured", 500, corsHeaders);
    }

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.MIGRARE_GITHUB_CLIENT_ID || "Ov23lijPqkbtomPfV1aY",
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      return err("OAuth code exchange failed", 401, corsHeaders);
    }

    const tokenData = await tokenRes.json();
    token = tokenData.access_token;

    if (!token) {
      return err("No access token returned", 401, corsHeaders);
    }
  }

  if (!token) {
    return err("Token or code required", 400, corsHeaders);
  }

  // Validate token with GitHub
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!userRes.ok) {
    return err("Invalid token", 401, corsHeaders);
  }

  const user = await userRes.json();

  return Response.json({
    user: {
      id: String(user.id),
      login: user.login,
      name: user.name ?? user.login,
      avatar: user.avatar_url,
    },
    token,  // Return token to client for session storage
  }, { headers: corsHeaders });
}

// =============================================================================
// AUTH STATUS HANDLER
// Just checks if a token works without returning user
// =============================================================================

async function handleAuthStatus(request, corsHeaders, env, ip) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json({ authenticated: false }, { headers: corsHeaders });
  }

  const token = authHeader.slice(7);

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!userRes.ok) {
    return Response.json({ authenticated: false }, { headers: corsHeaders });
  }

  const user = await userRes.json();

  return Response.json({
    authenticated: true,
    user: {
      id: String(user.id),
      login: user.login,
      name: user.name ?? user.login,
      avatar: user.avatar_url,
    },
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
      response = Response.json({ ok: true, version: "0.1.0" }, { headers: corsHeaders });
    } else if (path === "/api/spec" && method === "GET") {
      response = await handleSpec(corsHeaders);
    } else if (path === "/api/scan" && method === "POST") {
      response = await handleScan(request, corsHeaders, env, ip);
    } else if (path === "/api/migrate" && method === "POST") {
      response = await handleMigrate(request, corsHeaders, env, ip);
    } else if (path === "/api/auth/github/token" && method === "POST") {
      response = await handleGitHubToken(request, corsHeaders, env, ip);
    } else if (path === "/api/auth/status" && method === "GET") {
      response = await handleAuthStatus(request, corsHeaders, env, ip);
    } else {
      response = err(`Not found: ${path}`, 404, corsHeaders);
    }

    return response;

  } catch (e) {
    return err(e?.message ?? "Internal server error", 500, corsHeaders);
  }
}
