/**
 * scripts/prerender.js
 * ====================
 * Runs after `vite build && node scripts/inject-brand.js` via `npm run build`.
 * Uses Vite's ssrLoadModule to render each route to static HTML.
 *
 * Why ssrLoadModule instead of `vite build --ssr`:
 *   ssrLoadModule resolves all imports through Vite's unified module registry.
 *   This guarantees a single instance of react-router-dom -- StaticRouter and
 *   Routes share the same context, so location propagates correctly.
 *   A compiled SSR bundle would silently render every route as '/' with no error.
 *   See AGENTS.md for the full root cause analysis.
 *
 * Output (for a 3-route app with /, /about, /contact):
 *   dist/index.html           → /
 *   dist/about/index.html     → /about
 *   dist/contact/index.html   → /contact
 *   dist/404.html             → served by CF Pages for unmatched routes (HTTP 404)
 *   dist/sitemap.xml          → replaces the static one from public/
 *
 * Fails gracefully -- exits 0 on fatal error so CF Pages deploy continues as SPA.
 */

import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')
const DIST      = path.join(ROOT, 'dist')

// ── Load config ───────────────────────────────────────────────────────────────

let config
try {
  config = (await import('../ssr.config.js')).default
} catch (err) {
  console.error('[prerender] Could not load ssr.config.js:', err.message)
  process.exit(0)
}

const {
  siteUrl,
  siteName = 'Site',
  routes: ROUTES = [],
  appLayoutPath = '/src/AppLayout.jsx',
} = config

if (!ROUTES.length) {
  console.warn('[prerender] No routes defined in ssr.config.js -- skipping')
  process.exit(0)
}

// ── Meta injection ────────────────────────────────────────────────────────────

function injectMeta(html, meta, routePath) {
  // Prevent regex backreference expansion when dynamic values are used in replacement strings.
  const escapeReplacement = (s) => String(s || '').replace(/\$/g, '$$$$')

  const title   = escapeReplacement(meta.title)
  const desc    = escapeReplacement(meta.description)
  const ogImage = escapeReplacement(meta.ogImage || config.ogImage || '')
  const url     = escapeReplacement(`${siteUrl}${routePath === '/' ? '' : routePath}`)

  if (title) {
    html = html.replace(/<title>[^<]*<\/title>/,                                     `<title>${title}</title>`)
    html = html.replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/s,        `$1${title}$2`)
    html = html.replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/s,       `$1${title}$2`)
  }
  if (desc) {
    html = html.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/s,         `$1${desc}$2`)
    html = html.replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/s,  `$1${desc}$2`)
    html = html.replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/s, `$1${desc}$2`)
  }
  html = html.replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/s,            `$1${url}$2`)
  html = html.replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/s,                 `$1${url}$2`)
  if (ogImage) {
    html = html.replace(/(<meta\s+property="og:image"\s+content=")[^"]*(")/s,        `$1${ogImage}$2`)
    html = html.replace(/(<meta\s+name="twitter:image"\s+content=")[^"]*(")/s,       `$1${ogImage}$2`)
  }

  return html
}

// ── Sitemap ───────────────────────────────────────────────────────────────────

function generateSitemap(routes) {
  const now  = new Date().toISOString().split('T')[0]
  const urls = routes.map(r => `
  <url>
    <loc>${siteUrl}${r.path === '/' ? '' : r.path}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${r.changefreq || 'monthly'}</changefreq>
    <priority>${r.priority || '0.5'}</priority>
  </url>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}\n</urlset>`
}

// ── 404 page ──────────────────────────────────────────────────────────────────
// Uses id="root-404" (not "root") so main.jsx does NOT trigger hydrateRoot.
// hydrateRoot expects SSR React content -- this is plain static HTML.
// The React bundle script tag is stripped -- no JS loads at all on 404 pages.
// See AGENTS.md for the full explanation.

function generate404(shell) {
  const notFoundConfig = config.notFound || {}
  const heading        = notFoundConfig.heading        || 'Page not found.'
  const body           = notFoundConfig.body           || "That page doesn't exist -- or it moved."
  const primaryLabel   = notFoundConfig.primaryCta?.label  || 'Go home'
  const primaryHref    = notFoundConfig.primaryCta?.href   || '/'

  const bodyLines = [
    '<div id="root-404">',
    '  <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:4rem 2rem">',
    `    <h1 style="font-size:2.5rem;font-weight:800;margin-bottom:1rem">${heading}</h1>`,
    `    <p style="max-width:480px;font-size:1.05rem;line-height:1.7;margin-bottom:2rem">${body}</p>`,
    `    <a href="${primaryHref}" style="display:inline-flex;align-items:center;padding:0.75rem 1.75rem;background:#000;color:#fff;font-weight:700;font-size:0.9rem;letter-spacing:0.05em;text-transform:uppercase;border-radius:6px;text-decoration:none">${primaryLabel}</a>`,
    '  </div>',
    '</div>',
  ]

  let html = shell.replace('<div id="root"></div>', bodyLines.join('\n'))
  html = html.replace(/<title>[^<]*<\/title>/,       `<title>Page Not Found | ${siteName}</title>`)
  html = html.replace(
    /(<meta\s+name="description"\s+content=")[^"]*(")/s,
    `$1The page you were looking for does not exist.$2`
  )
  html = html.replace(
    /(<meta\s+property="og:title"\s+content=")[^"]*(")/s,
    `$1Page Not Found | ${siteName}$2`
  )
  html = html.replace(
    /(<link\s+rel="canonical"\s+href=")[^"]*(")/s,
    `$1${siteUrl}/$2`
  )
  // noindex -- 404 pages should not appear in search results
  // Remove existing robots meta first to avoid duplicate, then insert noindex
  html = html.replace(
    /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/s,
    ''
  )
  html = html.replace(
    '<meta name="author"',
    '<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />\n  <meta name="author"'
  )
  // Strip the React bundle -- 404 is pure static HTML, no React needed
  html = html.replace(/<script type="module"[^>]*><\/script>/, '')

  return html
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function prerender() {
  console.log('\n[prerender] Starting static HTML generation...')

  const { createServer }   = await import('vite')
  const { renderToString } = await import('react-dom/server')
  const React              = (await import('react')).default
  const { StaticRouter }   = await import('react-router-dom/server.js')

  // Vite dev server in SSR mode.
  // ssrLoadModule resolves all imports through Vite's unified module registry,
  // guaranteeing a single react-router-dom instance. StaticRouter's location
  // context reaches useLocation() inside Routes correctly.
  const vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'custom',
    customLogger: {
      info:           () => {},
      warn:           (msg) => { if (!msg.includes('ExperimentalWarning')) process.stderr.write('[prerender:warn] ' + msg + '\n') },
      error:          (msg) => process.stderr.write('[prerender:err] '  + msg + '\n'),
      clearScreen:    () => {},
      hasErrorLogged: () => false,
      hasWarned:      false,
      warnOnce:       () => {},
    },
  })

  try {
    const { default: AppLayout } = await vite.ssrLoadModule(appLayoutPath)
    const shell     = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8')
    let succeeded   = 0

    for (const route of ROUTES) {
      try {
        const appHtml = renderToString(
          React.createElement(
            StaticRouter,
            { location: route.path },
            React.createElement(AppLayout)
          )
        )

        let html = shell.replace(
          '<div id="root"></div>',
          `<div id="root" data-server-rendered="true">${appHtml}</div>`
        )

        html = injectMeta(html, route.meta || {}, route.path)

        if (route.path === '/') {
          fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf-8')
        } else {
          const dir = path.join(DIST, route.path.slice(1))
          fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8')
        }

        console.log(`[prerender] ✓ ${route.path}`)
        succeeded++
      } catch (err) {
        console.error(`[prerender] ✗ ${route.path}: ${err.message}`)
      }
    }

    // 404.html -- CF Pages serves this for all unmatched routes with HTTP 404
    fs.writeFileSync(path.join(DIST, '404.html'), generate404(shell), 'utf-8')
    console.log('[prerender] ✓ /404.html')

    // sitemap.xml -- overwrites the static one in public/ with today's date
    fs.writeFileSync(path.join(DIST, 'sitemap.xml'), generateSitemap(ROUTES), 'utf-8')
    console.log('[prerender] ✓ /sitemap.xml')

    console.log(`[prerender] Done. ${succeeded}/${ROUTES.length} pages rendered.\n`)

  } finally {
    await vite.close()
  }
}

prerender().catch(err => {
  // Fail gracefully -- log the error but exit 0 so CF Pages deploy continues
  // as a plain SPA rather than failing entirely
  console.warn('[prerender] Fatal -- deploying as SPA:', err.message)
  process.exit(0)
})
