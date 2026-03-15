// =============================================================================
// @migrare/core — LockInScanner
//
// Orchestrates all registered IScanner instances across all plugins.
// This is the read-only "observation" layer of migrare — it produces signals
// but never changes the graph. Transforms are what mutate.
//
// REGISTRATION: Scanners are namespaced by platform ID so a scan run only
// invokes scanners for the detected platform — not all registered scanners.
//
// PARALLELISM: All scanners for a given platform run concurrently via
// Promise.all. Scanners must be stateless and safe to parallelise.
//
// COMPLEXITY SCORING: After collecting all signals, a migrationComplexity
// heuristic is computed from severity counts and confidence distribution:
//   trivial         0 errors, ≤2 warnings
//   moderate        0 errors, ≤10 warnings
//   complex         errors present, or >50% low-confidence signals
//   requires-manual high blocker count, patterns that resist automation
// =============================================================================

import type {
  IScanner,
  LockInSignal,
  LockInCategory,
  ScanReport,
  ScanContext,
  ScanOptions,
  PlatformId,
  Severity,
  MigrareLogger,
} from "./types/index.js";
import type { ProjectGraph } from "./ProjectGraph.js";

export class LockInScanner {
  private scanners: Map<PlatformId, IScanner[]> = new Map();

  constructor(private readonly logger: MigrareLogger) {}

  registerScanner(platform: PlatformId, scanner: IScanner): this {
    const bucket = this.scanners.get(platform) ?? [];
    bucket.push(scanner);
    this.scanners.set(platform, bucket);
    return this;
  }

  registerScanners(platform: PlatformId, scanners: IScanner[]): this {
    scanners.forEach((s) => this.registerScanner(platform, s));
    return this;
  }

  async scan(
    graph: ProjectGraph,
    platform: PlatformId,
    options: ScanOptions = {}
  ): Promise<ScanReport> {
    const scanners = (this.scanners.get(platform) ?? []).filter((s) => {
      if (options.categories && !options.categories.includes(s.category)) return false;
      return true;
    });

    if (scanners.length === 0) {
      this.logger.warn(`No scanners registered for platform: ${platform}`);
    }

    this.logger.info(`Starting scan`, { platform, scanners: scanners.length });

    const allSignals: LockInSignal[] = [];

    for (const scanner of scanners) {
      const ctx: ScanContext = {
        platform,
        options: {},
        logger: this.logger,
      };

      try {
        const signals = await scanner.scan(graph, ctx);
        allSignals.push(...signals);
        this.logger.debug(`Scanner complete`, {
          id: scanner.id,
          signals: signals.length,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error(`Scanner threw`, { id: scanner.id, error: error.message });
      }
    }

    const report = this.buildReport(platform, allSignals);
    this.logger.info(`Scan complete`, {
      platform,
      total: report.summary.total,
      complexity: report.summary.migrationComplexity,
    });

    return report;
  }

  private buildReport(platform: PlatformId, signals: LockInSignal[]): ScanReport {
    const byCategory = {} as Record<LockInCategory, number>;
    const bySeverity = {} as Record<Severity, number>;

    const categories: LockInCategory[] = [
      "auth-coupling",
      "routing-assumption",
      "environment-bleed",
      "asset-pipeline",
      "state-entanglement",
      "build-config",
      "proprietary-api",
      "unknown",
    ];
    const severities: Severity[] = ["error", "warning", "info"];

    categories.forEach((c) => (byCategory[c] = 0));
    severities.forEach((s) => (bySeverity[s] = 0));

    for (const signal of signals) {
      byCategory[signal.category] = (byCategory[signal.category] ?? 0) + 1;
      bySeverity[signal.severity] = (bySeverity[signal.severity] ?? 0) + 1;
    }

    return {
      platform,
      scannedAt: new Date(),
      signals,
      summary: {
        total: signals.length,
        byCategory,
        bySeverity,
        migrationComplexity: this.assessComplexity(signals),
      },
    };
  }

  private assessComplexity(
    signals: LockInSignal[]
  ): ScanReport["summary"]["migrationComplexity"] {
    const errors = signals.filter((s) => s.severity === "error").length;
    const warnings = signals.filter((s) => s.severity === "warning").length;
    const lowConfidence = signals.filter((s) => s.confidence === "low").length;

    if (errors === 0 && warnings <= 2) return "trivial";
    if (errors === 0 && warnings <= 10) return "moderate";
    if (errors <= 5 || lowConfidence / signals.length > 0.5) return "complex";
    return "requires-manual";
  }
}

