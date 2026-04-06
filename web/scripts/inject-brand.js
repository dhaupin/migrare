// scripts/inject-brand.js — Prestruct engine (do not edit)
// Injects global SEO meta from ssr.config.js into dist/index.html.
// Run after vite build, before prerender.js.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const config = (await import(`${root}/ssr.config.js`)).default;
const distHtml = resolve(root, "dist/index.html");

let html = readFileSync(distHtml, "utf8");

const meta = `
  <meta name="description" content="${config.routes[0]?.meta?.description ?? config.tagline}" />
  <meta name="author" content="${config.author}" />
  <meta name="keywords" content="${config.keywords}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${config.siteName}" />
  <meta property="og:image" content="${config.ogImage}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${config.ogImage}" />
  <link rel="canonical" href="${config.siteUrl}/" />
`.trim();

html = html.replace("</head>", `  ${meta}\n  </head>`);
writeFileSync(distHtml, html);
console.log("[inject-brand] Global meta injected into dist/index.html");
