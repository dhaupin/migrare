# AGENTS.md — migrare codebase context

This file is for AI agents (Claude, Copilot, Cursor, etc.) working on the migrare codebase.
Read it before making any changes. It describes what the project is, how it is structured,
what every major component does, and the rules that must not be broken.

---

## What migrare is

migrare is a migration framework that detects vendor lock-in in vibe-coding platform projects
(Lovable, Bolt, Replit) and migrates them to clean, portable, self-owned codebases.

The primary user journey is:
```
GitHub OAuth → pick repo → scan for lock-in → review report → confirm → PR opened
```

The output is a Pull Request against the user's own repository. The PR is the migration —
reviewable, reversible, and auditable. migrare never force-pushes to main.

The core value proposition: **your code belongs to you**.

---

## Package namespace

```
@migrare/core       The engine, types, interfaces — LTS, signed
@migrare/github     GitHub OAuth, App, ingest, and PR adapter — first-party
@migrare/lovable    Lovable platform plugin — reference implementation
@migrare/bolt       (planned) Bolt.new plugin
@migrare/replit     (planned) Replit plugin
```

The slash convention makes the kernel/plugin boundary legible in every import.
`@migrare/core` never imports from `@migrare/lovable`. The dependency graph is strictly top-down.

---

## Repository structure

```
src/
├── core/
│   ├── types/index.ts          ← THE CONTRACT. All interfaces live here. LTS.
│   ├── utils/index.ts          ← Pure utility functions. No migrare imports.
│   ├── ProjectGraph.ts         ← In-memory project model. Implements IProjectGraph.
│   ├── MigrareEngine.ts        ← Central orchestrator. Owns all registries.
│   ├── LockInScanner.ts        ← Runs IScanner instances. Read-only.
│   ├── TransformPipeline.ts    ← Runs ITransform instances. Mutates graph.
│   └── ValidationLayer.ts      ← Runs IValidator instances. Read-only assertions.
│
├── auth/
│   ├── types/index.ts          ← IAuthProvider, AuthSession, AuthCapabilities
│   ├── AuthRegistry.ts         ← Manages providers + active session (in-memory only)
│   └── providers/
│       ├── GitHubOAuthProvider.ts   ← PKCE flow. Browser-safe. No server secret.
│       ├── GitHubAppProvider.ts     ← Org installs. SERVER-SIDE ONLY.
│       └── LocalAuthProvider.ts     ← Reads GITHUB_TOKEN from env. CLI path.
│
├── plugins/
│   └── lovable/
│       └── LovablePlugin.ts    ← Reference IPlugin implementation.
│
├── adapters/
│   ├── github/
│   │   └── GitHubIngestAdapter.ts  ← Loads repo into ProjectGraph via GitHub API
│   ├── output/
│   │   ├── index.ts                ← ViteAdapter, NextAdapter, LocalFSAdapter
│   │   └── GitHubPRAdapter.ts      ← PRIMARY output: opens a PR
│   └── runtime/
│       └── index.ts                ← CLIRuntimeAdapter, BrowserRuntimeAdapter
│
├── cli/
│   ├── main.ts                 ← npx migrare binary entrypoint
│   ├── wizard.ts               ← Interactive terminal wizard
│   └── formatter.ts            ← ANSI scan report renderer
│
├── server/
│   └── index.ts                ← Local HTTP server + SSE progress stream
│
├── index.ts                    ← Public API barrel + createEngine() factory
│
web/
├── index.html                  ← Single-file web UI (terminal-inspired)
├── vite.config.js              ← Proxies /api to localhost:4242
└── package.json
```

---

## The type system (core/types/index.ts)

**This file is the root of the dependency tree. It has zero imports.**

Every interface an agent works with is defined here. Key contracts:

### IPlugin
The top-level extension point. A plugin bundles detection, scanning, transforms, and validators
for a single platform. See §Plugin Authoring below.

### ProjectGraph / ProjectFile
The in-memory project model. `file.modified` is the single source of truth for "a transform
touched this". Output adapters write ONLY modified files. **Never write to an output adapter
directly — always go through the engine.**

### ITransform
The atomic mutation unit. Must be **idempotent** — calling apply() twice must produce the same
result as calling it once. Check before mutating. Set `file.modified = true` on every changed file.
If you forget `modified = true`, the output adapter silently skips the file.

### IScanner
Read-only. Returns LockInSignals. **MUST NOT mutate the graph.** If a scanner mutates a file,
it corrupts the `modified` tracking that output adapters depend on.

### IValidator
Read-only assertion. Runs at one of four lifecycle phases. **MUST NOT mutate the graph.**
Returns `passed: false` if any error-severity issue is found — this halts the pipeline.

### IAuthProvider
Pluggable authentication. The `AuthSession.token` is opaque to the engine — only adapters
that make GitHub API calls use it. The session lives in memory only. **Never log or persist it.**

---

## The migration lifecycle

```
scan() or migrate() called
    │
    ▼
loadGraph()              ← runtime adapter ingests source
    │
    ▼
detectPlatforms()        ← each plugin.detect() runs; sorted by confidence
    │
    ▼
[pre-scan validation]    ← blockers here abort before scanning
    │
    ▼
scanner.scan()           ← all IScanner instances for detected platform run in parallel
    │
    ▼
[pre-transform validation]
    │
    ▼
pipeline.run()           ← ITransform instances run in order; appliesTo() checked first
    │
    ▼
[post-transform validation]
    │
    ▼
adapter.prepare()        ← validate output target (fail-fast)
adapter.write()          ← write modified files only
adapter.finalize()       ← open PR, run npm install, etc.
    │
    ▼
[post-output validation]
    │
    ▼
runtimeAdapter.deliverOutput()  ← present results to user
```

scan() stops after the scanner.scan() step and returns a ScanReport.
migrate() runs the full pipeline and returns a MigrationResult.

---

## Rules that must not be broken

### 1. Scanners and validators never mutate the graph
Any mutation before transforms run corrupts `modified` tracking.
Any mutation during validation produces incorrect post-output state.

### 2. Transforms must be idempotent
Running a transform twice must produce identical results to running it once.
The simplest implementation: check whether the change is already applied before applying it.

### 3. `file.modified = true` must be set on every changed file
This is how the output adapter knows what to write. Missing it means silent data loss.

### 4. `AuthSession.token` is never logged or persisted
migrare's core trust commitment. If you add logging that might print session fields,
explicitly redact the token: `{ ...session, token: '[REDACTED]' }`.

### 5. GitHubAppProvider must not be instantiated in browser builds
It requires the GitHub App private key. The constructor throws if `window` is defined.
Ensure any code path that creates this provider is gated by `typeof window === 'undefined'`.

### 6. core/types/index.ts has zero imports
It is the dependency root. Adding an import here creates a circular dependency risk.
If you need a utility in the types file, inline it as a type alias or move it to utils/.

### 7. Only write modified files in output adapters
Check `file.modified === true` OR `file.meta.generatedBy` before writing. Writing unchanged
files wastes resources and pollutes PR diffs with noise.

### 8. dryRun must produce zero side effects
If `outputCtx.dryRun === true`, the adapter MUST write nothing. Log what would happen.
The prepare() phase still runs to give early feedback on access issues.

---

## Auth layer

### Three providers

| Provider | When | Notes |
|---|---|---|
| `GitHubOAuthProvider` | Browser (migrare.dev), CLI with no token | PKCE flow. The only migrare.dev server call is the code exchange. |
| `GitHubAppProvider` | Org installs on migrare.dev backend | SERVER-SIDE ONLY. Requires private key. |
| `LocalAuthProvider` | CLI with GITHUB_TOKEN in env | Zero OAuth. Validates token + reads scopes on startup. |

### Token passthrough model
For the hosted migrare.dev version, the GitHub token lives in the browser's JS heap only.
After the code exchange, all GitHub API calls are client-side fetch() directly to api.github.com.
migrare.dev never stores, logs, or proxies the token after the exchange endpoint returns.

### Required GitHub scopes
`repo` (read + write), `read:org` — covers all operations migrare performs.

---

## Plugin authoring guide

A plugin is a class implementing `IPlugin`. The minimal structure:

```typescript
import type { IPlugin, PluginMeta, ProjectGraph, MigrareEngine } from '@migrare/core';

export class BoltPlugin implements IPlugin {
  readonly meta: PluginMeta = {
    id: 'bolt',           // globally unique, lowercase hyphenated
    name: 'Bolt.new',
    version: '0.1.0',
    description: 'Migration support for bolt.new projects',
  };

  async onRegister(engine: MigrareEngine): Promise<void> {
    // One-time setup. Optional.
  }

  async detect(graph: ProjectGraph) {
    // Return { detected: true, confidence: 'high', signals: [...] } if this
    // is a Bolt project. Check files and dependencies — don't parse ASTs here.
    const hasConfig = graph.getFile('.bolt/config.json') !== undefined;
    return {
      detected: hasConfig,
      confidence: 'high' as const,
      signals: hasConfig ? ['.bolt/config.json found'] : [],
    };
  }

  getScanners()   { return [new BoltBuildConfigScanner()]; }
  getTransforms() { return [new RemoveBoltDevServerTransform()]; }
  getValidators() { return [new BoltPostMigrateValidator()]; }
}
```

### Scanner skeleton

```typescript
import type { IScanner, LockInCategory, ProjectGraph, ScanContext, LockInSignal } from '@migrare/core';

export class BoltBuildConfigScanner implements IScanner {
  readonly id = 'bolt.build-config';
  readonly category: LockInCategory = 'build-config';
  readonly description = 'Detects Bolt-specific build configuration';

  async scan(graph: ProjectGraph, ctx: ScanContext): Promise<LockInSignal[]> {
    const signals: LockInSignal[] = [];
    const config = graph.getFile('vite.config.ts');
    if (!config) return signals;

    if (config.content.includes('@bolt/vite-plugin')) {
      signals.push({
        id: `bolt.build-config:vite.config.ts`,
        platform: ctx.platform,
        category: this.category,
        severity: 'warning',
        confidence: 'high',
        location: { file: 'vite.config.ts' },
        description: '@bolt/vite-plugin detected in build config',
        suggestion: 'Remove the plugin and its devDependency',
        meta: {},
      });
    }

    return signals;
    // NEVER mutate graph or config here.
  }
}
```

### Transform skeleton

```typescript
import type { ITransform, LockInCategory, ProjectGraph, TransformContext, TransformResult } from '@migrare/core';

export class RemoveBoltDevServerTransform implements ITransform {
  readonly id = 'bolt.remove-dev-server';
  readonly description = 'Removes Bolt-specific dev server config';
  readonly category: LockInCategory = 'build-config';
  readonly platforms = ['bolt'];

  appliesTo(graph: ProjectGraph): boolean {
    // Return false to skip — cheap check, no mutations
    return graph.getFile('vite.config.ts')?.content.includes('@bolt/vite-plugin') ?? false;
  }

  async apply(graph: ProjectGraph, ctx: TransformContext): Promise<TransformResult> {
    const file = graph.getFile('vite.config.ts')!;

    // IDEMPOTENCY CHECK: already removed?
    if (!file.content.includes('@bolt/vite-plugin')) {
      return { modified: [], created: [], deleted: [], warnings: [], meta: {} };
    }

    // Mutate content
    file.content = file.content
      .replace(/import.*@bolt\/vite-plugin.*\n/, '')
      .replace(/boltDevServer\(\),?\s*/g, '');

    file.modified = true;  // ← REQUIRED. Without this, the output adapter skips it.

    return { modified: ['vite.config.ts'], created: [], deleted: [], warnings: [], meta: {} };
  }
}
```

---

## The GitHub primary flow

The recommended integration pattern — the one the web UI uses:

```typescript
import { createGitHubMigration } from '@migrare/core';

const migration = await createGitHubMigration({
  session,          // AuthSession from OAuth or LocalAuthProvider
  owner: 'acme',
  repo:  'my-lovable-app',
  draftPR: false,
});

const result = await migration.run({ dryRun: false });
// → PR opened: github.com/acme/my-lovable-app/pull/...
```

`createGitHubMigration` wires:
- `GitHubIngestAdapter` as the ingest source
- `GitHubPRAdapter` as the output adapter
- All registered plugins for detection

---

## Web UI architecture

The web UI (`web/index.html`) is a single-file, zero-framework HTML/JS application.
It communicates with either:
- The local server at `localhost:4242` (when launched via `npx migrare ui`)
- `api.migrare.dev` (the hosted version)

### Ingestion methods (left sidebar)
1. **Drop ZIP** — Lovable project export, parsed client-side
2. **Connect GitHub** — OAuth PKCE flow → repo picker
3. **Paste URL** — public GitHub repo URL, loaded via GitHub API
4. **Pick folder** — File System Access API, local project

### Progress model
The web UI connects to `GET /api/progress` (SSE) once per migration run.
The local server pushes `data: <ProgressEvent JSON>\n\n` frames as the engine emits them.
The browser renders these as a live progress bar + log without polling.

### No framework, no build step (for the UI itself)
The web UI intentionally has no React, no bundler dependency for its own source.
It uses Vite only for the proxy during development (`npm run dev:web`).
The production web UI is a single HTML file that can be served from any static host.

---

## CLI architecture

```
npx migrare                → WizardFlow (interactive, detects + guides)
npx migrare scan <path>    → CLIRuntimeAdapter + LockInScanner → formatter
npx migrare migrate <path> → full engine pipeline → MigrationResult summary
npx migrare ui             → startServer() → opens localhost:4242
```

The CLI uses Node's built-in `parseArgs` — no commander or yargs dependency.
The wizard uses Node's `readline/promises` — no inquirer dependency.

Exit codes: `0` success, `1` failure or scan blockers found.

---

## Environment variables

| Name | Used by | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | LocalAuthProvider | GitHub PAT for CLI auth |
| `MIGRARE_TOKEN` | LocalAuthProvider | Override GITHUB_TOKEN (higher priority) |
| `MIGRARE_GITHUB_CLIENT_ID` | GitHubOAuthProvider | OAuth App client ID |
| `MIGRARE_GITHUB_APP_ID` | GitHubAppProvider | GitHub App ID |
| `MIGRARE_GITHUB_APP_PRIVATE_KEY` | GitHubAppProvider | GitHub App private key (server only) |

---

## What is NOT yet implemented

These stubs exist in the codebase but are not wired end-to-end:

| Component | Status | What's missing |
|---|---|---|
| `CLIRuntimeAdapter.loadProject()` | Stub | Node.js filesystem walker (`fs.readdir` recursive) |
| `BrowserRuntimeAdapter.loadProject()` | Stub | ZIP parsing (JSZip) + File System Access API wiring |
| `BrowserRuntimeAdapter.deliverOutput()` | Stub | ZIP download trigger or PR URL redirect |
| `/api/auth/github/token` | Not implemented | The one server-side code exchange endpoint |
| GitHub OAuth callback handler | Not implemented | Reads `?code=` + `?state=` from the URL |
| Repo picker UI | Not implemented | Post-OAuth repo list + selection |
| AST transforms | Not implemented | `file.ast` is reserved; `ts-morph` integration planned |

---

## Testing conventions (not yet scaffolded)

When writing tests:
- Use synthetic `ProjectGraph` instances — call `new ProjectGraph({ root: 'test', files: new Map([...]) })`
- Never hit real GitHub API in unit tests — mock fetch or use the `LocalAuthProvider` with a fixture token
- Verify `file.modified === true` after every transform test — the most common bug is forgetting it
- Verify `file.content` is identical after running a transform twice (idempotency)
- Validators: assert `result.passed === false` when you expect a blocker, not just `issues.length > 0`

---

## LTS and versioning

`@migrare/core` and `@migrare/github` follow an LTS model:
- Even minor versions are LTS: `0.2`, `0.4`, `1.0`, `1.2`
- Odd minor versions are current: `0.1`, `0.3`
- Breaking changes only in major versions with a 12-month deprecation window
- `@migrare/lovable` and community plugins follow their own semver — no LTS guarantee

Plugin authors should target `@migrare/core@^0.2` (the first LTS release) to avoid
churn while the `0.1` API settles.

---

## Brand and voice

When writing user-facing strings (CLI output, PR titles, PR bodies, error messages):

- Direct, no exclamation marks: "Migration complete." not "Migration complete!"
- Numbers over adjectives: "7 signals found" not "several issues detected"
- Honest about limits: "This signal requires manual review." not "Our AI could not resolve this."
- Never imply there is AI in the migration pipeline — there isn't.
- Primary tagline: **"Your code belongs to you."**

Error messages follow the pattern: `[code] human-readable message (file:line if applicable)`

---

*This file should be updated whenever new components are added or contracts change.*
*Last updated: migrare v0.1 — March 2026*
