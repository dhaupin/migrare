// functions/api/[[route]].js
//
// Catch-all Cloudflare Pages Function for all /api/* routes.
// Engine is self-contained here — CF Pages bundles each function file independently,
// so cross-file imports (../engine.js) do not resolve at deploy time.
//
// Routes handled:
//   GET  /api/health
//   POST /api/scan     { source: { zip: base64, name: string } } → ScanReport
//   POST /api/migrate  { source: { zip: base64, name: string }, dryRun? } → MigrationResult

// =============================================================================
// ZIP PARSER
// Uses DecompressionStream (available in the Workers runtime).
// Skips binary files and entries over 512 KB.
// =============================================================================

async function parseZip(base64Data) {
  const binStr = atob(base64Data);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

  const files = new Map();
  const view = new DataView(bytes.buffer);
  let offset = 0;

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
    const tooBig   = uncompSize > 512 * 1024;

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

async function handleHealth() {
  return Response.json({ ok: true, version: "0.0.1" });
}

async function handleScan(request) {
  const body = await request.json();
  const { source } = body;
  if (!source?.zip) {
    return Response.json({ error: "Missing source.zip" }, { status: 400 });
  }

  const fileMap = await parseZip(source.zip);
  const graph = buildGraph(fileMap, source.name ?? "project.zip");
  const detection = detectPlatform(graph);

  if (detection.platform === "unknown") {
    return Response.json({
      platform: "unknown", confidence: "low", signals: [],
      detectionSignals: [],
      summary: buildSummary([]),
      fileCount: fileMap.size,
    });
  }

  const signals = scanLovable(graph);
  return Response.json({
    platform: detection.platform,
    confidence: detection.confidence,
    signals,
    detectionSignals: detection.signals,
    summary: buildSummary(signals),
    fileCount: fileMap.size,
  });
}

async function handleMigrate(request) {
  const body = await request.json();
  const { source, dryRun = false } = body;
  if (!source?.zip) {
    return Response.json({ error: "Missing source.zip" }, { status: 400 });
  }

  const startTime = Date.now();
  const fileMap = await parseZip(source.zip);
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
  });
}

// =============================================================================
// ENTRY POINT
// =============================================================================

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    let response;

    if (path === "/api/health" && method === "GET") {
      response = await handleHealth();
    } else if (path === "/api/scan" && method === "POST") {
      response = await handleScan(request);
    } else if (path === "/api/migrate" && method === "POST") {
      response = await handleMigrate(request);
    } else {
      response = Response.json({ error: `Not found: ${path}` }, { status: 404 });
    }

    // Merge CORS headers onto the response
    const newHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) newHeaders.set(k, v);
    return new Response(response.body, { status: response.status, headers: newHeaders });

  } catch (err) {
    return Response.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500, headers }
    );
  }
}
