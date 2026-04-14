import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ width: 18, height: 18, fill: "currentColor", display: "block" }}>
    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
  </svg>
);

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
  { glyph: "✓", cls: "t-green",  text: ["t-dim:platform detected: ", "t-white:lovable", "t-dim: (confidence: high)"] },
  { glyph: "⚠", cls: "t-yellow", text: ["t-dim:lovable-tagger in ", "t-cyan:vite.config.ts", "t-dim: — queued for removal"] },
  { glyph: "✗", cls: "t-red",    text: ["t-dim:hardcoded URL in ", "t-cyan:src/integrations/supabase/client.ts"] },
  { glyph: "⚠", cls: "t-yellow", text: ["t-cyan:.env", "t-dim: — GPT_ENGINEER_* found, will rename"] },
  { glyph: "▸", cls: "t-green",  text: ["t-dim:3 transforms ready · complexity: ", "t-white:moderate"] },
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
          <Link to="/app" className="nav-cta">
            launch tool →
          </Link>
          <a href="https://github.com/dhaupin/migrare" target="_blank" rel="noopener noreferrer" className="nav-icon" aria-label="GitHub repository"><GithubIcon /></a>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero hero-max fade-in">
        <div className="hero-eyebrow">
          <span className="badge badge-green">v0.1.0</span>
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

        {/* Scan output block — not a macOS window */}
        <div className="scan-output" style={{ maxWidth: "620px", margin: "0 auto" }}>
          <div className="scan-output-header">
            <span className="t-muted t-xs">$ migrare scan my-app.zip</span>
          </div>
          <div className="scan-output-body">
            {scanLines.map((line, i) => (
              <div
                key={i}
                className="term-line fade-in"
                style={{ animationDelay: `${i * 90 + 200}ms` }}
              >
                <span className={line.cls} style={{ marginRight: "8px", flexShrink: 0, minWidth: "12px" }}>
                  {line.glyph}
                </span>
                {line.text.map((part, j) => {
                  const [cls, ...rest] = part.split(":");
                  return <span key={j} className={cls}>{rest.join(":")}</span>;
                })}
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
                    ? { background: "var(--accent)", boxShadow: "0 0 6px var(--accent)" }
                    : { background: "var(--text-muted)" }
                }
              />
              <span className="platform-chip-name">{p.name}</span>
              <span
                className="platform-chip-status"
                style={{ color: p.status === "ready" ? "var(--accent)" : "var(--text-muted)" }}
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
