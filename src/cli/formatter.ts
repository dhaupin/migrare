// =============================================================================
// @migrare/cli — scan report formatter
//
// Renders a ScanReport to the terminal with colour, structure, and hierarchy.
// Called by both the wizard (after scan) and the `scan` command directly.
//
// OUTPUT STRUCTURE:
//   Header: platform name + complexity badge + severity counts
//   Body:   signals grouped by LockInCategory, each with:
//             severity icon (✗ ⚠ ·)
//             description
//             file:line location
//             suggestion (if present)
//             confidence dot (green/yellow/grey)
//   Footer: hint to run migrate
//
// ANSI COLOURS: Uses raw escape codes — no dependencies. The colour scheme
// matches the web UI: green for clear paths, yellow for warnings, red for blockers.
// Renders a ScanReport to the terminal with colour and structure
// =============================================================================

import type { ScanReport, LockInSignal, LockInCategory } from "../core/types/index.js";

const GREEN  = "\x1b[32m";
const DIM    = "\x1b[2m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";
const CYAN   = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const BLUE   = "\x1b[34m";

const CATEGORY_LABELS: Record<LockInCategory, string> = {
  "auth-coupling":      "Auth Coupling",
  "routing-assumption": "Routing Assumption",
  "environment-bleed":  "Environment Bleed",
  "asset-pipeline":     "Asset Pipeline",
  "state-entanglement": "State Entanglement",
  "build-config":       "Build Config",
  "proprietary-api":    "Proprietary API",
  "unknown":            "Unknown",
};

const COMPLEXITY_COLOR: Record<string, string> = {
  trivial:          GREEN,
  moderate:         CYAN,
  complex:          YELLOW,
  "requires-manual": RED,
};

export function formatScanReport(
  report: ScanReport,
  options: { quiet: boolean }
): void {
  const { summary, signals, platform } = report;

  // Header
  console.log(`\n  ${BOLD}Scan Report${RESET}  ${DIM}${platform}${RESET}`);
  console.log(`  ${DIM}${"─".repeat(52)}${RESET}`);

  // Summary row
  const cColor = COMPLEXITY_COLOR[summary.migrationComplexity] ?? RESET;
  console.log(`  ${DIM}complexity   ${RESET}${cColor}${summary.migrationComplexity}${RESET}`);
  console.log(`  ${DIM}signals      ${RESET}${summary.total}`);
  console.log(
    `  ${DIM}breakdown    ${RESET}` +
    `${RED}${summary.bySeverity.error ?? 0} error  ${RESET}` +
    `${YELLOW}${summary.bySeverity.warning ?? 0} warning  ${RESET}` +
    `${DIM}${summary.bySeverity.info ?? 0} info${RESET}`
  );

  if (summary.total === 0) {
    console.log(`\n  ${GREEN}✓${RESET} No lock-in signals found. Project looks portable.\n`);
    return;
  }

  if (options.quiet) return;

  // Group by category
  const byCategory = new Map<LockInCategory, LockInSignal[]>();
  for (const signal of signals) {
    const bucket = byCategory.get(signal.category) ?? [];
    bucket.push(signal);
    byCategory.set(signal.category, bucket);
  }

  console.log("");

  for (const [category, categorySignals] of byCategory) {
    console.log(
      `  ${BLUE}◆${RESET} ${BOLD}${CATEGORY_LABELS[category]}${RESET} ` +
      `${DIM}(${categorySignals.length})${RESET}`
    );

    for (const signal of categorySignals) {
      const icon =
        signal.severity === "error"   ? `${RED}✗${RESET}` :
        signal.severity === "warning" ? `${YELLOW}⚠${RESET}` :
                                        `${DIM}·${RESET}`;

      const loc = signal.location.line
        ? `${signal.location.file}:${signal.location.line}`
        : signal.location.file;

      console.log(`    ${icon}  ${signal.description}`);
      console.log(`       ${DIM}${loc}${RESET}`);
      if (signal.suggestion) {
        console.log(`       ${CYAN}→ ${signal.suggestion}${RESET}`);
      }
      console.log("");
    }
  }

  // Footer hint
  console.log(
    `  ${DIM}Run ${RESET}migrare migrate <path>${DIM} to apply all transforms automatically.${RESET}\n`
  );
}
