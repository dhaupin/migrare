#!/usr/bin/env node
// =============================================================================
// @migrare/cli — CLI entrypoint
//
// The npx migrare binary. Parses arguments and dispatches to the appropriate
// command or the interactive wizard.
//
// COMMANDS:
//   (none)              → interactive wizard (WizardFlow)
//   scan   <path>       → scan only, print report, exit 0/1
//   migrate <path>      → full migration pipeline
//   ui                  → start local web server + open browser
//
// EXIT CODES:
//   0  success (or scan with zero error-severity signals)
//   1  failure (or scan found blocker signals)
//
// FLAGS:
//   --dry-run   run full pipeline, write nothing
//   --json      output results as JSON to stdout (for CI scripting)
//   --quiet     suppress progress output
//   --target    output adapter ID (default: vite)
//   --output    target path override
//   --port      web UI port (default: 4242)
// npx migrare                  → interactive wizard
// npx migrare scan <path>      → scan only, print report
// npx migrare migrate <path>   → full migration
// npx migrare ui               → open web UI in browser
// =============================================================================

import { parseArgs } from "node:util";
import { createEngine } from "../index.js";
import { WizardFlow } from "./wizard.js";
import { startServer } from "../server/index.js";
import { formatScanReport } from "./formatter.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help:         { type: "boolean", short: "h" },
    version:     { type: "boolean", short: "v" },
    "dry-run":    { type: "boolean", short: "d" },
    output:       { type: "string",  short: "o" },
    target:       { type: "string",  short: "t", default: "vite" },
    port:         { type: "string",  short: "p", default: "4242" },
    "github-token": { type: "string" },
    json:         { type: "boolean" },
    quiet:        { type: "boolean", short: "q" },
  },
  allowPositionals: true,
});

const [command, projectPath] = positionals;

// ---------------------------------------------------------------------------
// Handle --github-token flag (sets env for the session)
// ---------------------------------------------------------------------------
if (values["github-token"]) {
  process.env.MIGRARE_TOKEN = values["github-token"] as string;
}

// ---------------------------------------------------------------------------
// --version
// ---------------------------------------------------------------------------
if (values.version) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const pkg = require("../../package.json");
  console.log(`migrare v${pkg.version}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// --help
// ---------------------------------------------------------------------------
if (values.help || (!command && process.stdin.isTTY)) {
  printHelp();
  if (!command) process.exit(0);
}

// ---------------------------------------------------------------------------
// No command → interactive wizard
// ---------------------------------------------------------------------------
if (!command) {
  const wizard = new WizardFlow();
  await wizard.run();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------
switch (command) {

  case "scan": {
    if (!projectPath) fatal("scan requires a project path\n  migrare scan ./my-project");
    const engine = await createEngine({ runtime: "cli" });
    const report = await engine.scan(projectPath);
    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      formatScanReport(report, { quiet: values.quiet ?? false });
    }
    // Exit with non-zero if blockers found
    const blockers = report.signals.filter(s => s.severity === "error").length;
    process.exit(blockers > 0 ? 1 : 0);
  }

  case "migrate": {
    if (!projectPath) fatal("migrate requires a project path\n  migrare migrate ./my-project");
    const outputPath = values.output ?? `${projectPath}-migrated`;
    const engine = await createEngine({ runtime: "cli" });

    engine.on("progress", (event) => {
      if (!values.quiet) {
        const pct = Math.round((event.current / event.total) * 100);
        process.stdout.write(`\r  \x1b[32m▸\x1b[0m ${event.step.padEnd(40)} ${pct}%`);
        if (event.current === event.total) process.stdout.write("\n");
      }
    });

    const result = await engine.migrate(projectPath, {
      targetAdapter: (values.target as string) ?? "vite",
      targetPath: outputPath,
      dryRun: values["dry-run"] ?? false,
    });

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printMigrationResult(result, outputPath);
    }
    process.exit(result.success ? 0 : 1);
  }

  case "ui": {
    const port = parseInt(values.port as string, 10);
    await startServer({ port, openBrowser: true });
    break;
  }

  default:
    fatal(`Unknown command: "${command}"\nRun migrare --help for usage`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
\x1b[32m migrare\x1b[0m — escape vibe-coding vendor lock-in

\x1b[2mUSAGE\x1b[0m
  npx migrare                        interactive wizard
  npx migrare scan   <path>          scan a project for lock-in signals
  npx migrare migrate <path>         migrate a project to portable output
  npx migrare ui                     open web UI in browser

\x1b[2mOPTIONS\x1b[0m
  -t, --target <adapter>             output adapter: vite (default), nextjs, github-pr
  -o, --output <path>                output directory (default: <project>-migrated)
  -d, --dry-run                      preview changes without writing files
  -p, --port <port>                  web UI port (default: 4242)
      --github-token <token>          GitHub PAT for GitHub PR output
      --json                         output results as JSON
  -q, --quiet                        suppress progress output
  -v, --version                      print version
  -h, --help                         show this help

\x1b[2mENVIRONMENT\x1b[0m
  GITHUB_TOKEN                      GitHub Personal Access Token
  MIGRARE_TOKEN                     Override for GITHUB_TOKEN

\x1b[2mEXAMPLES\x1b[0m
  npx migrare scan ./my-lovable-app
  npx migrare migrate ./my-lovable-app --output ./my-app --target vite
  npx migrare migrate ./my-lovable-app --dry-run --github-token ghp_...
  npx migrare ui
`);
}

function printMigrationResult(result: any, outputPath: string) {
  const ok = result.success;
  const icon = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`\n  ${icon} Migration ${ok ? "complete" : "failed"}`);
  console.log(`  \x1b[2mplatform   \x1b[0m ${result.platform}`);
  console.log(`  \x1b[2moutput     \x1b[0m ${outputPath}`);
  console.log(`  \x1b[2mfiles      \x1b[0m ${result.outputResult.written.length} written`);
  console.log(`  \x1b[2mduration   \x1b[0m ${result.duration}ms`);

  if (result.errors.length > 0) {
    console.log(`\n  \x1b[31mErrors:\x1b[0m`);
    for (const err of result.errors) {
      console.log(`    \x1b[31m✗\x1b[0m [${err.code}] ${err.message}`);
    }
  }

  if (ok) {
    console.log(`\n  \x1b[2mNext steps:\x1b[0m`);
    console.log(`    cd ${outputPath}`);
    console.log(`    npm install`);
    console.log(`    npm run dev\n`);
  }
}

function fatal(msg: string): never {
  console.error(`\n  \x1b[31mError:\x1b[0m ${msg}\n`);
  process.exit(1);
}
