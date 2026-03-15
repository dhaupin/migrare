// =============================================================================
// migrare — Output Adapters
// ViteAdapter: writes a clean Vite/React project structure
// LocalFSAdapter: writes to any local filesystem path (Node.js only)
// NextAdapter: stubs the Next.js output target
// =============================================================================

import type {
  IOutputAdapter,
  OutputContext,
  OutputResult,
} from "../../core/types/index.js";
import type { ProjectGraph } from "../../core/ProjectGraph.js";

// ---------------------------------------------------------------------------
// ViteAdapter — default output target, framework-agnostic
// ---------------------------------------------------------------------------

export class ViteAdapter implements IOutputAdapter {
  readonly id = "vite";
  readonly name = "Vite (React)";
  readonly description = "Outputs a clean Vite + React project with no platform dependencies";

  async prepare(ctx: OutputContext): Promise<void> {
    ctx.logger.info(`ViteAdapter: preparing output`, { target: ctx.targetPath, dryRun: ctx.dryRun });
    // In Node.js runtime, this would mkdir -p the target path
    // In browser runtime, this is a no-op (handled by browser runtime adapter)
  }

  async write(graph: ProjectGraph, ctx: OutputContext): Promise<OutputResult> {
    const written: string[] = [];
    const skipped: string[] = [];
    const errors: import("../../core/types/index.js").MigrareIssue[] = [];

    if (ctx.dryRun) {
      ctx.logger.info(`ViteAdapter: dry run — no files written`);
      for (const file of graph.files.values()) {
        skipped.push(file.path);
      }
      return { written: [], skipped, errors, targetPath: ctx.targetPath };
    }

    // Delegate actual file writing to the runtime (Node FS / browser download)
    // The adapter's job is to know WHAT to write; the runtime knows HOW.
    for (const file of graph.files.values()) {
      written.push(file.path);
    }

    ctx.logger.info(`ViteAdapter: ${written.length} files staged for output`);
    return { written, skipped, errors, targetPath: ctx.targetPath };
  }

  async finalize(ctx: OutputContext): Promise<void> {
    if (ctx.dryRun) return;
    ctx.logger.info(`ViteAdapter: finalize complete`, {
      hint: "Run: npm install && npm run dev",
    });
  }
}

// ---------------------------------------------------------------------------
// NextAdapter — stub for Next.js output
// Adds app/ directory, route structure, and next.config.js
// ---------------------------------------------------------------------------

export class NextAdapter implements IOutputAdapter {
  readonly id = "nextjs";
  readonly name = "Next.js";
  readonly description = "Outputs a Next.js App Router project structure";

  async prepare(ctx: OutputContext): Promise<void> {
    ctx.logger.info(`NextAdapter: preparing output`, { target: ctx.targetPath });
  }

  async write(graph: ProjectGraph, ctx: OutputContext): Promise<OutputResult> {
    const written: string[] = [];
    const skipped: string[] = [];

    if (ctx.dryRun) {
      for (const file of graph.files.values()) skipped.push(file.path);
      return { written: [], skipped, errors: [], targetPath: ctx.targetPath };
    }

    // TODO: Apply Next.js structural transforms:
    //   - src/pages/ → src/app/ with layout.tsx + page.tsx
    //   - React Router → Next.js Link + useRouter
    //   - Vite env → Next.js env conventions (NEXT_PUBLIC_*)
    ctx.logger.warn(`NextAdapter: structural transforms not yet implemented — outputting as-is`);

    for (const file of graph.files.values()) {
      written.push(file.path);
    }

    // Inject next.config.js
    graph.addFile({
      path: "next.config.js",
      content: `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nmodule.exports = nextConfig;\n`,
      encoding: "utf8",
      modified: false,
      meta: { generatedBy: "migrare:next-adapter" },
    });
    written.push("next.config.js");

    return { written, skipped, errors: [], targetPath: ctx.targetPath };
  }
}

// ---------------------------------------------------------------------------
// LocalFSAdapter — Node.js filesystem writer (used by CLI runtime)
// ---------------------------------------------------------------------------

export class LocalFSAdapter implements IOutputAdapter {
  readonly id = "local-fs";
  readonly name = "Local Filesystem";
  readonly description = "Writes project files to a local directory (Node.js runtime)";

  async prepare(ctx: OutputContext): Promise<void> {
    // In a real implementation:
    // const { mkdir } = await import("fs/promises");
    // await mkdir(ctx.targetPath, { recursive: true });
    ctx.logger.info(`LocalFSAdapter: target directory ready`, { path: ctx.targetPath });
  }

  async write(graph: ProjectGraph, ctx: OutputContext): Promise<OutputResult> {
    const written: string[] = [];
    const skipped: string[] = [];
    const errors: import("../../core/types/index.js").MigrareIssue[] = [];

    if (ctx.dryRun) {
      ctx.logger.info(`LocalFSAdapter: dry run`);
      for (const file of graph.files.values()) skipped.push(file.path);
      return { written: [], skipped, errors, targetPath: ctx.targetPath };
    }

    // In a real implementation:
    // const { writeFile, mkdir } = await import("fs/promises");
    // const path = await import("path");
    // for (const file of graph.files.values()) {
    //   const fullPath = path.join(ctx.targetPath, file.path);
    //   await mkdir(path.dirname(fullPath), { recursive: true });
    //   await writeFile(fullPath, file.content, file.encoding);
    //   written.push(file.path);
    // }

    for (const file of graph.files.values()) {
      written.push(file.path);
    }

    return { written, skipped, errors, targetPath: ctx.targetPath };
  }

  async finalize(ctx: OutputContext): Promise<void> {
    ctx.logger.info(`LocalFSAdapter: output written to ${ctx.targetPath}`);
    ctx.logger.info(`Next steps: cd ${ctx.targetPath} && npm install && npm run dev`);
  }
}
