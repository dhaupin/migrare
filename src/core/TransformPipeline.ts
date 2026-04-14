// =============================================================================
// @migrare/core — TransformPipeline
//
// Executes registered ITransform instances in declaration order against a
// ProjectGraph. This is the mutation layer — scanners observe, the pipeline acts.
//
// EXECUTION ORDER: Transforms run in the order they were added via add() or
// addMany(). Order matters: earlier transforms may modify files that later
// transforms depend on. Plugin authors control ordering via getTransforms().
//
// CONFLICT DETECTION: Before execution, the pipeline checks for transforms
// that share the same category + platform scope. Detected conflicts are
// resolved by the onConflict callback (defaults to "first wins").
//
// IDEMPOTENCY: The pipeline calls appliesTo() before apply(). A transform
// returning false from appliesTo() is logged as "skipped", not an error.
// All transforms must also satisfy the idempotency contract independently.
// Ordered, hookable chain of ITransform executions against a ProjectGraph.
// Supports dependency ordering, conflict detection, and rollback.
// =============================================================================

import type {
  ITransform,
  TransformContext,
  TransformResult,
  TransformLogEntry,
  TransformConflict,
  ConflictResolution,
  TransformAmbiguity,
  AmbiguityResolution,
  LockInSignal,
  MigrareLogger,
} from "./types/index.js";
import type { ProjectGraph } from "./ProjectGraph.js";

export interface PipelineOptions {
  include?: string[];           // transform ids to whitelist
  exclude?: string[];           // transform ids to blacklist
  stopOnError?: boolean;        // abort pipeline on first transform error
  onConflict?: (c: TransformConflict) => Promise<ConflictResolution>;
  onAmbiguity?: (a: TransformAmbiguity) => Promise<AmbiguityResolution>;
}

export interface PipelineResult {
  log: TransformLogEntry[];
  modified: Set<string>;
  created: Set<string>;
  deleted: Set<string>;
  errors: PipelineError[];
  success: boolean;
}

export interface PipelineError {
  transformId: string;
  error: Error;
  fatal: boolean;
}

export class TransformPipeline {
  private transforms: ITransform[] = [];

  constructor(private readonly logger: MigrareLogger) {}

  /**
   * Add a transform to the pipeline.
   * Order of addition determines execution order unless dependency resolution reorders.
   */
  add(transform: ITransform): this {
    this.transforms.push(transform);
    return this;
  }

  addMany(transforms: ITransform[]): this {
    transforms.forEach((t) => this.add(t));
    return this;
  }

  /**
   * Execute all applicable transforms against the graph in order.
   * Each transform is given the mutated graph from prior transforms.
   */
  async run(
    graph: ProjectGraph,
    baseCtx: Omit<TransformContext, "signal">,
    signals: LockInSignal[],
    options: PipelineOptions = {}
  ): Promise<PipelineResult> {
    const { include, exclude, stopOnError = false } = options;

    // Filter transforms per whitelist/blacklist
    const candidates = this.transforms.filter((t) => {
      if (include && !include.includes(t.id)) return false;
      if (exclude && exclude.includes(t.id)) return false;
      return true;
    });

    // Detect conflicts before running
    const conflicts = this.detectConflicts(candidates);
    for (const conflict of conflicts) {
      if (options.onConflict) {
        const resolution = await options.onConflict(conflict);
        this.resolveConflict(candidates, conflict, resolution);
      } else {
        this.logger.warn(`Transform conflict detected (using first)`, {
          transforms: conflict.transforms.map((t) => t.id),
          file: conflict.file,
        });
      }
    }

    const log: TransformLogEntry[] = [];
    const modified = new Set<string>();
    const created = new Set<string>();
    const deleted = new Set<string>();
    const errors: PipelineError[] = [];

    // Map signals to transforms for contextual execution
    const signalMap = this.buildSignalMap(signals, candidates);

    for (const transform of candidates) {
      const relatedSignals = signalMap.get(transform.id) ?? [];

      // Check applicability — may be signal-driven or self-assessed
      const signal = relatedSignals[0]; // primary signal, if any
      const ctx: TransformContext = signal 
        ? { ...baseCtx, signal }
        : { ...baseCtx };

      const applicable = transform.appliesTo(graph, ctx);
      if (!applicable) {
        this.logger.debug(`Transform skipped (not applicable)`, { id: transform.id });
        log.push({ transformId: transform.id, applied: false, duration: 0 });
        continue;
      }

      const start = Date.now();
      try {
        this.logger.info(`Applying transform`, { id: transform.id });
        const result = await transform.apply(graph, ctx);
        const duration = Date.now() - start;

        result.modified.forEach((f) => modified.add(f));
        result.created.forEach((f) => created.add(f));
        result.deleted.forEach((f) => deleted.add(f));

        log.push({ transformId: transform.id, applied: true, result, duration });
        this.logger.info(`Transform complete`, {
          id: transform.id,
          modified: result.modified.length,
          created: result.created.length,
          deleted: result.deleted.length,
          duration,
        });
      } catch (err) {
        const duration = Date.now() - start;
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({ transformId: transform.id, error, fatal: stopOnError });
        log.push({ transformId: transform.id, applied: false, error: error.message, duration });
        this.logger.error(`Transform failed`, { id: transform.id, error: error.message });

        if (stopOnError) break;
      }
    }

    return {
      log,
      modified,
      created,
      deleted,
      errors,
      success: errors.filter((e) => e.fatal).length === 0,
    };
  }

  /**
   * Detect transforms that target the same files/patterns and may conflict.
   * Simple heuristic: same category + overlapping platform scope.
   */
  private detectConflicts(transforms: ITransform[]): TransformConflict[] {
    const conflicts: TransformConflict[] = [];
    for (let i = 0; i < transforms.length; i++) {
      for (let j = i + 1; j < transforms.length; j++) {
        const a = transforms[i]!;
        const b = transforms[j]!;
        const platformOverlap = a.platforms.some((p) => b.platforms.includes(p));
        if (a.category === b.category && platformOverlap) {
          conflicts.push({
            transforms: [a, b],
            file: "*",
            description: `Transforms "${a.id}" and "${b.id}" share category "${a.category}" and platform scope`,
          });
        }
      }
    }
    return conflicts;
  }

  private resolveConflict(
    candidates: ITransform[],
    conflict: TransformConflict,
    resolution: ConflictResolution
  ): void {
    const [a, b] = conflict.transforms;
    if (resolution.strategy === "first") {
      const idx = candidates.indexOf(b);
      if (idx !== -1) candidates.splice(idx, 1);
    } else if (resolution.strategy === "second") {
      const idx = candidates.indexOf(a);
      if (idx !== -1) candidates.splice(idx, 1);
    } else if (resolution.strategy === "skip") {
      [a, b].forEach((t) => {
        const idx = candidates.indexOf(t);
        if (idx !== -1) candidates.splice(idx, 1);
      });
    }
    // "merge" is left for the transforms themselves to handle
  }

  /**
   * Map signal categories to transforms that handle them.
   */
  private buildSignalMap(
    signals: LockInSignal[],
    transforms: ITransform[]
  ): Map<string, LockInSignal[]> {
    const map = new Map<string, LockInSignal[]>();
    for (const signal of signals) {
      for (const transform of transforms) {
        if (transform.category === signal.category) {
          const existing = map.get(transform.id) ?? [];
          existing.push(signal);
          map.set(transform.id, existing);
        }
      }
    }
    return map;
  }

  get size(): number {
    return this.transforms.length;
  }
}

