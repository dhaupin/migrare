// =============================================================================
// @migrare/github — GitHubIngestAdapter
//
// Loads a GitHub repository into a ProjectGraph via the GitHub REST API.
// Works identically in browser (fetch via client token) and Node.js.
// The token never leaves the runtime — all calls go directly to api.github.com.
//
// LOADING STRATEGY:
//   1. GET /repos/:owner/:repo/git/trees/:ref?recursive=1
//      → one API call returns the complete file list
//   2. Filter to loadable files (by extension and well-known config names)
//   3. Batch-fetch file contents in parallel groups of 10
//      → respects GitHub API rate limits (5000 req/hr authenticated)
//
// FILE FILTERING: Only files matching DEFAULT_EXTENSIONS or known config
// names (package.json, vite.config.ts, etc.) are loaded. Binary files
// over DEFAULT_MAX_FILE_SIZE are skipped — they are not lock-in targets.
//
// DEPENDENCY PARSING: package.json is parsed to populate graph.dependencies.
// ENV PARSING: .env / .env.example are parsed for key names (not values).
// Loads a GitHub repository into a ProjectGraph via the GitHub API.
// Works in both browser (client-side fetch) and Node.js (same fetch API).
// No token ever leaves the runtime — all calls are direct to github.com.
// =============================================================================

import { ProjectGraph } from "../../core/ProjectGraph.js";
import type { ProjectFile, ProjectDependency } from "../../core/types/index.js";
import type { AuthSession } from "../../auth/types/index.js";

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  ref?: string;   // branch, tag, or SHA — defaults to repo's default branch
}

export interface IngestOptions {
  // File extensions to load. Defaults to common web project files.
  extensions?: string[];
  // Max file size in bytes to load. Defaults to 500KB.
  maxFileSize?: number;
  // Paths to skip (glob-like prefix matching)
  skipPaths?: string[];
}

const DEFAULT_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".json", ".env",
  ".env.example", ".env.local", ".gitignore",
  ".html", ".css", ".scss", ".md",
];

const DEFAULT_SKIP_PATHS = [
  "node_modules/", ".git/", "dist/", "build/", ".next/",
  "coverage/", ".turbo/",
];

const DEFAULT_MAX_FILE_SIZE = 500 * 1024; // 500KB

export class GitHubIngestAdapter {
  constructor(
    private readonly session: AuthSession,
    private readonly options: IngestOptions = {}
  ) {}

  async load(repoRef: GitHubRepoRef): Promise<ProjectGraph> {
    const { owner, repo, ref } = repoRef;

    // Resolve the target ref
    const resolvedRef = ref ?? await this.resolveDefaultBranch(owner, repo);

    console.log(`[migrare:ingest] Loading ${owner}/${repo}@${resolvedRef}`);

    // Get the repo tree (recursive — all files in one call)
    const treeRes = await this.gh(
      `/repos/${owner}/${repo}/git/trees/${resolvedRef}?recursive=1`
    );

    if (!treeRes.ok) {
      throw new Error(
        `Failed to load repository tree: ${treeRes.status}. ` +
        `Check the repo exists and the token has read access.`
      );
    }

    const { tree, truncated } = await treeRes.json();

    if (truncated) {
      console.warn(
        `[migrare:ingest] Repository tree was truncated (>100k files). ` +
        `Some files may not be scanned.`
      );
    }

    // Filter to loadable files
    const loadableFiles = (tree as GitHubTreeEntry[]).filter((entry) =>
      this.shouldLoad(entry)
    );

    console.log(`[migrare:ingest] Loading ${loadableFiles.length} files`);

    // Load files in parallel batches to avoid rate limiting
    const files = await this.loadFilesBatched(owner, repo, resolvedRef, loadableFiles);

    // Parse dependencies from package.json
    const dependencies = this.parseDependencies(files);

    // Parse env keys from .env files
    const env = this.parseEnvKeys(files);

    const graph = new ProjectGraph({
      root: `github:${owner}/${repo}@${resolvedRef}`,
      files: new Map(files.map((f) => [f.path, f])),
      dependencies,
      env,
      meta: {
        provider: "github",
        owner,
        repo,
        ref: resolvedRef,
        loadedAt: new Date().toISOString(),
      },
    });

    console.log(`[migrare:ingest] Loaded ${graph.files.size} files, ${dependencies.length} dependencies`);
    return graph;
  }

  // ---------------------------------------------------------------------------
  // File loading
  // ---------------------------------------------------------------------------

  private async loadFilesBatched(
    owner: string,
    repo: string,
    ref: string,
    entries: GitHubTreeEntry[],
    batchSize = 10
  ): Promise<ProjectFile[]> {
    const files: ProjectFile[] = [];

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((entry) => this.loadFile(owner, repo, ref, entry))
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value) {
          files.push(result.value);
        }
      }
    }

    return files;
  }

  private async loadFile(
    owner: string,
    repo: string,
    ref: string,
    entry: GitHubTreeEntry
  ): Promise<ProjectFile | null> {
    const maxSize = this.options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    if (entry.size && entry.size > maxSize) return null;

    const res = await this.gh(
      `/repos/${owner}/${repo}/contents/${entry.path}?ref=${ref}`
    );
    if (!res.ok) return null;

    const data = await res.json();
    const content = Buffer.from(data.content ?? "", "base64").toString("utf8");

    return {
      path: entry.path,
      content,
      encoding: "utf8",
      modified: false,
      meta: { sha: entry.sha, size: entry.size },
    };
  }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  private shouldLoad(entry: GitHubTreeEntry): boolean {
    if (entry.type !== "blob") return false;

    const skipPaths = this.options.skipPaths ?? DEFAULT_SKIP_PATHS;
    if (skipPaths.some((skip) => entry.path.startsWith(skip))) return false;

    const extensions = this.options.extensions ?? DEFAULT_EXTENSIONS;
    const hasExtension = extensions.some((ext) => entry.path.endsWith(ext));

    // Always load key config files regardless of extension
    const isKeyFile = [
      "package.json", ".env", ".env.local", ".env.example",
      ".gitignore", ".lovable", "vite.config.ts", "vite.config.js",
      "next.config.js", "next.config.ts",
    ].includes(entry.path.split("/").pop() ?? "");

    return hasExtension || isKeyFile;
  }

  // ---------------------------------------------------------------------------
  // Parsers
  // ---------------------------------------------------------------------------

  private parseDependencies(files: ProjectFile[]): ProjectDependency[] {
    const pkgFile = files.find((f) => f.path === "package.json");
    if (!pkgFile) return [];

    try {
      const pkg = JSON.parse(pkgFile.content);
      const deps: ProjectDependency[] = [];

      for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
        deps.push({ name, version: String(version), type: "prod", source: "npm" });
      }
      for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
        deps.push({ name, version: String(version), type: "dev", source: "npm" });
      }
      for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
        deps.push({ name, version: String(version), type: "peer", source: "npm" });
      }

      return deps;
    } catch {
      return [];
    }
  }

  private parseEnvKeys(files: ProjectFile[]): Map<string, string> {
    const env = new Map<string, string>();
    const envFiles = files.filter((f) =>
      f.path === ".env" || f.path === ".env.example" || f.path === ".env.local"
    );

    for (const file of envFiles) {
      for (const line of file.content.split("\n")) {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
        if (match?.[1]) env.set(match[1], file.path);
      }
    }

    return env;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveDefaultBranch(owner: string, repo: string): Promise<string> {
    const res = await this.gh(`/repos/${owner}/${repo}`);
    if (!res.ok) throw new Error(`Cannot access ${owner}/${repo}`);
    const data = await res.json();
    return data.default_branch ?? "main";
  }

  private async gh(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.session.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
  }
}

// GitHub API tree entry
interface GitHubTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}
