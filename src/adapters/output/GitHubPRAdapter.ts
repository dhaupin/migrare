// =============================================================================
// @migrare/github — GitHubPRAdapter
//
// The primary output adapter. Instead of writing to a local filesystem,
// migrare opens a Pull Request against the user's own GitHub repository.
//
// WHY A PR? The migration becomes reviewable, reversible, and auditable.
// Every changed file has a diff. Every LockInSignal becomes a PR comment.
// The user merges on their own terms — migrare never force-pushes to main.
//
// THREE-PHASE LIFECYCLE:
//   prepare()  → validate repo access (fail-fast before any transforms run)
//   write()    → create branch, commit only modified files one-by-one
//   finalize() → open PR with structured body derived from ScanReport
//
// BRANCH NAMING: migrare/<platform>-<YYYY-MM-DD>  (e.g. migrare/lovable-2026-03-05)
// PR TITLE:      "migrare: remove vendor lock-in [lovable] — moderate"
// PR BODY:       Structured markdown — summary table + signal list per category
//
// DRY RUN: If outputCtx.dryRun is true, logs what would happen but writes nothing.
// The prepare() step still runs so the user gets early feedback on access issues.
// Primary output adapter. Instead of writing to a local filesystem,
// migrare opens a Pull Request against the user's own repository.
//
// The PR IS the migration:
//   - Branch: migrare/migration-<timestamp>
//   - Title:  "migrare: remove vendor lock-in [<platform>]"
//   - Body:   Structured report — every signal found, every transform applied
//   - Files:  Only the changed files, with accurate diffs
//
// This is reviewable, reversible, and lands in the tool users already trust.
// =============================================================================

import type {
  IOutputAdapter,
  OutputContext,
  OutputResult,
  MigrareIssue,
} from "../../core/types/index.js";
import type { ProjectGraph } from "../../core/ProjectGraph.js";
import type { AuthSession } from "../types/index.js";
import type { ScanReport } from "../../core/types/index.js";

export interface GitHubPROptions {
  owner: string;
  repo: string;
  baseBranch?: string;       // default: repo's default branch
  branchPrefix?: string;     // default: "migrare/"
  draftPR?: boolean;         // default: false — open as ready for review
  labels?: string[];         // labels to apply to the PR
  scanReport?: ScanReport;   // included in PR body
}

export interface GitHubFile {
  path: string;
  content: string;
  sha?: string;   // required for updates, absent for creates
}

export class GitHubPRAdapter implements IOutputAdapter {
  readonly id = "github-pr";
  readonly name = "GitHub Pull Request";
  readonly description = "Opens a PR against your repository with all migration changes";

  constructor(
    private readonly session: AuthSession,
    private readonly options: GitHubPROptions
  ) {}

  async prepare(ctx: OutputContext): Promise<void> {
    ctx.logger.info(`GitHubPRAdapter: validating repository access`, {
      repo: `${this.options.owner}/${this.options.repo}`,
    });

    const repoRes = await this.gh(`/repos/${this.options.owner}/${this.options.repo}`);
    if (!repoRes.ok) {
      throw new Error(
        `Cannot access ${this.options.owner}/${this.options.repo}: ${repoRes.status}. ` +
        `Check that the token has repo scope.`
      );
    }

    const repo = await repoRes.json();
    // Store default branch for later
    (this.options as GitHubPROptions & { _defaultBranch: string })._defaultBranch =
      repo.default_branch ?? "main";

    ctx.logger.info(`Repository accessible`, {
      defaultBranch: repo.default_branch,
      private: repo.private,
    });
  }

  async write(graph: ProjectGraph, ctx: OutputContext): Promise<OutputResult> {
    const written: string[] = [];
    const skipped: string[] = [];
    const errors: MigrareIssue[] = [];

    const opts = this.options as GitHubPROptions & { _defaultBranch?: string };
    const baseBranch = opts.baseBranch ?? opts._defaultBranch ?? "main";
    const branchName = this.buildBranchName();

    if (ctx.dryRun) {
      ctx.logger.info(`GitHubPRAdapter: dry run — would create branch: ${branchName}`);
      for (const file of graph.files.values()) {
        if (file.modified) skipped.push(file.path);
      }
      return { written: [], skipped, errors, targetPath: branchName };
    }

    // ── 1. Get base branch SHA ────────────────────────────────────
    ctx.logger.info(`Getting base branch ref`, { baseBranch });
    const baseRef = await this.gh(
      `/repos/${this.options.owner}/${this.options.repo}/git/refs/heads/${baseBranch}`
    );
    if (!baseRef.ok) {
      throw new Error(`Base branch not found: ${baseBranch}`);
    }
    const { object: { sha: baseSha } } = await baseRef.json();

    // ── 2. Create migration branch ────────────────────────────────
    ctx.logger.info(`Creating branch`, { branch: branchName });
    await this.gh(
      `/repos/${this.options.owner}/${this.options.repo}/git/refs`,
      {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
      }
    );

    // ── 3. Commit only modified files ─────────────────────────────
    const modifiedFiles = Array.from(graph.files.values()).filter((f) => f.modified);
    ctx.logger.info(`Committing modified files`, { count: modifiedFiles.length });

    for (const file of modifiedFiles) {
      try {
        // Get current file SHA (needed for updates)
        const existingRes = await this.gh(
          `/repos/${this.options.owner}/${this.options.repo}/contents/${file.path}?ref=${branchName}`
        );
        const existing = existingRes.ok ? await existingRes.json() : null;

        const contentB64 = Buffer.from(file.content, "utf8").toString("base64");

        await this.gh(
          `/repos/${this.options.owner}/${this.options.repo}/contents/${file.path}`,
          {
            method: "PUT",
            body: JSON.stringify({
              message: `migrare: ${this.describeChange(file.path)}`,
              content: contentB64,
              branch: branchName,
              ...(existing?.sha ? { sha: existing.sha } : {}),
            }),
          }
        );

        written.push(file.path);
        ctx.logger.debug(`Committed file`, { path: file.path });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ code: "COMMIT_FAILED", message: `Failed to commit ${file.path}: ${msg}`, severity: "error" });
        ctx.logger.error(`Failed to commit file`, { path: file.path, error: msg });
      }
    }

    // ── 4. Commit new files ───────────────────────────────────────
    const newFiles = Array.from(graph.files.values()).filter((f) => !f.modified && f.meta.generatedBy);
    for (const file of newFiles) {
      try {
        const contentB64 = Buffer.from(file.content, "utf8").toString("base64");
        await this.gh(
          `/repos/${this.options.owner}/${this.options.repo}/contents/${file.path}`,
          {
            method: "PUT",
            body: JSON.stringify({
              message: `migrare: add ${file.path}`,
              content: contentB64,
              branch: branchName,
            }),
          }
        );
        written.push(file.path);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ code: "COMMIT_FAILED", message: `Failed to create ${file.path}: ${msg}`, severity: "warning" });
      }
    }

    return { written, skipped, errors, targetPath: branchName };
  }

  async finalize(ctx: OutputContext): Promise<void> {
    if (ctx.dryRun) return;

    const branchName = this.buildBranchName();
    const opts = this.options as GitHubPROptions & { _defaultBranch?: string };
    const baseBranch = opts.baseBranch ?? opts._defaultBranch ?? "main";

    ctx.logger.info(`Opening pull request`);

    const prRes = await this.gh(
      `/repos/${this.options.owner}/${this.options.repo}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: this.buildPRTitle(),
          body: this.buildPRBody(),
          head: branchName,
          base: baseBranch,
          draft: this.options.draftPR ?? false,
        }),
      }
    );

    if (!prRes.ok) {
      const err = await prRes.json().catch(() => ({}));
      throw new Error(`Failed to open PR: ${JSON.stringify(err)}`);
    }

    const pr = await prRes.json();
    ctx.logger.info(`Pull request opened`, { url: pr.html_url, number: pr.number });

    // Apply labels if configured
    if (this.options.labels?.length) {
      await this.gh(
        `/repos/${this.options.owner}/${this.options.repo}/issues/${pr.number}/labels`,
        { method: "POST", body: JSON.stringify({ labels: this.options.labels }) }
      ).catch(() => {/* labels are best-effort */});
    }

    console.log(`\n  ✓ Pull request opened: ${pr.html_url}\n`);
  }

  // ---------------------------------------------------------------------------
  // PR content builders
  // ---------------------------------------------------------------------------

  private buildBranchName(): string {
    const prefix = this.options.branchPrefix ?? "migrare/";
    const ts = new Date().toISOString().slice(0, 10);
    const platform = this.options.scanReport?.platform ?? "project";
    return `${prefix}${platform}-${ts}`;
  }

  private buildPRTitle(): string {
    const platform = this.options.scanReport?.platform ?? "project";
    const complexity = this.options.scanReport?.summary.migrationComplexity;
    return `migrare: remove vendor lock-in [${platform}]${complexity ? ` — ${complexity}` : ""}`;
  }

  private buildPRBody(): string {
    const report = this.options.scanReport;
    const lines: string[] = [];

    lines.push(`## migrare migration`);
    lines.push(``);
    lines.push(`> This PR was opened automatically by [migrare](https://github.com/migrare/migrare).`);
    lines.push(`> Review each change before merging. All transforms are idempotent and reversible.`);
    lines.push(``);

    if (report) {
      lines.push(`## Scan report`);
      lines.push(``);
      lines.push(`| | |`);
      lines.push(`|---|---|`);
      lines.push(`| **Platform** | ${report.platform} |`);
      lines.push(`| **Complexity** | ${report.summary.migrationComplexity} |`);
      lines.push(`| **Signals found** | ${report.summary.total} |`);
      lines.push(`| **Errors** | ${report.summary.bySeverity.error ?? 0} |`);
      lines.push(`| **Warnings** | ${report.summary.bySeverity.warning ?? 0} |`);
      lines.push(``);

      if (report.signals.length > 0) {
        lines.push(`## Lock-in signals addressed`);
        lines.push(``);

        const byCategory = new Map<string, typeof report.signals>();
        for (const signal of report.signals) {
          const bucket = byCategory.get(signal.category) ?? [];
          bucket.push(signal);
          byCategory.set(signal.category, bucket);
        }

        for (const [category, signals] of byCategory) {
          lines.push(`### ${category}`);
          lines.push(``);
          for (const signal of signals) {
            const icon = signal.severity === "error" ? "🔴" : signal.severity === "warning" ? "🟡" : "🔵";
            lines.push(`- ${icon} **${signal.description}**`);
            lines.push(`  - File: \`${signal.location.file}${signal.location.line ? `:${signal.location.line}` : ""}\``);
            if (signal.suggestion) lines.push(`  - Fix: ${signal.suggestion}`);
          }
          lines.push(``);
        }
      }
    }

    lines.push(`## Next steps`);
    lines.push(``);
    lines.push(`1. Review the changed files in this PR`);
    lines.push(`2. Check \`.env.example\` for any new environment variables needed`);
    lines.push(`3. Run \`npm install && npm run dev\` locally to verify`);
    lines.push(`4. Merge when satisfied`);
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by [migrare](https://github.com/migrare/migrare) — your code belongs to you.*`);

    return lines.join("\n");
  }

  private describeChange(path: string): string {
    if (path === "vite.config.ts" || path === "vite.config.js") return "remove lovable-tagger from build config";
    if (path === "package.json") return "remove proprietary dependencies";
    if (path.includes("supabase/client")) return "abstract Supabase client to use env vars";
    if (path === ".env.example") return "add env var template";
    return `clean vendor lock-in in ${path}`;
  }

  // ---------------------------------------------------------------------------
  // GitHub API fetch wrapper
  // ---------------------------------------------------------------------------

  private async gh(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.session.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
  }
}
