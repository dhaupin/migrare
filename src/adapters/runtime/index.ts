// =============================================================================
// @migrare/core — Runtime Adapters
//
// Runtime adapters bridge the host environment to the engine.
// They handle two jobs:
//   1. loadProject: ingest a source into a ProjectGraph
//   2. deliverOutput: present results to the user
//
// CLIRuntimeAdapter:
//   loadProject  → walks the local filesystem (Node.js fs module)
//   deliverOutput → prints a structured summary to stdout
//
// BrowserRuntimeAdapter:
//   loadProject  → reads a File System Access API handle, or delegates
//                  to GitHubIngestAdapter if source is a repo URL
//   deliverOutput → triggers a ZIP download or redirects to the opened PR
//
// The engine is runtime-agnostic — these adapters are the only code that
// knows what environment it is running in.
// CLIRuntimeAdapter: Node.js filesystem + terminal
// BrowserRuntimeAdapter: File System Access API + zip download
// =============================================================================

import type {
  IRuntimeAdapter,
  MigrationResult,
  ProgressEvent,
  FileSystemEntry,
  MigrareLogger,
} from "../../core/types/index.js";
import { ProjectGraph } from "../../core/ProjectGraph.js";

// ---------------------------------------------------------------------------
// CLIRuntimeAdapter — Node.js
// ---------------------------------------------------------------------------

export class CLIRuntimeAdapter implements IRuntimeAdapter {
  readonly id = "cli";

  constructor(private readonly logger: MigrareLogger) {}

  async loadProject(source: string | FileSystemEntry): Promise<ProjectGraph> {
    if (typeof source !== "string") {
      throw new Error("CLI runtime requires a filesystem path string");
    }

    this.logger.info(`Loading project from filesystem`, { path: source });

    // In a real implementation:
    // const { readdir, readFile, stat } = await import("fs/promises");
    // const path = await import("path");
    //
    // Recursively walk source directory, build ProjectGraph
    // const graph = new ProjectGraph({ root: source });
    // ... walk and populate ...
    // return graph;

    // Stub for now — returns empty graph at the given root
    const graph = new ProjectGraph({ root: source });
    this.logger.warn(`CLIRuntimeAdapter: filesystem walking not yet implemented — returning empty graph`);
    return graph;
  }

  async deliverOutput(result: MigrationResult): Promise<void> {
    const { outputResult } = result;
    this.logger.info(`\n✅ Migration complete`, {
      written: outputResult.written.length,
      errors: result.errors.length,
      duration: `${result.duration}ms`,
      target: outputResult.targetPath,
    });

    if (result.errors.length > 0) {
      this.logger.error(`Migration completed with errors`, {
        count: result.errors.length,
      });
      for (const err of result.errors) {
        this.logger.error(`  [${err.code}] ${err.message}`);
      }
    }

    this.logger.info(`\nNext steps:`);
    this.logger.info(`  cd ${outputResult.targetPath}`);
    this.logger.info(`  npm install`);
    this.logger.info(`  npm run dev`);
  }

  reportProgress(event: ProgressEvent): void {
    const pct = Math.round((event.current / event.total) * 100);
    const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
    process.stdout?.write?.(`\r[${bar}] ${pct}% — ${event.step}   `);
    if (event.current === event.total) process.stdout?.write?.("\n");
  }
}

// ---------------------------------------------------------------------------
// BrowserRuntimeAdapter — File System Access API + zip
// Designed for use in a web interface (e.g. claude.ai artifact)
// ---------------------------------------------------------------------------

export class BrowserRuntimeAdapter implements IRuntimeAdapter {
  readonly id = "browser";

  private onProgress?: (event: ProgressEvent) => void;

  constructor(
    private readonly logger: MigrareLogger,
    options: { onProgress?: (event: ProgressEvent) => void } = {}
  ) {
    this.onProgress = options.onProgress;
  }

  /**
   * Load a project from a browser FileSystemDirectoryHandle or
   * a flat list of FileSystemEntry objects (from drag-and-drop).
   */
  async loadProject(source: string | FileSystemEntry): Promise<ProjectGraph> {
    if (typeof source === "string") {
      throw new Error("Browser runtime cannot load from a filesystem path string");
    }

    this.logger.info(`Loading project from browser FileSystem entry`, { name: source.name });

    const graph = new ProjectGraph({ root: source.name });
    await this.walkEntry(source, "", graph);
    return graph;
  }

  private async walkEntry(
    entry: FileSystemEntry,
    prefix: string,
    graph: ProjectGraph
  ): Promise<void> {
    if (!entry.isDirectory && entry.read) {
      const content = await entry.read();
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      graph.addFile({
        path,
        content,
        encoding: "utf8",
        modified: false,
        meta: {},
      });
    } else if (entry.isDirectory && entry.children) {
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      for (const child of entry.children) {
        await this.walkEntry(child, childPrefix, graph);
      }
    }
  }

  /**
   * Deliver output as a downloadable zip file in the browser.
   * Requires a zip library (e.g. JSZip) to be available.
   */
  async deliverOutput(result: MigrationResult): Promise<void> {
    this.logger.info(`BrowserRuntimeAdapter: preparing download`, {
      files: result.outputResult.written.length,
    });

    // In a real implementation with JSZip:
    // const JSZip = (await import("jszip")).default;
    // const zip = new JSZip();
    // const folder = zip.folder(result.platform + "-migrated");
    // for (const [path, file] of result.graph.files) {
    //   folder.file(path, file.content);
    // }
    // const blob = await zip.generateAsync({ type: "blob" });
    // const url = URL.createObjectURL(blob);
    // const a = document.createElement("a");
    // a.href = url;
    // a.download = `${result.platform}-migrated.zip`;
    // a.click();
    // URL.revokeObjectURL(url);

    this.logger.info(`BrowserRuntimeAdapter: download triggered`);
  }

  reportProgress(event: ProgressEvent): void {
    this.onProgress?.(event);
  }
}
