import React from "react";
import { Link } from "react-router-dom";

const platforms = [
  { name: "Lovable", status: "ready", color: "#ff6b9d" },
  { name: "Bolt.new", status: "coming soon", color: "#7c3aed" },
  { name: "Replit", status: "coming soon", color: "#f97316" },
  { name: "v0 / Vercel", status: "coming soon", color: "#0ea5e9" },
];

const features = [
  {
    icon: "◉",
    title: "Scan for lock-in",
    desc: "Detects hardcoded credentials, proprietary build tools, platform-specific env vars, and auth entanglement before you migrate.",
  },
  {
    icon: "◈",
    title: "Automated transforms",
    desc: "Removes lovable-tagger, abstracts Supabase credentials to env vars, cleans GPT_ENGINEER_* pollution. All diffs are auditable.",
  },
  {
    icon: "▸",
    title: "Download clean output",
    desc: "Get a zip of your migrated project with only the modified files. Drop it into your own repo. No accounts, no subscriptions.",
  },
  {
    icon: "◇",
    title: "Open source, MIT",
    desc: "The whole thing is on GitHub. Run it locally with the CLI, self-host the web UI, or use the hosted version at migrare.creadev.org.",
  },
];

export default function Home() {
  return (
    <div style={styles.page}>
      {/* Nav */}
      <nav style={styles.nav}>
        <span style={styles.logo}>
          <span style={styles.logoDot} />
          migrare
        </span>
        <div style={styles.navLinks}>
          <a
            href="https://github.com/dhaupin/migrare"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.navLink}
          >
            GitHub
          </a>
          <Link to="/app" style={styles.navCta}>
            open tool &rarr;
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={styles.hero}>
        <div style={styles.heroEyebrow}>
          <span style={styles.badge}>v0.0.1 — alpha</span>
          <span style={styles.badgeSep}>·</span>
          <span style={styles.badgeText}>Lovable support live</span>
        </div>

        <h1 style={styles.h1}>
          Your vibe-coded app.{" "}
          <span style={styles.h1Green}>Your codebase.</span>
        </h1>

        <p style={styles.heroDesc}>
          migrare scans projects from Lovable, Bolt, and Replit for vendor lock-in,
          then applies automated transforms to give you clean, portable, self-owned code.
          No black boxes. No recurring fees. Just your files.
        </p>

        <div style={styles.heroCtas}>
          <Link to="/app" style={styles.ctaPrimary}>
            ▸ try the migration tool
          </Link>
          <a
            href="https://github.com/dhaupin/migrare"
            target="_blank"
            rel="noopener noreferrer"
            style={styles.ctaSecondary}
          >
            view on GitHub
          </a>
        </div>

        {/* Terminal preview */}
        <div style={styles.terminal}>
          <div style={styles.terminalBar}>
            <span style={{ ...styles.dot, background: "#ff5f56" }} />
            <span style={{ ...styles.dot, background: "#ffbd2e" }} />
            <span style={{ ...styles.dot, background: "#27c93f" }} />
            <span style={styles.terminalTitle}>migrare — scan report</span>
          </div>
          <div style={styles.terminalBody}>
            <div style={styles.termLine}>
              <span style={styles.termGreen}>✓</span>
              <span style={styles.termDim}> platform detected: </span>
              <span style={styles.termWhite}>lovable</span>
              <span style={styles.termDim}> (confidence: high)</span>
            </div>
            <div style={styles.termLine}>
              <span style={styles.termYellow}>⚠</span>
              <span style={styles.termDim}> lovable-tagger in </span>
              <span style={styles.termCyan}>vite.config.ts</span>
              <span style={styles.termDim}> — will be removed</span>
            </div>
            <div style={styles.termLine}>
              <span style={styles.termRed}>✗</span>
              <span style={styles.termDim}> hardcoded Supabase URL in </span>
              <span style={styles.termCyan}>src/integrations/supabase/client.ts</span>
            </div>
            <div style={styles.termLine}>
              <span style={styles.termYellow}>⚠</span>
              <span style={styles.termDim}> GPT_ENGINEER_* env vars in </span>
              <span style={styles.termCyan}>.env</span>
              <span style={styles.termDim}> — will be renamed</span>
            </div>
            <div style={{ ...styles.termLine, marginTop: "12px" }}>
              <span style={styles.termGreen}>▸</span>
              <span style={styles.termDim}> 3 transforms ready · complexity: </span>
              <span style={styles.termWhite}>moderate</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>what it does</p>
        <div style={styles.featureGrid}>
          {features.map((f) => (
            <div key={f.title} style={styles.featureCard}>
              <span style={styles.featureIcon}>{f.icon}</span>
              <h3 style={styles.featureTitle}>{f.title}</h3>
              <p style={styles.featureDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Platform support */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>platform support</p>
        <div style={styles.platformGrid}>
          {platforms.map((p) => (
            <div key={p.name} style={styles.platformCard}>
              <span
                style={{
                  ...styles.platformDot,
                  background: p.status === "ready" ? "var(--green)" : "var(--text-muted)",
                  boxShadow:
                    p.status === "ready"
                      ? "0 0 6px var(--green)"
                      : "none",
                }}
              />
              <span style={styles.platformName}>{p.name}</span>
              <span
                style={{
                  ...styles.platformStatus,
                  color: p.status === "ready" ? "var(--green)" : "var(--text-muted)",
                }}
              >
                {p.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>how it works</p>
        <div style={styles.steps}>
          {[
            ["01", "Export your project", "Download a ZIP from Lovable (or clone from GitHub). No special access needed — just the files."],
            ["02", "Drop it in the tool", "Upload the ZIP at migrare.creadev.org/app. The scanner runs entirely on Cloudflare's edge."],
            ["03", "Review the report", "See exactly what lock-in was found — which files, which lines, and why each one matters."],
            ["04", "Migrate and download", "Apply transforms and download a clean ZIP with only the changed files. Fully auditable diffs."],
          ].map(([num, title, desc]) => (
            <div key={num} style={styles.step}>
              <span style={styles.stepNum}>{num}</span>
              <div>
                <div style={styles.stepTitle}>{title}</div>
                <div style={styles.stepDesc}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA strip */}
      <section style={styles.ctaStrip}>
        <p style={styles.ctaStripText}>
          Ready to own your codebase?
        </p>
        <Link to="/app" style={styles.ctaPrimary}>
          ▸ open migration tool
        </Link>
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <span style={styles.footerLogo}>migrare</span>
        <span style={styles.footerSep}>·</span>
        <span style={styles.footerDim}>MIT License</span>
        <span style={styles.footerSep}>·</span>
        <a
          href="https://github.com/dhaupin/migrare"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.footerLink}
        >
          github.com/dhaupin/migrare
        </a>
        <span style={styles.footerSep}>·</span>
        <a
          href="https://creadev.org"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.footerLink}
        >
          creadev.org
        </a>
      </footer>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    fontFamily: "var(--mono)",
  },

  // Nav
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 2rem",
    height: "52px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-1)",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "15px",
    fontWeight: 500,
    color: "var(--green)",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  logoDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: "var(--green)",
    boxShadow: "0 0 8px var(--green)",
    animation: "pulse 2s ease-in-out infinite",
  },
  navLinks: {
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
  },
  navLink: {
    color: "var(--text-dim)",
    fontSize: "12px",
    letterSpacing: "0.05em",
    textDecoration: "none",
  },
  navCta: {
    color: "var(--green)",
    fontSize: "12px",
    letterSpacing: "0.05em",
    padding: "5px 12px",
    border: "1px solid var(--green-dim)",
    borderRadius: "var(--radius)",
    textDecoration: "none",
    transition: "background 0.15s",
  },

  // Hero
  hero: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "5rem 2rem 4rem",
    textAlign: "center",
  },
  heroEyebrow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.6rem",
    marginBottom: "2rem",
  },
  badge: {
    fontSize: "11px",
    padding: "3px 10px",
    border: "1px solid var(--border-hi)",
    color: "var(--green)",
    borderRadius: "var(--radius)",
    letterSpacing: "0.08em",
  },
  badgeSep: { color: "var(--text-muted)" },
  badgeText: { color: "var(--text-dim)", fontSize: "11px" },

  h1: {
    fontFamily: "var(--sans)",
    fontSize: "clamp(1.8rem, 5vw, 2.8rem)",
    fontWeight: 600,
    color: "var(--text)",
    lineHeight: 1.25,
    marginBottom: "1.5rem",
    letterSpacing: "-0.01em",
  },
  h1Green: { color: "var(--green)" },

  heroDesc: {
    fontFamily: "var(--sans)",
    fontSize: "16px",
    color: "var(--text-dim)",
    lineHeight: 1.7,
    maxWidth: "560px",
    margin: "0 auto 2.5rem",
  },

  heroCtas: {
    display: "flex",
    gap: "1rem",
    justifyContent: "center",
    flexWrap: "wrap",
    marginBottom: "3rem",
  },
  ctaPrimary: {
    background: "var(--green)",
    color: "#000",
    padding: "10px 24px",
    borderRadius: "var(--radius)",
    fontFamily: "var(--mono)",
    fontSize: "13px",
    fontWeight: 500,
    letterSpacing: "0.05em",
    textDecoration: "none",
    transition: "opacity 0.15s",
  },
  ctaSecondary: {
    border: "1px solid var(--border-hi)",
    color: "var(--text-dim)",
    padding: "10px 24px",
    borderRadius: "var(--radius)",
    fontFamily: "var(--mono)",
    fontSize: "13px",
    letterSpacing: "0.05em",
    textDecoration: "none",
  },

  // Terminal mock
  terminal: {
    background: "var(--bg-1)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    textAlign: "left",
    overflow: "hidden",
    maxWidth: "640px",
    margin: "0 auto",
  },
  terminalBar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-2)",
  },
  dot: { width: "10px", height: "10px", borderRadius: "50%", display: "inline-block" },
  terminalTitle: { marginLeft: "8px", fontSize: "11px", color: "var(--text-muted)", letterSpacing: "0.05em" },
  terminalBody: { padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "4px" },
  termLine: { fontSize: "12px", display: "flex", flexWrap: "wrap", gap: "0" },
  termGreen: { color: "var(--green)" },
  termYellow: { color: "var(--yellow)" },
  termRed: { color: "var(--red)" },
  termDim: { color: "var(--text-dim)" },
  termWhite: { color: "var(--text)" },
  termCyan: { color: "var(--cyan)" },

  // Sections
  section: {
    maxWidth: "900px",
    margin: "0 auto",
    padding: "3rem 2rem",
    borderTop: "1px solid var(--border)",
    width: "100%",
  },
  sectionLabel: {
    fontSize: "10px",
    letterSpacing: "0.14em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: "2rem",
  },

  // Features
  featureGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1.5rem",
  },
  featureCard: {
    background: "var(--bg-1)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  featureIcon: { fontSize: "16px", color: "var(--green)" },
  featureTitle: {
    fontFamily: "var(--sans)",
    fontSize: "14px",
    fontWeight: 500,
    color: "var(--text)",
  },
  featureDesc: {
    fontFamily: "var(--sans)",
    fontSize: "13px",
    color: "var(--text-dim)",
    lineHeight: 1.6,
  },

  // Platforms
  platformGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.75rem",
  },
  platformCard: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    background: "var(--bg-1)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "0.6rem 1rem",
  },
  platformDot: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0 },
  platformName: { color: "var(--text)", fontSize: "13px" },
  platformStatus: { fontSize: "10px", letterSpacing: "0.06em" },

  // How it works
  steps: { display: "flex", flexDirection: "column", gap: "1.5rem" },
  step: { display: "flex", gap: "1.25rem", alignItems: "flex-start" },
  stepNum: {
    color: "var(--text-muted)",
    fontSize: "10px",
    letterSpacing: "0.1em",
    minWidth: "28px",
    paddingTop: "2px",
  },
  stepTitle: {
    color: "var(--text)",
    fontFamily: "var(--sans)",
    fontSize: "14px",
    fontWeight: 500,
    marginBottom: "4px",
  },
  stepDesc: {
    color: "var(--text-dim)",
    fontFamily: "var(--sans)",
    fontSize: "13px",
    lineHeight: 1.6,
  },

  // CTA strip
  ctaStrip: {
    borderTop: "1px solid var(--border)",
    padding: "3rem 2rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "2rem",
    flexWrap: "wrap",
  },
  ctaStripText: {
    fontFamily: "var(--sans)",
    fontSize: "18px",
    color: "var(--text)",
  },

  // Footer
  footer: {
    marginTop: "auto",
    borderTop: "1px solid var(--border)",
    padding: "1.25rem 2rem",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.75rem",
    fontSize: "11px",
    background: "var(--bg-1)",
  },
  footerLogo: { color: "var(--green)", letterSpacing: "0.1em", textTransform: "uppercase" },
  footerSep: { color: "var(--text-muted)" },
  footerDim: { color: "var(--text-muted)" },
  footerLink: { color: "var(--text-dim)", textDecoration: "none" },
};
