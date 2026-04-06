// =============================================================================
// migrare edge engine — Cloudflare Pages Functions
//
// Self-contained port of the core engine for the Workers runtime.
// No Node.js built-ins. No filesystem. No Buffer (uses TextDecoder/atob).
//
// Entry points:
//   scanZip(base64Zip)    → ScanReport
//   migrateZip(base64Zip) → MigrationResult + { files: [{path, content}] }
// =============================================================================

// ---------------------------------------------------------------------------
// Zip parsing — minimal implementation using DecompressionStream (Workers API)
// ---------------------------------------------------------------------------

/**
 * Parse a base64-encoded zip and return a map of { path → utf8 content }.
 * Skips binary files (images, fonts) and entries > 512KB.
 */
async function parseZip(base64Data) {
  // Decode base64 → Uint8Array
  const binStr = atob(base64Data);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

  const files = new Map();

  // Walk ZIP local file headers (PK\x03\x04)
  const view = new DataView(bytes.buffer);
  let offset = 0;

  while (offset < bytes.length - 4) {
    const sig = view.getUint32(offset, true);

    // Local file header signature
    if (sig !== 0x04034b50) {
      // Scan forward for next header
      offset++;
      continue;
    }

    // Parse local file header
    const compression   = view.getUint16(offset + 8,  true); // 0=store, 8=deflate
    const crc32         = view.getUint32(offset + 14, true);
    const compSize      = view.getUint32(offset + 18, true);
    const uncompSize    = view.getUint32(offset + 22, true);
    const fnameLen      = view.getUint16(offset + 26, true);
    const extraLen      = view.getUint16(offset + 28, true);

    const headerEnd = offset + 30 + fnameLen + extraLen;
    const fname = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + fnameLen));

    // Strip leading directory component (zip exports often have a root folder)
    const normalizedPath = fname.replace(/^[^/]+\//, "");

    // Skip: directories, empty, huge files, binary assets
    const isBinary = /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|mp3|pdf|zip)$/i.test(fname);
    const isDir = fname.endsWith("/") || normalizedPath === "";
    const tooBig = uncompSize > 512 * 1024;

    if (!isDir && !isBinary && !tooBig && normalizedPath) {
      const compData = bytes.slice(headerEnd, headerEnd + compSize);

      try {
        let content;
        if (compression === 0) {
          // Stored (no compression)
          content = new TextDecoder("utf-8", { fatal: false }).decode(compData);
        } else if (compression === 8) {
          // Deflate
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

        if (content !== undefined) {
          files.set(normalizedPath, content);
        }
      } catch {
        // Skip unreadable files silently
      }
    }

    offset = headerEnd + compSize;
  }

  return files;
}

// ---------------------------------------------------------------------------
// ProjectGraph — lightweight in-memory model
// ---------------------------------------------------------------------------

class ProjectGraph {
  constructor(root) {
    this.root = root;
    this.files = new Map();
    this.dependencies = [];
    this.env = new Map();
  }

  addFile(path, content) {
    this.files.set(path, { path, content, modified: false });
  }

  getFile(path) {
    return this.files.get(path);
  }

  findFiles(pattern) {
    const test = typeof pattern === "function" ? pattern : (f) => pattern.test(f.path);
    return Array.from(this.files.values()).filter(test);
  }

  hasDependency(name) {
    return this.dependencies.some((d) => d.name === name);
  }
}

// ---------------------------------------------------------------------------
// Build ProjectGraph from zip file map
// ---------------------------------------------------------------------------

function buildGraph(fileMap, zipName) {
  const graph = new ProjectGraph(zipName.replace(/\.zip$/i, ""));

  for (const [path, content] of fileMap) {
    graph.addFile(path, content);
  }

  // Parse package.json for dependencies
  const pkgContent = fileMap.get("package.json");
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        graph.dependencies.push({ name, version, type: "prod" });
      }
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
        graph.dependencies.push({ name, version, type: "dev" });
      }
    } catch { /* ignore parse errors */ }
  }

  // Collect env var keys from .env files (keys only, never values)
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

// ---------------------------------------------------------------------------
// Lovable detection
// ---------------------------------------------------------------------------

function detectPlatform(graph) {
  const signals = [];

  if (graph.hasDependency("lovable-tagger")) signals.push("lovable-tagger dependency");
  if (graph.getFile("src/integrations/supabase/client.ts")) signals.push("generated supabase client");
  if (graph.getFile(".lovable")) signals.push(".lovable config file");

  const viteConfig = graph.getFile("vite.config.ts") ?? graph.getFile("vite.config.js");
  if (viteConfig?.content.includes("componentTagger")) signals.push("componentTagger in vite.config");

  const pkg = graph.getFile("package.json");
  if (pkg?.content.includes("lovable")) signals.push("lovable in package.json");

  for (const envKey of graph.env.keys()) {
    if (envKey.startsWith("GPT_ENGINEER") || envKey.startsWith("LOVABLE_")) {
      signals.push("Lovable env vars detected");
      break;
    }
  }

  if (signals.length === 0) return { platform: "unknown", confidence: "low", signals: [] };

  const confidence = signals.length >= 3 ? "high" : signals.length >= 1 ? "medium" : "low";
  return { platform: "lovable", confidence, signals };
}

// ---------------------------------------------------------------------------
// Lovable scanners
// ---------------------------------------------------------------------------

function scanLovable(graph) {
  const lockInSignals = [];

  // 1. Direct Supabase imports in component files
  const supabaseImportRx = /@supabase\/(supabase-js|auth-helpers|ssr)/;
  for (const file of graph.findFiles(/\.(tsx?|jsx?)$/)) {
    const lines = file.content.split("\n");
    lines.forEach((line, i) => {
      if (supabaseImportRx.test(line)) {
        lockInSignals.push({
          id: `supabase-direct-import:${file.path}:${i}`,
          platform: "lovable",
          category: "auth-coupling",
          severity: "warning",
          confidence: "high",
          location: { file: file.path, line: i + 1 },
          description: "Direct Supabase import in component — will break outside Lovable environment",
          suggestion: "Extract to a service layer: src/services/auth.ts",
        });
      }
    });
  }

  // 2. Build config
  const viteConfig = graph.getFile("vite.config.ts") ?? graph.getFile("vite.config.js");
  if (viteConfig?.content.includes("lovable-tagger")) {
    lockInSignals.push({
      id: "build-config:vite-config",
      platform: "lovable",
      category: "build-config",
      severity: "warning",
      confidence: "high",
      location: { file: viteConfig.path },
      description: "lovable-tagger plugin in vite.config is a Lovable-only dev tool",
      suggestion: "Remove componentTagger() from plugins array",
    });
  }
  if (graph.hasDependency("lovable-tagger")) {
    lockInSignals.push({
      id: "build-config:package-json",
      platform: "lovable",
      category: "build-config",
      severity: "info",
      confidence: "high",
      location: { file: "package.json" },
      description: "lovable-tagger in devDependencies serves no purpose outside Lovable",
      suggestion: "Remove from devDependencies",
    });
  }

  // 3. Generated Supabase client
  const clientFile = graph.getFile("src/integrations/supabase/client.ts");
  if (clientFile) {
    lockInSignals.push({
      id: "generated-supabase-client:client",
      platform: "lovable",
      category: "state-entanglement",
      severity: "error",
      confidence: "high",
      location: { file: clientFile.path },
      description: "Generated Supabase client contains hardcoded project URL and anon key",
      suggestion: "Move credentials to .env and create a portable client factory",
    });
  }
  const typesFile = graph.getFile("src/integrations/supabase/types.ts");
  if (typesFile) {
    lockInSignals.push({
      id: "generated-supabase-client:types",
      platform: "lovable",
      category: "state-entanglement",
      severity: "info",
      confidence: "high",
      location: { file: typesFile.path },
      description: "Generated Supabase types can be regenerated via supabase CLI — not a blocker",
      suggestion: "Run: supabase gen types typescript --project-id <id>",
    });
  }

  // 4. Env bleed
  const lovableEnvRx = /GPT_ENGINEER_|LOVABLE_|__lovable/;
  for (const file of graph.findFiles(/(\.(env|ts|tsx|js|jsx))$/)) {
    const lines = file.content.split("\n");
    lines.forEach((line, i) => {
      if (lovableEnvRx.test(line)) {
        lockInSignals.push({
          id: `env-bleed:${file.path}:${i}`,
          platform: "lovable",
          category: "environment-bleed",
          severity: "warning",
          confidence: "medium",
          location: { file: file.path, line: i + 1 },
          description: `Lovable-specific env var or global: ${line.trim()}`,
          suggestion: "Replace with standard VITE_* env var",
        });
      }
    });
  }

  return lockInSignals;
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Lovable transforms
// ---------------------------------------------------------------------------

function applyTransforms(graph) {
  const transformLog = [];
  const outputFiles = new Map(graph.files);

  // 1. Remove lovable-tagger from vite.config
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

  // 2. Remove lovable-tagger from package.json
  const pkgFile = graph.getFile("package.json");
  if (pkgFile && graph.hasDependency("lovable-tagger")) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      delete pkg.devDependencies?.["lovable-tagger"];
      outputFiles.set("package.json", {
        ...pkgFile,
        content: JSON.stringify(pkg, null, 2),
        modified: true,
      });
      transformLog.push({ transform: "remove-lovable-tagger", file: "package.json", action: "modified" });
    } catch { /* ignore */ }
  }

  // 3. Abstract Supabase client
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

    outputFiles.set("src/integrations/supabase/client.ts", {
      ...clientFile,
      content: portableClient,
      modified: true,
    });
    transformLog.push({
      transform: "abstract-supabase-client",
      file: "src/integrations/supabase/client.ts",
      action: "modified",
      meta: { extractedUrl },
    });

    // Create .env.example
    const envExample = `# Supabase — extracted by migrare from Lovable project
VITE_SUPABASE_URL=${extractedUrl}
VITE_SUPABASE_ANON_KEY=<your-anon-key>
`;
    outputFiles.set(".env.example", {
      path: ".env.example",
      content: envExample,
      modified: true,
    });
    transformLog.push({ transform: "abstract-supabase-client", file: ".env.example", action: "created" });
  }

  // 4. Remove env bleed
  const lovableEnvRx = /GPT_ENGINEER_|LOVABLE_/;
  for (const [path, file] of outputFiles) {
    if (!/\.(env|ts|tsx|js|jsx)$/.test(path)) continue;
    if (!lovableEnvRx.test(file.content)) continue;

    let content = file.content;
    content = content.replace(/GPT_ENGINEER_/g, "VITE_");
    content = content.replace(/LOVABLE_/g, "VITE_");
    content = content.replace(/import\.meta\.env\.VITE_VITE_/g, "import.meta.env.VITE_");

    outputFiles.set(path, { ...file, content, modified: true });
    transformLog.push({ transform: "remove-env-bleed", file: path, action: "modified" });
  }

  return { outputFiles, transformLog };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scanZip(base64Data, zipName) {
  const fileMap = await parseZip(base64Data);
  const graph = buildGraph(fileMap, zipName);
  const detection = detectPlatform(graph);

  if (detection.platform === "unknown") {
    return {
      platform: "unknown",
      confidence: "low",
      signals: [],
      detectionSignals: [],
      summary: buildSummary([]),
    };
  }

  const signals = scanLovable(graph);

  return {
    platform: detection.platform,
    confidence: detection.confidence,
    signals,
    detectionSignals: detection.signals,
    summary: buildSummary(signals),
    fileCount: fileMap.size,
  };
}

export async function migrateZip(base64Data, zipName, dryRun = false) {
  const fileMap = await parseZip(base64Data);
  const graph = buildGraph(fileMap, zipName);
  const detection = detectPlatform(graph);
  const signals = detection.platform !== "unknown" ? scanLovable(graph) : [];
  const startTime = Date.now();

  let outputFiles = graph.files;
  let transformLog = [];

  if (!dryRun && detection.platform === "lovable") {
    const result = applyTransforms(graph);
    outputFiles = result.outputFiles;
    transformLog = result.transformLog;
  }

  // Build output file list — only modified files for real runs, all for dry runs
  const filesToReturn = [];
  for (const [path, file] of outputFiles) {
    if (dryRun || file.modified) {
      filesToReturn.push({ path, content: file.content });
    }
  }

  return {
    platform: detection.platform,
    confidence: detection.confidence,
    dryRun,
    duration: Date.now() - startTime,
    signals,
    summary: buildSummary(signals),
    transformLog,
    files: filesToReturn,
    errors: [],
  };
}
