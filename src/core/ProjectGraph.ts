// =============================================================================
// @migrare/core — ProjectGraph (concrete implementation)
//
// The in-memory model of a project under migration.
// This class implements the `ProjectGraph` interface from core/types/index.ts.
//
// LIFECYCLE:
//   1. Created by a runtime adapter (CLIRuntimeAdapter walks disk,
//      GitHubIngestAdapter calls the GitHub tree API)
//   2. Read by scanners (never mutated)
//   3. Mutated by transforms (file.content + file.modified = true)
//   4. Read by validators (never mutated)
//   5. Serialised by an output adapter (writes modified files only)
//
// SNAPSHOT / ROLLBACK:
//   Call `snapshot()` before a destructive transform chain to get a
//   shallow clone. If transforms fail, discard the mutated graph and
//   resume from the snapshot. The engine does not do this automatically —
//   it is opt-in for use cases that require transactional safety.
//
// CROSS-RUNTIME TRANSFER:
//   `serialize()` / `deserialize()` convert the graph to a plain JSON
//   object suitable for `postMessage()` to a Web Worker or over a REST API.
// =============================================================================

import type {
  ProjectGraph as IProjectGraph,
  ProjectFile,
  ProjectDependency,
} from "./types/index.js";

export class ProjectGraph implements IProjectGraph {
  readonly root: string;
  readonly files: Map<string, ProjectFile>;
  readonly dependencies: ProjectDependency[];
  readonly env: Map<string, string>;
  readonly meta: Record<string, unknown>;

  constructor(options: {
    root: string;
    files?: Map<string, ProjectFile>;
    dependencies?: ProjectDependency[];
    env?: Map<string, string>;
    meta?: Record<string, unknown>;
  }) {
    this.root = options.root;
    this.files = options.files ?? new Map();
    this.dependencies = options.dependencies ?? [];
    this.env = options.env ?? new Map();
    this.meta = options.meta ?? {};
  }

  /** Add or replace a file in the graph. */
  addFile(file: ProjectFile): void {
    this.files.set(file.path, file);
  }

  /** Remove a file from the graph. No-op if the file doesn't exist. */
  removeFile(path: string): void {
    this.files.delete(path);
  }

  /** Get a file by its path. Returns undefined if not found. */
  getFile(path: string): ProjectFile | undefined {
    return this.files.get(path);
  }

  /**
   * Find files matching a path regex or a custom predicate function.
   * This is the preferred iteration API — use it instead of iterating
   * `this.files` directly, so callers aren't coupled to the Map internals.
   */
  findFiles(pattern: RegExp | ((f: ProjectFile) => boolean)): ProjectFile[] {
    const predicate =
      typeof pattern === "function"
        ? pattern
        : (f: ProjectFile) => pattern.test(f.path);
    return Array.from(this.files.values()).filter(predicate);
  }

  /**
   * Return a shallow clone of this graph with copies of all file objects.
   *
   * Use this before running a transform chain you might need to roll back.
   * The clone has independent file objects — mutating one graph does not
   * affect the other. File `content` strings are immutable in JS, so this
   * is effectively a deep clone for string content.
   *
   * NOTE: `ast` references are NOT deep-cloned — they are dropped on the
   * snapshot to avoid stale parse trees after mutations.
   */
  snapshot(): ProjectGraph {
    return new ProjectGraph({
      root: this.root,
      files: new Map(
        Array.from(this.files.entries()).map(([k, v]) => [
          k,
          { ...v, ast: undefined },  // drop AST — will be re-parsed if needed
        ])
      ),
      dependencies: [...this.dependencies],
      env: new Map(this.env),
      meta: { ...this.meta },
    });
  }

  /**
   * Serialise the graph to a plain JSON-compatible object.
   * Binary files are base64-encoded for safe JSON transport.
   *
   * Used for:
   *   - Passing the graph to a Web Worker via `postMessage()`
   *   - Caching a graph between HTTP requests
   *   - Debugging / inspection
   */
  serialize(): SerializedGraph {
    const files: SerializedFile[] = [];
    for (const [path, file] of this.files) {
      files.push({
        path,
        content:
          file.encoding === "binary"
            ? Buffer.from(file.content).toString("base64")
            : file.content,
        encoding: file.encoding,
        modified: file.modified,
        meta: file.meta,
        // AST is intentionally not serialised — it contains circular references
        // and framework-specific objects. Re-parse from content after deserialising.
      });
    }
    return {
      root: this.root,
      files,
      dependencies: this.dependencies,
      env: Object.fromEntries(this.env),
      meta: this.meta,
    };
  }

  /** Deserialise a graph from a plain object produced by `serialize()`. */
  static deserialize(data: SerializedGraph): ProjectGraph {
    const files = new Map<string, ProjectFile>();
    for (const f of data.files) {
      files.set(f.path, {
        path: f.path,
        content:
          f.encoding === "binary"
            ? Buffer.from(f.content, "base64").toString("binary")
            : f.content,
        encoding: f.encoding,
        modified: f.modified,
        meta: f.meta,
      });
    }
    return new ProjectGraph({
      root: data.root,
      files,
      dependencies: data.dependencies,
      env: new Map(Object.entries(data.env)),
      meta: data.meta,
    });
  }

  // ---------------------------------------------------------------------------
  // Convenience accessors
  // ---------------------------------------------------------------------------

  /** All unique file extensions in the graph. Useful for quick platform detection. */
  get extensions(): Set<string> {
    const exts = new Set<string>();
    for (const path of this.files.keys()) {
      const dot = path.lastIndexOf(".");
      if (dot !== -1) exts.add(path.slice(dot));
    }
    return exts;
  }

  /** Check whether a named npm dependency is present (any type: prod/dev/peer). */
  hasDependency(name: string): boolean {
    return this.dependencies.some((d) => d.name === name);
  }

  /** Get a dependency object by name. */
  getDependency(name: string): ProjectDependency | undefined {
    return this.dependencies.find((d) => d.name === name);
  }
}

// ---------------------------------------------------------------------------
// Serialisation shapes
// These are the plain-object forms used for cross-runtime transfer.
// ---------------------------------------------------------------------------

export interface SerializedGraph {
  root: string;
  files: SerializedFile[];
  dependencies: ProjectDependency[];
  env: Record<string, string>;
  meta: Record<string, unknown>;
}

export interface SerializedFile {
  path: string;
  /** UTF-8 string for text files; base64 string for binary files. */
  content: string;
  encoding: "utf8" | "binary";
  modified: boolean;
  meta: Record<string, unknown>;
}
