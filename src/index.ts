// =============================================================================
// migrare — public API
// =============================================================================

// Core
export { MigrareEngine } from "./core/MigrareEngine.js";
export { ProjectGraph } from "./core/ProjectGraph.js";
export { TransformPipeline } from "./core/TransformPipeline.js";
export { ValidationLayer } from "./core/ValidationLayer.js";
export { LockInScanner } from "./core/LockInScanner.js";
export * from "./core/utils/index.js";
export type * from "./core/types/index.js";

// Auth
export { AuthRegistry } from "./auth/AuthRegistry.js";
export { GitHubOAuthProvider } from "./auth/providers/GitHubOAuthProvider.js";
export { GitHubAppProvider } from "./auth/providers/GitHubAppProvider.js";
export { LocalAuthProvider } from "./auth/providers/LocalAuthProvider.js";
export type * from "./auth/types/index.js";

// Plugins
export { LovablePlugin } from "./plugins/lovable/LovablePlugin.js";

// Output Adapters
export { ViteAdapter, NextAdapter, LocalFSAdapter } from "./adapters/output/index.js";
export { GitHubPRAdapter } from "./adapters/output/GitHubPRAdapter.js";

// Ingest
export { GitHubIngestAdapter } from "./adapters/github/GitHubIngestAdapter.js";

// Runtime Adapters
export { CLIRuntimeAdapter, BrowserRuntimeAdapter } from "./adapters/runtime/index.js";

// ---------------------------------------------------------------------------
// Convenience factory — standard engine with sensible defaults
// ---------------------------------------------------------------------------

import { MigrareEngine } from "./core/MigrareEngine.js";
import { AuthRegistry } from "./auth/AuthRegistry.js";
import { LovablePlugin } from "./plugins/lovable/LovablePlugin.js";
import { ViteAdapter, LocalFSAdapter } from "./adapters/output/index.js";
import { CLIRuntimeAdapter, BrowserRuntimeAdapter } from "./adapters/runtime/index.js";
import { LocalAuthProvider } from "./auth/providers/LocalAuthProvider.js";
import { GitHubOAuthProvider } from "./auth/providers/GitHubOAuthProvider.js";
import type { MigrareLogger } from "./core/types/index.js";
import type { AuthSession, GitHubOAuthConfig, GitHubAppConfig } from "./auth/types/index.js";

export interface CreateEngineOptions {
  runtime?: "cli" | "browser";
  plugins?: ("lovable")[];
  logger?: MigrareLogger;
  auth?: {
    github?: GitHubOAuthConfig;
    session?: AuthSession;
  };
}

export async function createEngine(
  options: CreateEngineOptions = {}
): Promise<MigrareEngine & { auth: AuthRegistry }> {
  const engine = new MigrareEngine({ logger: options.logger }) as MigrareEngine & { auth: AuthRegistry };
  const auth = new AuthRegistry();
  engine.auth = auth;

  if (options.runtime === "cli" || options.runtime === undefined) {
    auth.register(new LocalAuthProvider());
  }
  if (options.auth?.github) {
    auth.register(new GitHubOAuthProvider(options.auth.github));
  }
  if (options.auth?.session) {
    auth.setSession(options.auth.session);
  }

  engine.registerOutputAdapter(new ViteAdapter());
  engine.registerOutputAdapter(new LocalFSAdapter());

  if (options.runtime === "browser") {
    engine.setRuntimeAdapter(new BrowserRuntimeAdapter(engine.logger));
  } else {
    engine.setRuntimeAdapter(new CLIRuntimeAdapter(engine.logger));
  }

  const pluginIds = options.plugins ?? ["lovable"];
  for (const id of pluginIds) {
    if (id === "lovable") await engine.registerPlugin(new LovablePlugin());
  }

  return engine;
}

// ---------------------------------------------------------------------------
// GitHub-first factory — the primary user journey
// auth session → load repo → scan → open PR
// ---------------------------------------------------------------------------

export interface CreateGitHubMigrationOptions {
  session: AuthSession;
  owner: string;
  repo: string;
  baseBranch?: string;
  draftPR?: boolean;
  plugins?: ("lovable")[];
  logger?: MigrareLogger;
}

export async function createGitHubMigration(options: CreateGitHubMigrationOptions) {
  const { GitHubIngestAdapter } = await import("./adapters/github/GitHubIngestAdapter.js");
  const { GitHubPRAdapter } = await import("./adapters/output/GitHubPRAdapter.js");

  const engine = await createEngine({
    plugins: options.plugins ?? ["lovable"],
    logger: options.logger,
    auth: { session: options.session },
  });

  const ingest = new GitHubIngestAdapter(options.session);
  const prAdapter = new GitHubPRAdapter(options.session, {
    owner: options.owner,
    repo: options.repo,
    baseBranch: options.baseBranch,
    draftPR: options.draftPR ?? false,
    labels: ["migrare"],
  });

  engine.registerOutputAdapter(prAdapter);

  return {
    engine,
    ingest,
    prAdapter,

    /** One-shot: load repo → scan → migrate → open PR */
    async run(runOptions?: { dryRun?: boolean }) {
      const graph = await ingest.load({ owner: options.owner, repo: options.repo });
      return engine.migrate(graph.root, {
        targetAdapter: "github-pr",
        targetPath: `${options.owner}/${options.repo}`,
        dryRun: runOptions?.dryRun ?? false,
      });
    },
  };
}
