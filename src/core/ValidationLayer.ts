// =============================================================================
// @migrare/core — ValidationLayer
//
// Runs registered IValidator instances at each of the four lifecycle phases.
// Validators are read-only assertions — they never mutate the graph.
//
// PHASES (in order):
//   pre-scan:       is the project scannable? (e.g. required files exist?)
//   pre-transform:  is mutation safe? (e.g. no conflicts that need resolution?)
//   post-transform: did transforms produce a buildable result?
//   post-output:    does the written output satisfy structural requirements?
//
// BLOCKING: Any error-severity issue in a phase causes that phase's result
// to have passed=false. The engine uses this to halt the pipeline early.
// Warnings and infos are advisory — they do not block.
// Runs IValidator instances at defined lifecycle phases.
// Validators are read-only — they assert, never mutate.
// =============================================================================

import type {
  IValidator,
  ValidationResult,
  ValidationContext,
  ValidationPhase,
  MigrareLogger,
  MigrareIssue,
} from "./types/index.js";
import type { ProjectGraph } from "./ProjectGraph.js";

export interface ValidationSummary {
  phase: ValidationPhase;
  passed: boolean;
  results: ValidationResult[];
  issues: MigrareIssue[];
  blockers: MigrareIssue[];   // severity === "error" issues — these halt migration
}

export class ValidationLayer {
  private validators: Map<ValidationPhase, IValidator[]> = new Map([
    ["pre-scan", []],
    ["pre-transform", []],
    ["post-transform", []],
    ["post-output", []],
  ]);

  constructor(private readonly logger: MigrareLogger) {}

  register(validator: IValidator): this {
    const bucket = this.validators.get(validator.phase);
    if (!bucket) throw new Error(`Unknown validation phase: ${validator.phase}`);
    bucket.push(validator);
    return this;
  }

  registerMany(validators: IValidator[]): this {
    validators.forEach((v) => this.register(v));
    return this;
  }

  async runPhase(
    phase: ValidationPhase,
    graph: ProjectGraph,
    ctx: Omit<ValidationContext, "phase">
  ): Promise<ValidationSummary> {
    const validators = this.validators.get(phase) ?? [];

    if (validators.length === 0) {
      return {
        phase,
        passed: true,
        results: [],
        issues: [],
        blockers: [],
      };
    }

    this.logger.info(`Running validation phase: ${phase}`, {
      validators: validators.map((v) => v.id),
    });

    const results: ValidationResult[] = [];

    for (const validator of validators) {
      try {
        const result = await validator.validate(graph, { ...ctx, phase });
        results.push(result);
        if (!result.passed) {
          this.logger.warn(`Validator failed: ${validator.id}`, {
            issues: result.issues.length,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error(`Validator threw: ${validator.id}`, {
          error: error.message,
        });
        results.push({
          phase,
          passed: false,
          issues: [
            {
              code: "VALIDATOR_THREW",
              message: `Validator "${validator.id}" threw: ${error.message}`,
              severity: "error",
            },
          ],
        });
      }
    }

    const allIssues = results.flatMap((r) => r.issues);
    const blockers = allIssues.filter((i) => i.severity === "error");
    const passed = blockers.length === 0;

    this.logger.info(`Validation phase complete: ${phase}`, {
      passed,
      total: allIssues.length,
      blockers: blockers.length,
    });

    return { phase, passed, results, issues: allIssues, blockers };
  }

  /** Run all phases in order, stopping at first blocking failure if haltOnBlock is true */
  async runAll(
    graph: ProjectGraph,
    ctx: Omit<ValidationContext, "phase">,
    options: { haltOnBlock?: boolean } = {}
  ): Promise<ValidationSummary[]> {
    const phases: ValidationPhase[] = [
      "pre-scan",
      "pre-transform",
      "post-transform",
      "post-output",
    ];

    const summaries: ValidationSummary[] = [];

    for (const phase of phases) {
      const summary = await this.runPhase(phase, graph, ctx);
      summaries.push(summary);
      if (!summary.passed && options.haltOnBlock) break;
    }

    return summaries;
  }

  get registeredCount(): number {
    let count = 0;
    for (const v of this.validators.values()) count += v.length;
    return count;
  }
}
