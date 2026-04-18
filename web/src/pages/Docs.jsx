import React from "react";
import { Link } from "react-router-dom";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import GithubIcon from "../components/GithubIcon";

const faqs = [
  {
    q: "What does Migrare actually do?",
    a: "Migrare scans your exported Lovable project for vendor lock-in patterns - proprietary build tooling, hardcoded credentials, platform-specific env vars, and auth coupling. It then applies surgical transforms to remove or fix these issues, giving you a clean, portable codebase you can self-host.",
  },
  {
    q: "Is my code safe?",
    a: "Yes. Migrare never touches your original repo. The web tool processes everything in memory on Cloudflare's edge - nothing is stored, logged, or persisted. For extra privacy, run the CLI locally where your code never leaves your machine.",
  },
  {
    q: "What platforms are supported?",
    a: "Lovable, Bolt.new, Replit, and v0 (Vercel) are fully supported. Base44 support is planned. The scanner framework is extensible so new platforms can be added as plugins.",
  },
  {
    q: "Do I need an account?",
    a: "No. Migrare is MIT-licensed open source. No auth, no signup, no data collection. Run it locally via CLI or use the hosted tool anonymously.",
  },
  {
    q: "What if the scan finds errors?",
    a: "The scan report lists every lock-in signal by file, line, severity, and suggested fix. Review the report before migrating. Some issues require manual review - Migrare will tell you when a transform can't be automated.",
  },
  {
    q: "How do I finish the migration with Supabase?",
    a: "After running Migrare, your Supabase credentials are moved to environment variables. Create a .env file in your new project with your Supabase URL and anon key from your Lovable project's Supabase dashboard. The migrated code reads from VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  },
];

const cliCommands = [
  {
    cmd: "npx migrare",
    desc: "Launch the interactive CLI wizard. It guides you through scanning a project and applying transforms step by step.",
  },
  {
    cmd: "npx migrare scan ./my-app",
    desc: "Scan a local directory or zip file. Outputs a detailed lock-in report to the terminal.",
  },
  {
    cmd: "npx migrare migrate ./my-app -o ./output",
    desc: "Run the full migration pipeline. Writes transformed files to ./output. Use --dry-run to preview without writing.",
  },
  {
    cmd: "npx migrare ui",
    desc: "Start the local web interface at localhost:4242. Use this instead of the CLI for a visual migration workflow.",
  },
];

const supabaseSteps = [
  {
    step: "01",
    title: "Get your Supabase credentials",
    desc: "Go to your Supabase dashboard → your project → Settings → API. Copy the Project URL and the anon public key (not the service_role key).",
  },
  {
    step: "02",
    title: "Create .env file",
    desc: "In your migrated project root, create a .env file with VITE_SUPABASE_URL=https://your-project.supabase.co and VITE_SUPABASE_ANON_KEY=your-anon-key.",
  },
  {
    step: "03",
    title: "Add .env to gitignore",
    desc: "Make sure .env is in your .gitignore so credentials aren't committed. The migrated project includes a .env.example with placeholder names.",
  },
  {
    step: "04",
    title: "Run locally",
    desc: "Run npm install && npm run dev. Your app should connect to Supabase using the env vars. If you see auth errors, check your URL and key are correct.",
  },
  {
    step: "05",
    title: "Deploy anywhere",
    desc: "Set the same environment variables in your deployment platform (Vercel, Netlify, Cloudflare Pages, your own server). Your code is now portable.",
  },
];

export default function Docs() {
  return (
    <div className="page">
      {/* Nav */}
      <Nav />

      {/* Header */}
      <section className="hero hero-max">
        <div className="hero-eyebrow">
          <span className="badge">docs</span>
          <span className="t-muted">·</span>
          <span className="t-dim t-xs">How to use Migrare</span>
        </div>
        <h1 className="hero-h1">
          Documentation
        </h1>
        <p className="hero-sub">
          Everything you need to know about using Migrare - from the web tool to the CLI
          to finishing your Supabase migration.
        </p>
      </section>

      {/* Quick start */}
      <section className="section content-max">
        <p className="section-label">quick start</p>
        <div className="steps">
          {[
            ["01", "Export from Lovable", "Download your project as a ZIP from Lovable's export menu."],
            ["02", "Upload or drop", "Drop the ZIP into migrare.creadev.org/app, or use the CLI with a local path."],
            ["03", "Review scan report", "Read the lock-in signals. Note which files have issues and what kind."],
            ["04", "Run migration", "Click migrate to apply transforms. Download the result ZIP."],
            ["05", "Deploy", "Unzip into your own repo. Set your Supabase env vars. Deploy anywhere."],
          ].map(([num, title, desc]) => (
            <div key={num} className="step">
              <span className="step-num">{num}</span>
              <div>
                <div className="step-title">{title}</div>
                <div className="step-desc">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CLI usage */}
      <section className="section content-max">
        <p className="section-label">CLI commands</p>
        <div className="help-block">
          <p className="help-text">
            Install once, run anywhere. The CLI processes everything locally - your code never leaves your machine.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {cliCommands.map((c) => (
            <div key={c.cmd} className="code-block">
              <p className="code-block-label">{c.cmd}</p>
              <p className="help-text" style={{ margin: 0, marginTop: "var(--s-2)" }}>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Supabase migration */}
      <section className="section content-max">
        <p className="section-label">finishing migration with supabase</p>
        <div className="help-block">
          <p className="help-text">
            Migrare moves your hardcoded Supabase credentials to environment variables.
            Here's how to complete the setup in your new project.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {supabaseSteps.map((s) => (
            <div key={s.step} className="card">
              <div className="card-header">
                <span className="t-muted t-xs t-upper t-track">{s.step}</span>
                <span className="t-white t-md" style={{ fontFamily: "var(--sans)", fontWeight: 500 }}>
                  {s.title}
                </span>
              </div>
              <div className="card-body">
                <p className="help-text" style={{ margin: 0 }}>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Example env file */}
      <section className="section content-max">
        <p className="section-label">example .env file</p>
        <div className="code-block">
          <pre><code>{`# Supabase credentials
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Optional: your own custom env vars
VITE_API_DOMAIN=https://api.yourdomain.com`}</code></pre>
        </div>
        <p className="t-dim t-xs" style={{ marginTop: "var(--s-3)" }}>
          Make sure .env is in your .gitignore - never commit credentials.
        </p>
      </section>

      {/* FAQs */}
      <section className="section content-max">
        <p className="section-label">frequently asked questions</p>
        <div className="flex flex-col gap-4">
          {faqs.map((f) => (
            <div key={f.q} className="flex flex-col gap-2">
              <p className="t-white t-md" style={{ fontFamily: "var(--sans)", fontWeight: 500 }}>
                {f.q}
              </p>
              <p className="help-text" style={{ margin: 0 }}>{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* More resources */}
      <section className="section content-max">
        <p className="section-label">more resources</p>
        <div className="flex flex-col gap-3">
          {[
            ["GitHub repo", "https://github.com/dhaupin/migrare", "Star it, file issues, contribute."],
            ["For AI agents", "/for-ai", "API documentation for AI agents."],
            ["Source code", "https://github.com/dhaupin/migrare/tree/main/src", "Understand how the engine works."],
          ].map(([title, href, desc]) => (
            <a
              key={title}
              href={href}
              className="card"
              style={{ textDecoration: "none" }}
            >
              <div className="card-header">
                <span className="badge badge-green">{title}</span>
              </div>
              <div className="card-body">
                <p className="help-text" style={{ margin: 0 }}>{desc}</p>
              </div>
            </a>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}