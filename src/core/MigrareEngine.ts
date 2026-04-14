// =============================================================================
// @migrare/core — MigrareEngine
//
// The central orchestrator. This is the single object that knows about all
// registered plugins, adapters, and validators, and it coordinates the full
// migration lifecycle.
//
// LIFECYCLE ORDER (for both scan and migrate):
//   1. loadGraph      — runtime adapter ingests the source into a ProjectGraph
//   2. detectPlatforms — each plugin's detect() is called; highest confidence wins
//   3. pre-scan validation
//   4. scan           — LockInScanner runs all platform-matching scanners
//   5. pre-transform validation
//   6. transform      — TransformPipeline applies ordered transforms to the graph
//   7. post-transform validation
//   8. output         — IOutputAdapter.prepare() → write() → finalize()
//   9. post-output validation
//  10. deliverOutput  — runtime adapter presents results to the user
//
// STATEFULNESS: The engine is stateless between calls. Plugins, adapters, and
// the runtime adapter are registered once at startup and reused across calls.
// Each scan() / migrate() call operates on a freshly loaded graph.
//
// EVENTS: The engine exposes an event bus (`on` / `off`) for external observers
// (the web UI, the CLI progress renderer, tests) to subscribe to lifecycle events
// without coupling to the engine's internals.
// =============================================================================

import type {
  IPlugin,
  IOutputAdapter,
  IRuntimeAdapter,
  MigrareEngine as IMigrareEngine,
  EngineEvents,
  ScanOptions,
  MigrateOptions,
  MigrationResult,
  ScanReport,
  PlatformId,
  DetectionResult,
  MigrareLogger,
  ProgressEvent,
  OutputContext,
  PluginHooks,
  MigrareIssue,
  ValidationResult,
  MigrareError,
} from "./types/index.js";
import { ProjectGraph } from "./ProjectGraph.js";
import { LockInScanner } from "./LockInScanner.js";
import { TransformPipeline } from "./TransformPipeline.js";
import { ValidationLayer } from "./ValidationLayer.js";
import type { FileSystemEntry } from "./types/index.js";

// Internal alias — EngineEvents values are all function types
type EventHandler = EngineEvents[keyof EngineEvents];

export class MigrareEngine implements IMigrareEngine {
  // Plugin registry — keyed by platform ID (e.g. "lovable", "bolt")
  private plugins: Map<PlatformId, IPlugin> = new Map();

  // Output adapter registry — keyed by adapter ID (e.g. "github-pr", "vite")
  private outputAdapters: Map<string, IOutputAdapter> = new Map();

  // The single runtime adapter — set once before scan/migrate
  private runtimeAdapter?: IRuntimeAdapter;

  // Event bus — maps event name to a set of handler functions
  private eventHandlers: Map<string, Set<EventHandler>> = new Map();

  // Central scanner — aggregates scanners from all registered plugins
  private scanner: LockInScanner;

  // Central validator — aggregates validators from all registered plugins
  private validation: ValidationLayer;

  // Logger — defaults to console, injectable for custom logging
  readonly logger: MigrareLogger;

  constructor(options: { logger?: MigrareLogger } = {}) {
    this.logger = options.logger ?? this.createDefaultLogger();
    this.scanner = new LockInScanner(this.logger);
    this.validation = new ValidationLayer(this.logger);
  }

  // ---------------------------------------------------------------------------
  // Registration
  //
  // All registration must happen BEFORE the first scan() or migrate() call.
  // Registration is synchronous (except plugin.onRegister which is awaited).
  // ---------------------------------------------------------------------------

  /**
   * Register a platform plugin. Wires all of its scanners and validators into
   * the central orchestrators. Idempotent: registering a plugin twice logs a
   * warning and replaces the existing registration.
   */
  async registerPlugin(plugin: IPlugin): Promise<void> {
    if (this.plugins.has(plugin.meta.id)) {
      this.logger.warn(`Plugin already registered, overwriting`, { id: plugin.meta.id });
    }

    // Give the plugin a chance to do one-time setup (register custom adapters, etc.)
    await plugin.onRegister(this);

    // Wire scanners — they'll be indexed by platform ID in the LockInScanner
    for (const scanner of plugin.getScanners()) {
      this.scanner.registerScanner(plugin.meta.id, scanner);
    }

    // Wire validators — they self-declare their phase via IValidator.phase
    for (const validator of plugin.getValidators()) {
      this.validation.register(validator);
    }

// Store plugin with hooks if provided
    if (plugin.hooks) {
      plugin.hooks = plugin.hooks;
    }
    
    this.plugins.set(plugin.meta.id, plugin);
    this.logger.info(`Plugin registered`, { id: plugin.meta.id, name: plugin.meta.name });
    this.emit("plugin:registered", plugin);
  }

  registerOutputAdapter(adapter: IOutputAdapter): void {
    this.outputAdapters.set(adapter.id, adapter);
    this.logger.info(`Output adapter registered`, { id: adapter.id });
  }

  setRuntimeAdapter(adapter: IRuntimeAdapter): void {
    this.runtimeAdapter = adapter;
    this.logger.info(`Runtime adapter set`, { id: adapter.id });
  }

  // ---------------------------------------------------------------------------
  // Scan — read-only pipeline
  //
  // Loads the graph, detects the platform, runs all matching scanners, returns
  // a ScanReport. Does NOT mutate the graph in any way.
  // ---------------------------------------------------------------------------

  async scan(
    source: string | FileSystemEntry,
    options: ScanOptions = {}
  ): Promise<ScanReport> {
    const graph = await this.loadGraph(source);

    // Auto-detect platform unless forced by options
    const platforms = options.platforms ?? await this.detectPlatforms(graph);

    if (platforms.length === 0) {
      this.logger.warn(`No platform detected — returning empty scan report`);
      return this.emptyReport("unknown");
    }

    // Use the highest-confidence detected platform
    const platform = platforms[0];
    if (!platform) {
      this.logger.warn(`No platform detected — returning empty scan report`);
      return this.emptyReport("unknown");
    }

    await this.runPluginHook(platform, "before:scan", graph);
    const report = await this.scanner.scan(graph, platform, options);
    await this.runPluginHook(platform, "after:scan", graph, report);

    return report;
  }

  // ---------------------------------------------------------------------------
  // Migrate — full pipeline
  //
  // Runs the complete lifecycle: scan → transform → output.
  // Returns a MigrationResult with the full audit trail regardless of outcome.
  // The result's `success` field is the canonical pass/fail indicator.
  // ---------------------------------------------------------------------------

  async migrate(
    source: string | FileSystemEntry,
    options: MigrateOptions
  ): Promise<MigrationResult> {
    const start = Date.now();
    const graph = await this.loadGraph(source);

    // Resolve platform — explicit option takes precedence over auto-detection
    const platform = options.platform ?? (await this.detectPlatforms(graph))[0];
    if (!platform) throw this.makeError("PLATFORM_NOT_DETECTED", "Could not detect project platform");

    const plugin = this.plugins.get(platform);
    if (!plugin) throw this.makeError("PLUGIN_NOT_FOUND", `No plugin registered for platform: ${platform}`);

    // Resolve output adapter — must be registered before migrate() is called
    const adapter = this.outputAdapters.get(options.targetAdapter);
    if (!adapter) throw this.makeError("ADAPTER_NOT_FOUND", `No output adapter registered: ${options.targetAdapter}`);

    this.emitProgress({ phase: "scan", step: "pre-scan validation", current: 0, total: 4 });

    // ── Phase 1: Pre-scan validation ─────────────────────────────────────────
    // Check the graph is in a state we can meaningfully scan.
    // Blockers here abort the pipeline before any scanning begins.
    const preScanValidation = await this.validation.runPhase("pre-scan", graph, {
      platform, targetAdapter: options.targetAdapter, logger: this.logger,
    });
    if (!preScanValidation.passed) {
      return this.failResult(platform, options, start, preScanValidation.blockers, [preScanValidation]);
    }

    // ── Phase 2: Scan ─────────────────────────────────────────────────────────
    this.emitProgress({ phase: "scan", step: "scanning for lock-in signals", current: 1, total: 4 });
    await this.runPluginHook(platform, "before:scan", graph);
    const scanReport = await this.scanner.scan(graph, platform);
    await this.runPluginHook(platform, "after:scan", graph, scanReport);

    // ── Phase 3: Pre-transform validation ────────────────────────────────────
    // Validate that it's safe to begin mutating the graph.
    this.emitProgress({ phase: "validate", step: "pre-transform validation", current: 1, total: 4 });
    const preTransformValidation = await this.validation.runPhase("pre-transform", graph, {
      platform, targetAdapter: options.targetAdapter, scanReport, logger: this.logger,
    });
    if (!preTransformValidation.passed) {
      return this.failResult(platform, options, start, preTransformValidation.blockers, [
        preScanValidation, preTransformValidation,
      ]);
    }

    // ── Phase 4: Transform ───────────────────────────────────────────────────
    // Build and run the transform pipeline. Transforms are ordered as the plugin
    // declared them in getTransforms(). Each runs only if appliesTo() is true.
    this.emitProgress({ phase: "transform", step: "applying transforms", current: 2, total: 4 });

    const pipeline = new TransformPipeline(this.logger);
    pipeline.addMany(plugin.getTransforms());

    const transformCtx = {
      graph,
      targetAdapter: options.targetAdapter,
      options: options.adapterOptions ?? {},
      logger: this.logger,
      // The emit function bridges transforms to the engine's event bus
      emit: (event: string, payload: unknown) =>
        this.emit(event as keyof EngineEvents, payload as never),
    };

    // Fire before:transform hooks for each registered transform
    for (const transform of plugin.getTransforms()) {
      await this.runPluginHook(platform, "before:transform", graph, transform);
    }

    const pipelineResult = await pipeline.run(
      graph,
      transformCtx,
      scanReport.signals,
      {
        ...(options.transforms?.include ? { include: options.transforms.include } : {}),
        ...(options.transforms?.exclude ? { exclude: options.transforms.exclude } : {}),
        stopOnError: false,
        // Delegate conflict resolution to the plugin's hook, falling back to "first wins"
        onConflict: (c) => {
          const handler = this.plugins.get(platform)?.hooks?.["on:conflict"];
          return handler ? handler(c) : Promise.resolve({ strategy: "first" as const });
        },
      }
    );

    // Fire after:transform hooks for each transform that ran
    for (const transform of plugin.getTransforms()) {
      const logEntry = pipelineResult.log.find((l) => l.transformId === transform.id);
      if (logEntry?.result) {
        await this.runPluginHook(platform, "after:transform", graph, transform, logEntry.result);
      }
    }

    // ── Phase 5: Post-transform validation ───────────────────────────────────
    // Assert that transforms left the graph in a coherent, buildable state.
    const postTransformValidation = await this.validation.runPhase("post-transform", graph, {
      platform, targetAdapter: options.targetAdapter, scanReport, logger: this.logger,
    });

    // ── Phase 6: Output ──────────────────────────────────────────────────────
    // Write the mutated graph to its destination via the output adapter.
    this.emitProgress({ phase: "output", step: "writing output", current: 3, total: 4 });

    await this.runPluginHook(platform, "before:output", graph);

    const outputCtx: OutputContext = {
      targetPath: options.targetPath,
      overwrite: options.overwrite ?? false,
      dryRun: options.dryRun ?? false,
      logger: this.logger,
      options: options.adapterOptions ?? {},
    };

    // prepare() validates the target before any files are written
    await adapter.prepare(outputCtx);
    const outputResult = await adapter.write(graph, outputCtx);
    if (adapter.finalize) await adapter.finalize(outputCtx);

    await this.runPluginHook(platform, "after:output", outputResult);

    // ── Phase 7: Post-output validation ──────────────────────────────────────
    const postOutputValidation = await this.validation.runPhase("post-output", graph, {
      platform, targetAdapter: options.targetAdapter, scanReport, logger: this.logger,
    });

    this.emitProgress({ phase: "output", step: "complete", current: 4, total: 4 });

    // Collect all transform errors into the result's top-level errors array
    const allErrors: MigrareIssue[] = pipelineResult.errors.map((e) => ({
      code: "TRANSFORM_ERROR",
      message: e.error.message,
      severity: "error" as const,
    }));

    const result: MigrationResult = {
      platform,
      targetAdapter: options.targetAdapter,
      scanReport,
      validationResults: [
        preScanValidation,
        preTransformValidation,
        postTransformValidation,
        postOutputValidation,
      ],
      transformLog: pipelineResult.log,
      outputResult,
      success: pipelineResult.success && outputResult.errors.length === 0,
      errors: allErrors,
      duration: Date.now() - start,
    };

    // Let the runtime adapter present results to the user (print summary, trigger download, etc.)
    if (this.runtimeAdapter) {
      await this.runtimeAdapter.deliverOutput(result);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Event bus
  // ---------------------------------------------------------------------------

  on<K extends keyof EngineEvents>(event: K, handler: EngineEvents[K]): void {
    const bucket = this.eventHandlers.get(event) ?? new Set();
    bucket.add(handler as EventHandler);
    this.eventHandlers.set(event, bucket);
  }

  off<K extends keyof EngineEvents>(event: K, handler: EngineEvents[K]): void {
    this.eventHandlers.get(event)?.delete(handler as EventHandler);
  }

  private emit<K extends keyof EngineEvents>(event: K, ...args: Parameters<EngineEvents[K]>): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch (err) {
        // Handler errors must never crash the engine — log and continue
        this.logger.error(`Event handler threw`, { event, error: String(err) });
      }
    }
  }

  private emitProgress(event: Omit<ProgressEvent, "message"> & { message?: string }): void {
    this.emit("progress", event as ProgressEvent);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Load a graph from a source. Delegates to the runtime adapter if one is set.
   * The fallback (no runtime adapter) returns an empty graph — this should only
   * happen in test scenarios where the graph is provided directly.
   */
  private async loadGraph(source: string | FileSystemEntry): Promise<ProjectGraph> {
    if (this.runtimeAdapter) {
      return this.runtimeAdapter.loadProject(source);
    }
    this.logger.warn(`No runtime adapter set — returning empty graph for: ${
      typeof source === "string" ? source : source.name
    }`);
    return new ProjectGraph({ root: typeof source === "string" ? source : source.name });
  }

  /**
   * Run all registered plugins' detect() in parallel.
   * Returns platform IDs sorted by confidence: high → medium → low.
   * This ordering means platforms[0] is always the highest-confidence match.
   */
  private async detectPlatforms(graph: ProjectGraph): Promise<PlatformId[]> {
    const results: Array<{ platform: PlatformId; result: DetectionResult }> = [];

    for (const [id, plugin] of this.plugins) {
      const result = await plugin.detect(graph);
      if (result.detected) {
        results.push({ platform: id, result });
        this.logger.info(`Platform detected`, {
          platform: id,
          confidence: result.confidence,
          signals: result.signals,
        });
      }
    }

    const getOrder = (c: string): number => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return order[c] ?? 2;
    };
    results.sort((a, b) => {
      const confA = a.result!.confidence ?? "low";
      const confB = b.result!.confidence ?? "low";
      return getOrder(confA) - getOrder(confB);
    });
    return results.map((r) => r.platform);
  }

  /**
   * Invoke a named lifecycle hook on the plugin for the given platform.
   * Hook errors are caught and logged — they must never crash the pipeline.
   */
  private async runPluginHook(
    platform: PlatformId,
    hook: keyof PluginHooks,
    ...args: unknown[]
  ): Promise<void> {
    const plugin = this.plugins.get(platform);
    const handler = plugin?.hooks?.[hook];
    if (handler) {
      try {
        await (handler as (...a: unknown[]) => Promise<void>)(...args);
      } catch (err) {
        this.logger.error(`Plugin hook threw`, { hook, platform, error: String(err) });
      }
    }
  }

  /** Build a failed MigrationResult for early-exit cases (blocked validation). */
  private failResult(
    platform: PlatformId,
    options: MigrateOptions,
    start: number,
    blockers: MigrareIssue[],
    validationResults: ValidationResult[]
  ): MigrationResult {
    return {
      platform,
      targetAdapter: options.targetAdapter,
      scanReport: this.emptyReport(platform),
      validationResults,
      transformLog: [],
      outputResult: { written: [], skipped: [], errors: blockers, targetPath: options.targetPath },
      success: false,
      errors: blockers,
      duration: Date.now() - start,
    };
  }

  /** Construct a zero-signal ScanReport for use in fallback/empty cases. */
  private emptyReport(platform: PlatformId): ScanReport {
    return {
      platform,
      scannedAt: new Date(),
      signals: [],
      summary: {
        total: 0,
        byCategory: {} as never,
        bySeverity: {} as never,
        migrationComplexity: "trivial",
      },
    };
  }

  /** Create a typed MigrareError from a code and message. */
  private makeError(code: string, message: string): MigrareError {
    const err = new Error(message) as MigrareError;
    err.code = code;
    return err;
  }

  /**
   * Default logger — writes structured output to console.
   * Replace this in production with Pino or Winston by passing
   * `{ logger }` to the MigrareEngine constructor.
   */
  private createDefaultLogger(): MigrareLogger {
    const fmt = (level: string, msg: string, meta?: Record<string, unknown>) => {
      const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      console.log(`[migrare:${level}] ${msg}${suffix}`);
    };
    return {
      debug: (m, meta) => fmt("debug", m, meta),
      info:  (m, meta) => fmt("info",  m, meta),
      warn:  (m, meta) => fmt("warn",  m, meta),
      error: (m, meta) => fmt("error", m, meta),
    };
  }
}
