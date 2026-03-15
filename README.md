# migrare

**Your code belongs to you.**

migrare scans projects built on vibe-coding platforms (Lovable, Bolt, Replit, and more) for vendor lock-in patterns, then migrates them to clean, portable, self-owned codebases.

---

## Quick start

```bash
# Zero install — just run it
npx migrare
```

The interactive wizard detects your platform, shows you what's locked in, and walks you through migration step by step.

---

## Web UI

```bash
npx migrare ui
```

Opens `http://localhost:4242` — a full browser interface with drag-and-drop ZIP import, GitHub OAuth, paste-a-URL, and local folder picker. No terminal required.

**Hosted version:** [migrare.dev](https://migrare.dev) *(coming soon)*

---

## CLI usage

```bash
# Scan a project (read-only, no changes made)
npx migrare scan ./my-lovable-project

# Migrate to a portable Vite + React project
npx migrare migrate ./my-lovable-project --output ./my-app

# Dry run — preview all changes without writing files
npx migrare migrate ./my-lovable-project --dry-run

# Migrate to Next.js App Router
npx migrare migrate ./my-lovable-project --target nextjs

# Output as JSON (for CI/scripting)
npx migrare scan ./my-project --json
```

---

## Install globally (optional)

```bash
npm install -g migrare

# Then use without npx:
migrare scan ./my-project
migrare ui
```

---

## What gets migrated

### Lovable

| Lock-in vector | Category | What migrare does |
|---|---|---|
| `lovable-tagger` in vite.config | Build config | Removes plugin + devDependency |
| `@supabase/*` direct component imports | Auth coupling | Flags for service layer extraction |
| `src/integrations/supabase/client.ts` | State entanglement | Moves hardcoded credentials to `.env` |
| `GPT_ENGINEER_*` / `LOVABLE_*` env vars | Environment bleed | Renames to standard `VITE_*` |

**Bolt, Replit, and more** — coming soon. See [Adding a plugin](#adding-a-plugin).

---

## Architecture

migrare is a **plugin framework**. The core engine is platform-agnostic; each platform is a plugin implementing a standard contract.

```
core/
├── MigrareEngine      ← orchestrator, plugin registry, lifecycle events
├── ProjectGraph       ← in-memory model of a project (files, deps, env)
├── TransformPipeline  ← ordered, hookable transform chain
├── ValidationLayer    ← pre/post migration assertions (4 phases)
└── LockInScanner      ← read-only signal detection

plugins/
└── lovable/           ← reference implementation

adapters/
├── output/            ← ViteAdapter, NextAdapter, LocalFSAdapter
└── runtime/           ← CLIRuntimeAdapter, BrowserRuntimeAdapter
```

---

## Adding a plugin

```typescript
import type { IPlugin } from 'migrare';

export class BoltPlugin implements IPlugin {
  readonly meta = {
    id: 'bolt',
    name: 'Bolt.new',
    version: '1.0.0',
    description: 'Migration support for bolt.new projects',
  };

  async detect(graph) {
    const signals = [];
    if (graph.getFile('.bolt/config.json')) signals.push('.bolt config found');
    return { detected: signals.length > 0, confidence: 'high', signals };
  }

  getScanners()   { return [/* IScanner implementations */]; }
  getTransforms() { return [/* ITransform implementations */]; }
  getValidators() { return [/* IValidator implementations */]; }
  async onRegister(engine) {}
}

// Register it:
const engine = await createEngine({ plugins: [] });
await engine.registerPlugin(new BoltPlugin());
```

---

## No telemetry. No accounts. No lock-in.

migrare is irony-free. It collects nothing, requires no signup, and the entire codebase is readable. The hosted version at migrare.dev runs the same engine as `npx migrare` — it adds GitHub OAuth so you can connect repos without a terminal.

---

## Contributing

```bash
git clone https://github.com/migrare/migrare
cd migrare
npm install
npm run dev         # watches core TypeScript
npm run dev:web     # web UI dev server on :5173, proxies API to :4242

# In another terminal:
node dist/cli/main.js scan ./test-fixtures/lovable-project
```

PRs welcome — especially new platform plugins.

---

## Roadmap

- [x] Core engine (ProjectGraph, TransformPipeline, ValidationLayer, LockInScanner)
- [x] Lovable plugin (reference implementation)
- [x] CLI with interactive wizard
- [x] Web UI (drag-drop, GitHub OAuth, paste URL, folder picker)
- [x] Local server (`npx migrare ui`)
- [ ] Node.js filesystem walker (complete CLI end-to-end)
- [ ] ZIP ingestion in browser (JSZip)
- [ ] GitHub OAuth + repo loading
- [ ] migrare.dev hosted deployment
- [ ] Bolt.new plugin
- [ ] Replit plugin
- [ ] AST-level transforms via ts-morph
- [ ] Rollback on migration failure

---

MIT License
