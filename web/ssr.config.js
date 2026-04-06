// ssr.config.js — Prestruct SSR config
// Engine reads this at build time to prerender routes and inject meta.
// See: https://github.com/dhaupin/prestruct

export default {
  siteUrl:       'https://migrare.creadev.org',
  siteName:      'migrare',
  author:        'Creadev',
  tagline:       'Escape vendor lock-in from vibe-coding platforms.',
  ogImage:       'https://migrare.creadev.org/og-image.png',
  keywords:      'lovable migration, bolt migration, replit migration, vibe coding, vendor lock-in, react vite migration',
  appLayoutPath: '/src/AppLayout.jsx',

  routes: [
    {
      path:       '/',
      priority:   '1.0',
      changefreq: 'weekly',
      meta: {
        title:       'migrare — escape vendor lock-in',
        description: 'Migrate your Lovable, Bolt, or Replit project to a clean, self-owned codebase. No lock-in. No subscriptions. Your code belongs to you.',
      },
    },
    {
      path:       '/app',
      priority:   '0.9',
      changefreq: 'weekly',
      meta: {
        title:       'migration tool — migrare',
        description: 'Upload a ZIP from Lovable, scan for lock-in signals, apply automated transforms, and download a clean portable project.',
      },
    },
  ],

  buildJsonLd() {
    return [
      {
        '@context': 'https://schema.org',
        '@type':    'SoftwareApplication',
        name:       'migrare',
        url:        'https://migrare.creadev.org',
        description: 'Open-source migration tool for vibe-coded apps. Detect lock-in signals and migrate to a clean, self-owned codebase.',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        author: {
          '@type': 'Organization',
          name:    'Creadev',
          url:     'https://creadev.org',
        },
      },
    ]
  },
}
