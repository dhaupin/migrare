// ssr.config.js — Prestruct SSR config
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
    {
      path:       '/for-ai',
      priority:   '0.7',
      changefreq: 'monthly',
      meta: {
        title:       'migrare for AI agents',
        description: 'JSON API for AI agents and coding assistants. Call /api/scan to get a structured lock-in report. Stateless, no auth, returns immediately.',
      },
    },
    {
      path:       '/docs',
      priority:   '0.8',
      changefreq: 'weekly',
      meta: {
        title:       'Documentation — migrare',
        description: 'How to use migrare: CLI commands, Supabase migration guide, FAQs, and quick start.',
      },
    },
    {
      path:       '/contact',
      priority:   '0.6',
      changefreq: 'monthly',
      meta: {
        title:       'Contact — migrare',
        description: 'Get help with your migration. Creadev is available to assist if you get stuck or need guidance.',
      },
    },
    {
      path:       '/terms',
      priority:   '0.3',
      changefreq: 'yearly',
      meta: {
        title:       'Terms of Service — migrare',
        description: 'Terms of Service for migrare. No warranty, not responsible for anything, use at your own risk.',
      },
    },
    {
      path:       '/privacy',
      priority:   '0.3',
      changefreq: 'yearly',
      meta: {
        title:       'Privacy Policy — migrare',
        description: 'Privacy Policy for migrare. We do not collect, store, or share any personal data.',
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
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        author: { '@type': 'Organization', name: 'Creadev', url: 'https://creadev.org' },
      },
    ]
  },
}
