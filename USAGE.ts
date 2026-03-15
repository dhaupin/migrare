// =============================================================================
// migrare — usage examples
// =============================================================================

import { createEngine } from "./src/index.js";

// ---------------------------------------------------------------------------
// Example 1: Scan a Lovable project (read-only, no mutation)
// ---------------------------------------------------------------------------

async function scanExample() {
  const engine = await createEngine({ runtime: "cli", plugins: ["lovable"] });

  const report = await engine.scan("/path/to/my-lovable-project");

  console.log(`Platform: ${report.platform}`);
  console.log(`Complexity: ${report.summary.migrationComplexity}`);
  console.log(`Lock-in signals: ${report.summary.total}`);
  console.log(`  Errors:   ${report.summary.bySeverity.error}`);
  console.log(`  Warnings: ${report.summary.bySeverity.warning}`);

  for (const signal of report.signals) {
    console.log(`\n[${signal.severity.toUpperCase()}] ${signal.category}`);
    console.log(`  ${signal.description}`);
    if (signal.suggestion) console.log(`  → ${signal.suggestion}`);
    console.log(`  @ ${signal.location.file}:${signal.location.line ?? "?"}`);
  }
}

// ---------------------------------------------------------------------------
// Example 2: Full migration to Vite output
// ---------------------------------------------------------------------------

async function migrateExample() {
  const engine = await createEngine({ runtime: "cli", plugins: ["lovable"] });

  // Listen to progress events
  engine.on("progress", (event) => {
    console.log(`[${event.phase}] ${event.step} (${event.current}/${event.total})`);
  });

  const result = await engine.migrate("/path/to/my-lovable-project", {
    targetAdapter: "vite",
    targetPath: "/path/to/output",
    overwrite: false,
    dryRun: false,
    transforms: {
      exclude: ["lovable.remove-env-bleed"], // optionally skip specific transforms
    },
  });

  console.log(`Success: ${result.success}`);
  console.log(`Duration: ${result.duration}ms`);
  console.log(`Files written: ${result.outputResult.written.length}`);
}

// ---------------------------------------------------------------------------
// Example 3: Dry run
// ---------------------------------------------------------------------------

async function dryRunExample() {
  const engine = await createEngine({ runtime: "cli" });

  const result = await engine.migrate("/path/to/project", {
    targetAdapter: "vite",
    targetPath: "/tmp/preview",
    dryRun: true,
  });

  console.log(`Would write ${result.outputResult.skipped.length} files`);
  console.log(`Transform log:`);
  for (const entry of result.transformLog) {
    const status = entry.applied ? "✓" : "–";
    console.log(`  ${status} ${entry.transformId} (${entry.duration}ms)`);
  }
}

// ---------------------------------------------------------------------------
// Example 4: Writing a second plugin (Bolt.new, future)
// ---------------------------------------------------------------------------

/*
import type { IPlugin, PluginMeta, IScanner, ITransform, IValidator } from "migrare";

export class BoltPlugin implements IPlugin {
  readonly meta: PluginMeta = {
    id: "bolt",
    name: "Bolt.new",
    version: "1.0.0",
    description: "Migration support for bolt.new projects",
  };

  async onRegister(engine) { ... }
  async detect(graph) { ... }    // look for .bolt/, stackblitz.config.json, etc.
  getScanners() { return [...]; }
  getTransforms() { return [...]; }
  getValidators() { return [...]; }
}

// Then register it:
const engine = await createEngine({ plugins: [] }); // start with no plugins
await engine.registerPlugin(new BoltPlugin());
*/
