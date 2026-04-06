// scripts/prerender.js — Prestruct engine (do not edit)
// Renders each route defined in ssr.config.js to dist/{route}/index.html.
// Uses ssrLoadModule to avoid dual-module instance problems.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const config = (await import(`${root}/ssr.config.js`)).default;
const shell = readFileSync(resolve(root, "dist/index.html"), "utf8");

// Build JSON-LD once
const jsonLd = config.buildJsonLd?.() ?? [];
const jsonLdScript = jsonLd.length > 0
  ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
  : "";

// Start Vite in SSR mode
const vite = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

for (const route of config.routes) {
  const { path, meta = {} } = route;

  // Load AppLayout fresh per route via ssrLoadModule
  const mod = await vite.ssrLoadModule(config.appLayoutPath);
  const AppLayout = mod.default;

  const appHtml = renderToString(
    React.createElement(
      StaticRouter,
      { location: path },
      React.createElement(AppLayout)
    )
  );

  // Per-route head tags
  const title = meta.title ?? config.siteName;
  const description = (meta.description ?? config.tagline)
    .replace(/\$/g, "$$$$"); // escape $ signs for .replace()

  const canonical = `${config.siteUrl}${path === "/" ? "" : path}/`;

  const routeMeta = `
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonical}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <link rel="canonical" href="${canonical}" />
    ${jsonLdScript}
  `.trim();

  let html = shell
    .replace("</head>", `  ${routeMeta}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);

  // Write to dist
  const outDir = path === "/"
    ? resolve(root, "dist")
    : resolve(root, "dist", path.replace(/^\//, ""));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "index.html"), html);
  console.log(`[prerender] ${path} → dist${path === "/" ? "" : path}/index.html`);
}

// Generate sitemap.xml
const today = new Date().toISOString().split("T")[0];
const sitemapEntries = config.routes.map((r) => `
  <url>
    <loc>${config.siteUrl}${r.path === "/" ? "" : r.path}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${r.changefreq ?? "monthly"}</changefreq>
    <priority>${r.priority ?? "0.5"}</priority>
  </url>`.trim()).join("\n  ");

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${sitemapEntries}
</urlset>`;

writeFileSync(resolve(root, "dist/sitemap.xml"), sitemap);
console.log("[prerender] sitemap.xml written");

// Generate 404.html
const notFoundHtml = shell
  .replace("</head>", `  <title>404 — migrare</title>\n  </head>`)
  .replace('<div id="root"></div>', '<div id="root-404"><p style="color:#5a7a5a;font-family:monospace;padding:2rem">404 — page not found</p></div>');
writeFileSync(resolve(root, "dist/404.html"), notFoundHtml);
console.log("[prerender] 404.html written");

await vite.close();
console.log("[prerender] done");
