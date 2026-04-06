# Changelog

All notable changes to migrare are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [0.0.1] — 2026-04-05

Initial public release. Lovable migration is functional end-to-end via the web tool.

### Added

- Core engine: `MigrareEngine`, `ProjectGraph`, `LockInScanner`, `TransformPipeline`, `ValidationLayer`
- Lovable plugin with four scanners: `supabase-direct-import`, `build-config`, `generated-supabase-client`, `env-bleed`
- Lovable transforms: `remove-lovable-tagger`, `abstract-supabase-client`, `remove-env-bleed`
- Cloudflare Pages Functions API: `GET /api/health`, `POST /api/scan`, `POST /api/migrate`
- Edge engine (`functions/_engine.js`): self-contained zip parser using `DecompressionStream`, no Node built-ins, runs on the Workers runtime
- Web UI: React 18 + React Router v6 + Vite 5, two routes (`/` lander, `/app` tool)
- Homepage lander with feature grid, platform support table, how-it-works steps, terminal preview
- Migration tool: zip drop, scan report, transform log, JSZip download of migrated output
- Prestruct SSR integration: both routes prerendered to static HTML at build time
- Per-route `<title>`, `<meta>`, OG, canonical, JSON-LD schema
- `sitemap.xml` and `404.html` generated at build time
- `_headers` with security headers and CDN cache rules (Cloudflare Pages syntax)
- `_redirects` without SPA fallback (required for Prestruct prerendering)
- CLI scaffolding: `MigrareEngine`, wizard, formatter (full CLI implementation planned for v0.1.0)
- Auth scaffolding: `GitHubOAuthProvider` (PKCE), `GitHubAppProvider`, `LocalAuthProvider`
- Output adapter scaffolding: `GitHubPRAdapter`, `ViteAdapter`, `NextAdapter`
- `AGENTS.md` for AI agent context
- `LICENSE` (MIT)

### Known limitations

- CLI filesystem walking not yet implemented (stubs in place)
- GitHub repo ingestion via web UI not yet wired (zip only)
- Bolt.new and Replit plugins planned for v0.1.0
- SSE progress stream replaced with simple polling model in web v0.0.1

---

## Planned

### [0.1.0]

- Full CLI: filesystem walking, `npx migrare` wizard end-to-end
- Bolt.new plugin
- Replit plugin
- GitHub OAuth flow for repo ingestion in the web UI
- PR output adapter fully wired

### [0.2.0]

- v0 / Vercel plugin
- Multi-platform detection (monorepos)
- AST-based transforms via ts-morph
