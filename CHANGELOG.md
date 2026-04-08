# Changelog

All notable changes to migrare are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [0.0.1] — 2026-04-08

First public release. Lovable migration works end-to-end in the web tool.

### Added

**Web tool**
- Homepage lander with feature grid, steps, platform support, CTA strip
- Migration tool at `/app` — ZIP upload, scan report, migrate/preview/download
- `/for-ai` page — agent-oriented API docs with honest usage patterns
- Prestruct SSR — both routes prerendered to static HTML at build time
- Per-route `<title>`, `<meta>`, OG, canonical, JSON-LD schema
- `sitemap.xml` and `404.html` generated at build time
- `_headers` with security headers and CDN cache rules
- `_routes.json` routing `/api/*` to the Functions layer

**API (Cloudflare Pages Functions)**
- `GET /api/health` — version heartbeat
- `POST /api/scan` — read-only lock-in signal detection from a base64 zip
- `POST /api/migrate` — applies transforms, returns `{path, content}` pairs
- `GET /api/spec` — machine-readable JSON API description
- Edge engine self-contained in `web/functions/api/[[route]].js` — no cross-file imports, no bundler, runs on the Workers runtime

**AI / agent support**
- `/llms.txt` — plain-text site summary following the llms.txt convention
- `/api/spec` — stable JSON schema for agent tool registration
- `/for-ai` — usage patterns, scan/migrate contract, recommended flow

**Design system**
- `design.css` — single CSS DSL: tokens, scrollbars, code blocks, tooltips, loading, animations
- Mobile-first layout — stacked column on mobile, three-column at 768px+
- Viewport-aware tooltips with JS positioning and touch toggle support
- Themed sidebars with inset accent gradient
- `GithubIcon` SVG component replacing text GitHub links
- Scan output block — raw CLI-style, not a macOS window

**Lovable plugin**
- Detection: `lovable-tagger`, `.lovable`, `componentTagger`, env var fingerprints
- Scanners: `build-config`, `state-entanglement`, `auth-coupling`, `environment-bleed`
- Transforms: `remove-lovable-tagger`, `abstract-supabase-client`, `remove-env-bleed`

**Core TypeScript (scaffolded, CLI planned for v0.1.0)**
- `MigrareEngine`, `ProjectGraph`, `LockInScanner`, `TransformPipeline`, `ValidationLayer`
- Plugin interface — `IPlugin`, `IScanner`, `ITransform`, `IValidator`
- Auth scaffolding — `GitHubOAuthProvider` (PKCE), `GitHubAppProvider`, `LocalAuthProvider`
- Output adapters — `GitHubPRAdapter`, `ViteAdapter`, `NextAdapter`

**Release infrastructure**
- GitHub Actions workflow — tag `v*.*.*` triggers build, source zip, web dist zip, GitHub Release
- Changelog entry auto-extracted per tag

### Known limitations

- CLI filesystem walking is stubbed — full CLI planned for v0.1.0
- GitHub repo ingestion via web UI not yet wired — ZIP only for now
- Bolt.new and Replit plugins planned for v0.1.0
- Right sidebar hidden on mobile — transform guide not accessible on small screens (v0.1.0)

---

## Planned

### [0.1.0]
- Full CLI: `npx migrare` wizard end-to-end, filesystem walking
- Bolt.new plugin
- Replit plugin
- GitHub OAuth repo ingestion in web UI

### [0.2.0]
- v0 / Vercel plugin
- Multi-platform detection
- AST-based transforms via ts-morph
- GitHub PR output adapter fully wired
