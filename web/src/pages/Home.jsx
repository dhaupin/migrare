import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const platforms = [
  { name: "Lovable", status: "ready" },
  { name: "Bolt.new", status: "soon" },
  { name: "Replit", status: "soon" },
  { name: "v0 / Vercel", status: "soon" },
];

const features = [
  {
    icon: "◉",
    title: "Lock-in scanner",
    desc: "Runs every file against signal detectors for proprietary deps, hardcoded creds, platform env vars, and auth entanglement. Outputs a severity-ranked report before you touch anything.",
  },
  {
    icon: "⟳",
    title: "Automated transforms",
    desc: "Strips lovable-tagger from vite.config, moves Supabase credentials to env vars, renames GPT_ENGINEER_* to VITE_*. Every change is explicit and reversible.",
  },
  {
    icon: "⬇",
    title: "Clean zip output",
    desc: "Downloads only the modified files. Drop them into your repo. Nothing is stored, logged, or phoned home. Your zip stays yours.",
  },
  {
    icon: "◇",
    title: "MIT, no account",
    desc: "Zero auth required. Fork it, self-host it, run it locally via CLI. The engine is TypeScript, the transforms are readable, the whole thing fits in one repo.",
  },
];

const scanLines = [
  { glyph: "✓", cls: "t-green",  parts: [{ t: "t-dim", v: "platform detected: " }, { t: "t-white", v: "lovable" }, { t: "t-dim", v: " (confidence: high)" }] },
  { glyph: "⚠", cls: "t-yellow", parts: [{ t: "t-dim", v: "lovable-tagger in " }, { t: "t-cyan", v: "vite.config.ts" }, { t: "t-dim", v: " — queued for removal" }] },
  { glyph: "✗", cls: "t-red",    parts: [{ t: "t-dim", v: "hardcoded URL in " }, { t: "t-cyan", v: "src/integrations/supabase/client.ts" }] },
  { glyph: "⚠", cls: "t-yellow", parts: [{ t: "t-cyan", v: ".env" }, { t: "t-dim", v: " — GPT_ENGINEER_* found, will rename" }] },
  { glyph: "▸", cls: "t-green",  parts: [{ t: "t-dim", v: "3 transforms ready · complexity: " }, { t: "t-white", v: "moderate" }] },
];

export default function Home() {
  return (
    <div className="page">
      {/* Nav */}
      <nav className="nav">
        <span className="logo">
          <span className="logo-dot" />
          migrare
        </span>
        <div className="nav-links">
          <Link to="/for-ai" className="nav-link">for agents</Link>
          <a
            href="https://github.com/dhaupin/migrare"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            GitHub
          </a>
          <Link to="/app" className="nav-cta">
            launch tool →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero hero-max fade-in">
        <div className="hero-eyebrow">
          <span className="badge badge-green">v0.0.1</span>
          <span className="t-muted">·</span>
          <span className="t-dim t-xs">Lovable support live</span>
          <span className="t-muted">·</span>
          <span className="t-dim t-xs">MIT open source</span>
        </div>

        <h1 className="hero-h1">
          You built it.
          <br />
          <span className="hero-h1-accent">Own the code.</span>
        </h1>

        <p className="hero-sub">
          migrare detects vendor lock-in in Lovable, Bolt, and Replit exports,
          then applies surgical transforms so you walk away with a clean, portable,
          self-hosted codebase. No black boxes. No subscriptions. Just your files.
        </p>

        <div className="hero-ctas">
          <Link to="/app" className="btn btn-primary btn-xl">
            ▸ run the migration tool
          </Link>
          <a
            href="https://github.com/dhaupin/migrare"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-xl"
          >
            view source
          </a>
        </div>

        {/* Terminal */}
        <div className="terminal" style={{ maxWidth: "620px", margin: "0 auto" }}>
          <div className="terminal-bar">
            <span className="terminal-dot" style={{ background: "#ff5f56" }} />
            <span className="terminal-dot" style={{ background: "#ffbd2e" }} />
            <span className="terminal-dot" style={{ background: "#27c93f" }} />
            <span className="terminal-title">migrare — scan report</span>
          </div>
          <div className="terminal-body">
            {scanLines.map((line, i) => (
              <div
                key={i}
                className="term-line fade-in"
                style={{ animationDelay: `${i * 90 + 200}ms` }}
              >
                <span className={line.cls} style={{ marginRight: "6px", flexShrink: 0 }}>
                  {line.glyph}
                </span>
                {line.parts.map((p, j) => (
                  <span key={j} className={p.t}>{p.v}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section content-max">
        <p className="section-label">what it does</p>
        <div className="feature-grid">
          {features.map((f, i) => (
            <div
              key={f.title}
              className="feature-card fade-in"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <span className="feature-icon">{f.icon}</span>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="section content-max">
        <p className="section-label">how it works</p>
        <div className="steps">
          {[
            ["01", "Export your project", "Download a ZIP from Lovable — or clone from GitHub and zip the repo. No special access needed."],
            ["02", "Drop it in the tool", "Upload at migrare.creadev.org/app. The scanner runs on Cloudflare's edge. Nothing is persisted."],
            ["03", "Read the scan report", "Every lock-in signal is listed by file, line, severity, and suggested fix. Review before committing to anything."],
            ["04", "Migrate and download", "Apply transforms in one click. Download a zip of only the changed files. Auditable, reversible, yours."],
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

      {/* Platform support */}
      <section className="section content-max">
        <p className="section-label">platform support</p>
        <div className="platform-grid">
          {platforms.map((p) => (
            <div key={p.name} className="platform-chip">
              <span
                className="status-dot"
                style={
                  p.status === "ready"
                    ? { background: "var(--green)", boxShadow: "0 0 6px var(--green)" }
                    : { background: "var(--text-muted)" }
                }
              />
              <span className="platform-chip-name">{p.name}</span>
              <span
                className="platform-chip-status"
                style={{ color: p.status === "ready" ? "var(--green)" : "var(--text-muted)" }}
              >
                {p.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA strip */}
      <section className="cta-strip">
        <p className="cta-strip-eyebrow">ready when you are</p>
        <h2 className="cta-strip-heading">
          Stop renting your own code.
        </h2>
        <p className="cta-strip-sub">
          Export your project, run the scanner, migrate in minutes.
          No account. No data retention. Just a clean repo.
        </p>
        <div className="cta-strip-actions">
          <Link to="/app" className="btn btn-primary btn-xl">
            ▸ open migration tool
          </Link>
          <a
            href="https://github.com/dhaupin/migrare"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-xl"
          >
            read the source
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <span className="footer-logo">migrare</span>
        <span className="footer-sep">·</span>
        <span className="t-muted t-xs">MIT license</span>
        <span className="footer-sep">·</span>
        <a
          href="https://github.com/dhaupin/migrare"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          github.com/dhaupin/migrare
        </a>
        <span className="footer-sep">·</span>
        <a
          href="https://creadev.org"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          creadev.org
        </a>
      </footer>
    </div>
  );
}
