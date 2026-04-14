// =============================================================================
// @migrare/core — type system
//
// This file is the single contract that the entire framework builds on.
// Every plugin, transform, scanner, validator, adapter, and the engine itself
// implements interfaces defined here and only here.
//
// STABILITY: LTS. Breaking changes require a major version bump and a 12-month
// deprecation window. Additive changes (new optional fields, new interfaces)
// are non-breaking and may land in minor versions.
//
// DESIGN PRINCIPLE: These types define shape and behaviour contracts — not
// implementation details. Every interface answers "what must this thing do?"
// not "how does it work?". Concrete implementations live in other files.
//
// DEPENDENCY RULE: This file has zero imports. It is the root of the
// dependency tree. Nothing here imports from elsewhere in migrare.
// =============================================================================

// ---------------------------------------------------------------------------
// Primitives
//
// String aliases with semantic intent. `PlatformId` instead of `string` makes
// call sites self-documenting and enables future narrowing to a union type
// without breaking changes at the use sites.
// ---------------------------------------------------------------------------

/** Identifies a platform plugin. Convention: lowercase, hyphenated. e.g. "lovable", "bolt" */
export type PlatformId = string;

/** Identifies an output adapter. e.g. "vite", "nextjs", "github-pr", "local-fs" */
export type AdapterId = string;

/**
 * How serious is a scan signal or validation issue?
 *   error:   blocks migration or requires immediate attention
 *   warning: should be reviewed, migration can proceed
 *   info:    advisory only, no action required
 */
export type Severity = "error" | "warning" | "info";

/**
 * How confident is the scanner in a signal it emitted?
 *   high:   pattern is definitive (exact file path or import name)
 *   medium: pattern is likely correct but context-dependent
 *   low:    heuristic match — manual review recommended
 */
export type Confidence = "high" | "medium" | "low";

/** Points to a specific location in a source file. Line and column are 1-indexed. */
export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

// ---------------------------------------------------------------------------
// ProjectGraph
//
// The in-memory model of a project under migration. Everything migrare does
// operates on this structure: scanners read it, transforms mutate it,
// validators assert against it, output adapters serialise it.
//
// A graph is loaded once by a runtime adapter, then passed through the full
// pipeline. Transforms mutate files in place by setting `file.modified = true`.
// The output adapter writes ONLY modified files, preserving unchanged ones.
//
// `env` stores key names only — never values. migrare never reads secrets.
// It only needs to know which env vars EXIST to detect "GPT_ENGINEER_*" etc.
// ---------------------------------------------------------------------------

/**
 * A single file in a project.
 *
 * `modified` is the canonical marker for "a transform touched this". Output
 * adapters use it exclusively to decide what to write. Every transform that
 * changes `content` MUST set `modified = true`.
 *
 * `ast` is intentionally `unknown` to keep this layer dependency-free.
 * Transforms that need an AST (e.g. ts-morph) populate it themselves and
 * store it here so subsequent transforms can reuse the parse without re-work.
 * Must be set to `undefined` whenever `content` is mutated.
 */
export interface ProjectFile {
  /** Relative to project root. Forward-slash separated on all platforms. */
  path: string;
  content: string;
  encoding: "utf8" | "binary";
  /** Set to true by any transform that modifies this file's content. */
  modified: boolean;
  /** Optional parsed AST. Populated lazily; invalidate when content changes. */
  ast?: unknown;
  /** Arbitrary metadata. e.g. GitHub file SHA for update operations. */
  meta: Record<string, unknown>;
}

/** A dependency declared in package.json or equivalent manifest. */
export interface ProjectDependency {
  name: string;
  /** Semver range as declared, e.g. "^18.0.0" — not resolved. */
  version: string;
  type: "prod" | "dev" | "peer";
  source: "npm" | "url" | "local";
}

/**
 * The full in-memory model of a project.
 *
 * `root` is a logical identifier assigned by the ingest adapter. It may be
 * a filesystem path, a GitHub ref ("github:owner/repo@main"), or anything
 * else. Plugins should treat it as opaque unless they own the runtime.
 */
export interface ProjectGraph {
  root: string;
  files: Map<string, ProjectFile>;
  dependencies: ProjectDependency[];
  /** Key → source file path. Values are NEVER the actual env var value. */
  env: Map<string, string>;
  /** Set by the ingest adapter. Opaque to the core. */
  meta: Record<string, unknown>;
  addFile(file: ProjectFile): void;
  removeFile(path: string): void;
  getFile(path: string): ProjectFile | undefined;
  /** Prefer this over iterating `files` directly — it is the stable API. */
  findFiles(pattern: RegExp | ((f: ProjectFile) => boolean)): ProjectFile[];
  /** Create a deep copy of the graph */
  snapshot(): ProjectGraph;
  /** Serialize to JSON-friendly format */
  serialize(): SerializedGraph;
  /** Check if a dependency exists */
  hasDependency(name: string): boolean;
  /** Get a specific dependency */
  getDependency(name: string): ProjectDependency | undefined;
  /** Serialize to JSON-friendly format */
  serialize(): SerializedGraph;
  /** All unique file extensions in the graph */
  readonly extensions: Set<string>;
}

/** Output of ProjectGraph.serialize() */
export interface SerializedGraph {
  root: string;
  files: SerializedFile[];
  dependencies: ProjectDependency[];
  env: Record<string, string>;
  meta: Record<string, unknown>;
}

/** A serialized file (content preserved, AST dropped) */
export interface SerializedFile {
  path: string;
  content: string;
  encoding: "utf8" | "binary";
  modified: boolean;
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Scan Results
//
// Scanners read the graph and emit LockInSignals. They NEVER mutate.
// Signals are aggregated into a ScanReport by the LockInScanner orchestrator.
// The ScanReport is both the output of `engine.scan()` and the source of
// truth for the PR description body when using GitHubPRAdapter.
// ---------------------------------------------------------------------------

/**
 * A single detected instance of vendor lock-in.
 *
 * `id` should be unique within a run. Convention:
 *   "<plugin-id>.<scanner-id>:<file>:<line>"
 *   e.g. "lovable.supabase-direct-import:src/App.tsx:12"
 *
 * `suggestion` is shown directly to the user in reports and PR bodies.
 * Keep it actionable: "Move to src/services/auth.ts" not "Consider refactoring".
 */
export interface LockInSignal {
  id: string;
  platform: PlatformId;
  category: LockInCategory;
  severity: Severity;
  confidence: Confidence;
  location: SourceLocation;
  description: string;
  /** What the user should do. Shown in CLI reports and PR descriptions. */
  suggestion?: string;
  /** Scanner-specific data for downstream transforms to consume. */
  meta: Record<string, unknown>;
}

/**
 * The taxonomy of lock-in patterns migrare understands.
 *
 *   auth-coupling:      auth provider wired directly into components
 *   routing-assumption: platform-specific routing conventions
 *   environment-bleed:  proprietary env vars or globals
 *   asset-pipeline:     CDN URLs, platform image optimisation
 *   state-entanglement: generated clients, platform-specific hooks/stores
 *   build-config:       proprietary Vite plugins, CI config
 *   proprietary-api:    hardcoded project URLs, platform RPC patterns
 *   unknown:            catch-all for unclassified signals
 */
export type LockInCategory =
  | "auth-coupling"
  | "routing-assumption"
  | "environment-bleed"
  | "asset-pipeline"
  | "state-entanglement"
  | "build-config"
  | "proprietary-api"
  | "unknown";

/**
 * The aggregated output of a scan phase.
 *
 * `migrationComplexity` is derived from signal count, severity distribution,
 * and confidence scores — it sets user expectations before they commit to
 * a migration:
 *   trivial:          0 errors, ≤2 warnings  → safe to auto-migrate
 *   moderate:         0 errors, ≤10 warnings → auto-migrate with review
 *   complex:          errors present or >50% low-confidence signals
 *   requires-manual:  high error count, patterns that defy automation
 */
export interface ScanReport {
  platform: PlatformId;
  scannedAt: Date;
  signals: LockInSignal[];
  summary: {
    total: number;
    byCategory: Record<LockInCategory, number>;
    bySeverity: Record<Severity, number>;
    migrationComplexity: "trivial" | "moderate" | "complex" | "requires-manual";
  };
}

// ---------------------------------------------------------------------------
// Transform
//
// The atomic unit of graph mutation. Every transform must be:
//   Idempotent  — running twice produces the same result as running once
//   Focused     — one transform addresses one category of lock-in
//   Declarative — `appliesTo()` is checked before `apply()` is called
//
// Transforms are ordered by registration (via `IPlugin.getTransforms()`) and
// executed sequentially by the TransformPipeline. Each transform receives the
// graph as already mutated by all prior transforms in the run.
// ---------------------------------------------------------------------------

/**
 * Context passed into every transform invocation.
 *
 * `signal` is the LockInSignal that matched this transform, if any. Using it
 * gives you the exact file and line without re-scanning, which is both faster
 * and more precise than repeating the scanner's pattern match.
 *
 * `emit` publishes to the engine event bus. Use it to report progress or
 * notify the web UI of specific actions without coupling to the engine directly.
 */
export interface TransformContext {
  graph: ProjectGraph;
  /** The signal that triggered this transform. May be undefined for non-signal-driven transforms. */
  signal?: LockInSignal;
  targetAdapter: AdapterId;
  options: Record<string, unknown>;
  logger: MigrareLogger;
  emit(event: string, payload: unknown): void;
}

export interface TransformResult {
  modified: string[];   // paths of files whose content changed
  created: string[];    // paths of files added to the graph
  deleted: string[];    // paths of files removed from the graph
  warnings: MigrareIssue[];
  meta: Record<string, unknown>;
}

/**
 * A single unit of graph mutation contributed by a plugin.
 *
 * IDEMPOTENCY CONTRACT: `apply()` must be safe to run multiple times against
 * the same graph and produce the same result. The simplest way to satisfy
 * this: check whether the change is already applied before applying it.
 *
 * `platforms` is used by the pipeline for conflict detection — if two
 * transforms share a category and platform, the engine flags a conflict.
 */
export interface ITransform {
  readonly id: string;
  readonly description: string;
  readonly category: LockInCategory;
  /** Platform IDs this transform handles. Used for pipeline conflict detection. */
  readonly platforms: PlatformId[];

  /**
   * Return true if this transform should run against the current graph state.
   * Called before `apply()`. Should be fast — read the graph, never mutate.
   * A false return logs the transform as "skipped" and skips `apply()`.
   */
  appliesTo(graph: ProjectGraph, ctx: TransformContext): boolean;

  /**
   * Mutate the graph to address the lock-in pattern.
   * Must be idempotent. Set `file.modified = true` on every touched file.
   * Throw only on unrecoverable errors. Use warnings for recoverable issues.
   */
  apply(graph: ProjectGraph, ctx: TransformContext): Promise<TransformResult>;
}

// ---------------------------------------------------------------------------
// Validation
//
// Validators run at four defined lifecycle phases — they assert, never mutate.
//
//   pre-scan:       is the project in a state we can scan at all?
//   pre-transform:  is it safe to begin mutating the graph?
//   post-transform: did transforms leave a coherent, buildable result?
//   post-output:    does the written output satisfy structural requirements?
//
// `error` severity issues are BLOCKERS — they halt the pipeline at that phase.
// `warning` and `info` are advisory and allow the pipeline to continue.
// ---------------------------------------------------------------------------

export type ValidationPhase = "pre-scan" | "pre-transform" | "post-transform" | "post-output";

export interface ValidationResult {
  phase: ValidationPhase;
  /** false if ANY error-severity issue was found. */
  passed: boolean;
  issues: MigrareIssue[];
}

/**
 * A read-only assertion about the project at a specific lifecycle phase.
 *
 * Validators NEVER mutate the graph. They are observational by contract.
 * Violating this corrupts the `modified` tracking that output adapters rely on.
 */
export interface IValidator {
  readonly id: string;
  readonly phase: ValidationPhase;
  readonly description: string;
  validate(graph: ProjectGraph, ctx: ValidationContext): Promise<ValidationResult>;
}

export interface ValidationContext {
  phase: ValidationPhase;
  platform: PlatformId;
  targetAdapter: AdapterId;
  scanReport?: ScanReport;  // available during post-scan phases
  logger: MigrareLogger;
}

// ---------------------------------------------------------------------------
// Plugin
//
// The top-level extension point. A plugin bundles everything needed to
// support one platform: detection fingerprinting, lock-in scanning, graph
// transforms, and lifecycle validation.
//
// PLUGIN CONTRACT:
//   - Plugins must not depend on other plugins
//   - Plugins must not access engine internals (only the engine interface)
//   - `meta.id` must be globally unique. Convention: npm package name segment
//   - Transforms must be idempotent
//   - Scanners and validators must not mutate the graph
//
// See AGENTS.md §Plugin Authoring for the full guide with worked examples.
// ---------------------------------------------------------------------------

export interface PluginMeta {
  /** Globally unique. Lowercase, hyphenated. Used as key in all registries. */
  id: PlatformId;
  name: string;
  version: string;
  description: string;
  /** Optional semver range of the target platform version this plugin supports. */
  supportedVersionRange?: string;
  author?: string;
  homepage?: string;
}

/**
 * The complete contract for a platform migration plugin.
 *
 * Registration flow:
 *   1. `engine.registerPlugin(plugin)` is called
 *   2. Engine calls `plugin.onRegister(engine)` — one-time setup
 *   3. Engine stores the plugin's scanners, transforms, and validators
 *   4. On each `scan()` / `migrate()` call, engine calls `plugin.detect()`
 *   5. If detected, the plugin's components participate in the run
 */
export interface IPlugin {
  readonly meta: PluginMeta;

  /**
   * Called once at registration. One-time setup only.
   * Do not start long-lived async work here.
   */
  onRegister(engine: MigrareEngine): Promise<void>;

  /**
   * Return true if this project was built on this platform.
   * Keep detection cheap: check files and dependencies, don't parse ASTs.
   * Called on every `scan()` and `migrate()` unless platform is forced in options.
   */
  detect(graph: ProjectGraph): Promise<DetectionResult>;

  /** Return scanners. Called once at registration. Order is preserved. */
  getScanners(): IScanner[];

  /**
   * Return transforms. Called once at registration.
   * ORDER MATTERS — transforms run in the order returned here.
   * Design the ordering so earlier transforms don't invalidate later ones.
   */
  getTransforms(): ITransform[];

  /** Return validators. Each declares its own phase via `IValidator.phase`. */
  getValidators(): IValidator[];

  /** Optional lifecycle hooks. See PluginHooks for available integration points. */
  hooks?: Partial<PluginHooks>;
}

export interface DetectionResult {
  detected: boolean;
  confidence: Confidence;
  /** Human-readable reasons. Shown in debug logs. e.g. ["lovable-tagger in package.json"] */
  signals: string[];
}

// ---------------------------------------------------------------------------
// Scanner — read-only signal emission
// ---------------------------------------------------------------------------

/**
 * Reads the ProjectGraph and emits LockInSignals for detected lock-in patterns.
 *
 * IMMUTABILITY CONTRACT: scanners MUST NOT modify the graph or any file.
 * Any mutation before transforms run will corrupt the `modified` tracking
 * that output adapters rely on to build accurate diffs.
 */
export interface IScanner {
  readonly id: string;
  readonly category: LockInCategory;
  readonly description: string;
  scan(graph: ProjectGraph, ctx: ScanContext): Promise<LockInSignal[]>;
}

export interface ScanContext {
  platform: PlatformId;
  options: Record<string, unknown>;
  logger: MigrareLogger;
}

// ---------------------------------------------------------------------------
// Output Adapter — the write layer
//
// The only component that writes outside the in-memory graph.
// Three-phase lifecycle: prepare → write → finalize.
//   prepare:  validate the target before any transforms run (fail-fast)
//   write:    write modified files only — never unchanged files
//   finalize: post-write steps like opening a PR or running npm install
// ---------------------------------------------------------------------------

/**
 * Writes a migrated ProjectGraph to its destination.
 *
 * Key invariants:
 *   - Only write files where `file.modified === true` OR `file.meta.generatedBy` is set
 *   - `dryRun === true` must produce zero writes — log what WOULD happen instead
 *   - Return accurate `written` and `skipped` arrays for the audit trail
 */
export interface IOutputAdapter {
  readonly id: AdapterId;
  readonly name: string;
  readonly description: string;

  /**
   * Validate that the adapter can write to the target.
   * Called before transforms run — fail here rather than after mutation.
   */
  prepare(ctx: OutputContext): Promise<void>;

  /** Write modified and created files. Respect dryRun. */
  write(graph: ProjectGraph, ctx: OutputContext): Promise<OutputResult>;

  /** Optional post-write: open PR, run npm install, git init, etc. */
  finalize?(ctx: OutputContext): Promise<void>;
}

export interface OutputContext {
  targetPath: string;
  overwrite: boolean;
  /** If true, simulate the write but produce zero side effects. MUST be honoured. */
  dryRun: boolean;
  logger: MigrareLogger;
  options: Record<string, unknown>;
}

export interface OutputResult {
  written: string[];   // paths actually written
  skipped: string[];   // paths skipped (unchanged or dry-run)
  errors: MigrareIssue[];
  targetPath: string;
}

// ---------------------------------------------------------------------------
// Runtime Adapter — environment bridge
//
// Bridges the host environment (Node.js, browser, test runner) to the engine.
// Two responsibilities:
//   1. Load a project source into a ProjectGraph (ingest)
//   2. Deliver the output to the user (present)
//
// This separation keeps the core engine fully environment-agnostic. The CLI
// and browser share identical engine code — only the runtime adapter differs.
// ---------------------------------------------------------------------------

/**
 * Bridges a runtime environment to the migrare engine.
 *
 *   CLI:     loadProject walks the filesystem; deliverOutput prints a summary
 *   Browser: loadProject reads a ZIP or calls GitHub API; deliverOutput triggers download
 *   Tests:   loadProject returns a synthetic graph fixture
 */
export interface IRuntimeAdapter {
  readonly id: string;
  loadProject(source: string | FileSystemEntry): Promise<ProjectGraph>;
  deliverOutput(result: MigrationResult): Promise<void>;
  reportProgress(event: ProgressEvent): void;
}

/**
 * A portable file/directory representation — used by the browser runtime
 * to represent items from drag-and-drop or the File System Access API.
 * Mirrors the browser FileSystemEntry API without callback-based async.
 */
export interface FileSystemEntry {
  name: string;
  isDirectory: boolean;
  children?: FileSystemEntry[];
  /** Read file content as UTF-8. Present on non-directory entries only. */
  read?: () => Promise<string>;
}

// ---------------------------------------------------------------------------
// Engine — central orchestrator
//
// The engine coordinates the full migration lifecycle:
//   ingest → validate → scan → validate → transform → validate → output → validate
//
// Defined as an interface so:
//   a) tests can provide mock implementations
//   b) plugins import the interface, not the concrete class, avoiding circular deps
// ---------------------------------------------------------------------------

/**
 * The central orchestrator. Stateless between calls — it does not cache
 * graphs or results across `scan()` / `migrate()` invocations.
 *
 * All configuration (plugins, adapters, runtime) must be registered BEFORE
 * calling `scan()` or `migrate()`.
 */
export interface MigrareEngine {
  /** Logger for emit logs, errors */
  logger: MigrareLogger;
  /** Register a platform plugin. Wires its scanners, transforms, validators. */
  registerPlugin(plugin: IPlugin): void;
  /** Register an output adapter. e.g. ViteAdapter, GitHubPRAdapter. */
  registerOutputAdapter(adapter: IOutputAdapter): void;
  /** Set the runtime adapter. Required before scan/migrate. */
  setRuntimeAdapter(adapter: IRuntimeAdapter): void;

  /**
   * Scan for lock-in signals. READ ONLY — no files are changed.
   * Returns a ScanReport with all detected signals and complexity assessment.
   */
  scan(source: string | FileSystemEntry, options?: ScanOptions): Promise<ScanReport>;

  /**
   * Run the full migration: scan → transform → output.
   * Returns a MigrationResult with the complete audit trail.
   */
  migrate(source: string | FileSystemEntry, options: MigrateOptions): Promise<MigrationResult>;

  on<K extends keyof EngineEvents>(event: K, handler: EngineEvents[K]): void;
  off<K extends keyof EngineEvents>(event: K, handler: EngineEvents[K]): void;
}

export interface ScanOptions {
  /** Limit to specific platforms. Auto-detect if omitted. */
  platforms?: PlatformId[];
  categories?: LockInCategory[];
}

export interface MigrateOptions {
  /** Force a specific platform. Auto-detect if omitted. */
  platform?: PlatformId;
  /** Which output adapter to use. Must be registered with the engine. */
  targetAdapter: AdapterId;
  targetPath: string;
  overwrite?: boolean;
  /** Simulate the full pipeline without writing. Default: false. */
  dryRun?: boolean;
  transforms?: {
    include?: string[];  // whitelist — run only these transform IDs
    exclude?: string[];  // blacklist — skip these transform IDs
  };
  adapterOptions?: Record<string, unknown>;
}

/** The complete audit trail of a migration run. */
export interface MigrationResult {
  platform: PlatformId;
  targetAdapter: AdapterId;
  scanReport: ScanReport;
  validationResults: ValidationResult[];
  transformLog: TransformLogEntry[];
  outputResult: OutputResult;
  success: boolean;
  errors: MigrareIssue[];
  /** Wall-clock duration of the complete pipeline in milliseconds. */
  duration: number;
}

export interface TransformLogEntry {
  transformId: string;
  /** false if appliesTo() returned false, or the transform was excluded. */
  applied: boolean;
  result?: TransformResult;
  error?: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// Hooks & Events
// ---------------------------------------------------------------------------

/**
 * Lifecycle hooks a plugin can implement.
 * All hooks are async — the engine awaits them before proceeding.
 * Keep hooks fast: they run in the critical path.
 *
 * `on:conflict` — two transforms share category + platform scope.
 *   Default: first transform wins, second is skipped.
 *
 * `on:ambiguity` — a signal matches multiple transforms.
 *   Default: first candidate is chosen.
 */
export interface PluginHooks {
  "before:scan": (graph: ProjectGraph) => Promise<void>;
  "after:scan": (graph: ProjectGraph, report: ScanReport) => Promise<void>;
  "before:transform": (graph: ProjectGraph, transform: ITransform) => Promise<void>;
  "after:transform": (graph: ProjectGraph, transform: ITransform, result: TransformResult) => Promise<void>;
  "before:output": (graph: ProjectGraph) => Promise<void>;
  "after:output": (result: OutputResult) => Promise<void>;
  "on:conflict": (conflict: TransformConflict) => Promise<ConflictResolution>;
  "on:ambiguity": (ambiguity: TransformAmbiguity) => Promise<AmbiguityResolution>;
}

/** Engine-wide events. Subscribe via `engine.on(event, handler)`. */
export interface EngineEvents extends PluginHooks {
  "progress": (event: ProgressEvent) => void;
  "error": (error: MigrareError) => void;
  "plugin:registered": (plugin: IPlugin) => void;
}

export interface TransformConflict {
  transforms: [ITransform, ITransform];
  file: string;
  description: string;
}

/**
 *   first:  run first, skip second
 *   second: run second, skip first
 *   merge:  run both (transforms must cooperate to avoid overwriting each other)
 *   skip:   run neither — flag for manual resolution
 */
export type ConflictResolution = { strategy: "first" | "second" | "merge" | "skip" };

export interface TransformAmbiguity {
  signal: LockInSignal;
  candidates: ITransform[];
  description: string;
}

export type AmbiguityResolution = { chosen: ITransform | null };

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Structured logger. The engine creates a default stdout implementation.
 * Pass `{ logger }` to `createEngine()` to use Pino, Winston, etc.
 */
export interface MigrareLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * A structured issue in a validation result, output result, or migration result.
 * `code` is SCREAMING_SNAKE_CASE for programmatic handling.
 * `message` is human-readable for display.
 */
export interface MigrareIssue {
  code: string;
  message: string;
  severity: Severity;
  location?: SourceLocation;
}

/** A typed Error with migrare-specific context fields. */
export interface MigrareError extends Error {
  code: string;
  platform?: PlatformId;
  location?: SourceLocation;
  cause?: unknown;
}

/**
 * Emitted by the engine throughout a run to drive progress UIs.
 * `current` and `total` are within the current phase — not global.
 */
export interface ProgressEvent {
  phase: "scan" | "validate" | "transform" | "output";
  step: string;
  current: number;
  total: number;
  message?: string;
}
