import React from "react";
import { Link } from "react-router-dom";

const scanShape = `{
  platform:         "lovable" | "unknown",
  confidence:       "high" | "medium" | "low",
  fileCount:        number,
  detectionSignals: string[],
  signals: [
    {
      id:          string,
      platform:    string,
      category:    "build-config" | "state-entanglement"
                 | "auth-coupling" | "environment-bleed"
                 | "proprietary-api",
      severity:   "error" | "warning" | "info",
      confidence: "high" | "medium" | "low",
      location:   { file: string, line?: number },
      description: string,
      suggestion:  string
    }
  ],
  summary: {
    bySeverity:          { error: number, warning: number, info: number },
    byCategory:          Record<string, number>,
    migrationComplexity: "straightforward" | "moderate" | "requires-manual",
    totalSignals:        number
  }
}`;

const migrateShape = `{
  platform:     string,
  confidence:   string,
  dryRun:       boolean,
  duration:     number,          // ms
  signals:      Signal[],        // same as /api/scan
  summary:      Summary,
  transformLog: [
    {
      transform: string,         // e.g. "remove-lovable-tagger"
      file:      string,
      action:    "modified" | "created" | "deleted",
      meta?:     Record<string, unknown>
    }
  ],
  files: [
    { path: string, content: string }  // only modified files
  ],
  errors: string[]
}`;

const specLink = "/api/spec";

const agentPatterns = [
  {
    title: "Pre-edit context",
    when: "Before touching any files in a Lovable repo.",
    how: "Call /api/scan with the project zip. Feed the signal list into your context. You now know exactly which files have lock-in, what kind, and where — before writing a single line.",
    safe: true,
  },
  {
    title: "Structured diff input",
    when: "You want pre-computed transforms rather than deriving them yourself.",
    how: "Call /api/migrate with dryRun: false. Get back {files: [{path, content}]}. Treat each entry as a suggested diff. Review, then write via your own file tools.",
    safe: true,
  },
  {
    title: "Autonomous apply",
    when: "Calling /api/migrate and writing output directly to disk without a human checkpoint.",
    how: "Don't. The scan report is designed to inform a decision, not automate one. Migrate outputs a diff, not a commit.",
    safe: false,
  },
];

export default function ForAI() {
  return (
    <div className="page">
      {/* Nav */}
      <nav className="nav">
        <Link to="/" className="logo">
          <span className="logo-dot" />
          migrare
        </Link>
        <div className="nav-links">
          <Link to="/" className="nav-link">home</Link>
          <a
            href="https://github.com/dhaupin/migrare"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-link"
          >
            GitHub
          </a>
          <Link to="/app" className="nav-cta">launch tool →</Link>
        </div>
      </nav>

      {/* Header */}
      <section className="hero hero-max" style={{ paddingBottom: "var(--sp-10)" }}>
        <div className="hero-eyebrow">
          <span className="badge">for agents</span>
          <span className="t-muted">·</span>
          <span className="t-dim t-xs">JSON API · no auth · stateless</span>
        </div>
        <h1 className="hero-h1" style={{ fontSize: "var(--text-2xl)" }}>
          migrare for AI agents
        </h1>
        <p className="hero-sub" style={{ fontSize: "var(--text-md)" }}>
          The migration API is plain JSON over HTTP. No SDK, no auth, no session.
          An agent can call <code>/api/scan</code> with a base64 zip and get back
          a structured lock-in report in one round trip.
        </p>
      </section>

      {/* What's actually useful */}
      <section className="section content-max">
        <p className="section-label">how agents use this</p>
        <div className="flex flex-col gap-3">
          {agentPatterns.map((p) => (
            <div
              key={p.title}
              className="card"
              style={{
                borderColor: p.safe ? "var(--border)" : "rgba(255,82,82,0.25)",
              }}
            >
              <div className="card-header">
                <span
                  className={`badge ${p.safe ? "badge-green" : "badge-red"}`}
                >
                  {p.safe ? "✓ safe" : "✗ avoid"}
                </span>
                <span className="t-white t-md" style={{ fontFamily: "var(--sans)", fontWeight: 500 }}>
                  {p.title}
                </span>
              </div>
              <div className="card-body flex flex-col gap-2">
                <div className="flex gap-2 items-start">
                  <span className="t-muted t-xs t-upper t-track" style={{ minWidth: "36px", paddingTop: "2px" }}>when</span>
                  <span className="help-text" style={{ margin: 0 }}>{p.when}</span>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="t-muted t-xs t-upper t-track" style={{ minWidth: "36px", paddingTop: "2px" }}>how</span>
                  <span className="help-text" style={{ margin: 0 }}>{p.how}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Scan endpoint */}
      <section className="section content-max">
        <p className="section-label">POST /api/scan</p>
        <div className="help-block">
          <p className="help-text">
            Send a base64-encoded zip. Get back a structured scan report.
            Read-only — nothing is stored, no side effects.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="code-block">
            <p className="code-block-label">request body</p>
            <pre><code>{`{
  source: {
    zip:  string,   // base64-encoded .zip bytes
    name: string    // filename, e.g. "my-app.zip"
  }
}`}</code></pre>
          </div>

          <div className="code-block">
            <p className="code-block-label">response shape</p>
            <pre><code>{scanShape}</code></pre>
          </div>

          <div className="code-block">
            <p className="code-block-label">pseudo-code pattern</p>
            <pre><code>{`// read zip into base64
const zip = fs.readFileSync("my-app.zip");
const b64 = zip.toString("base64");

// call scan
const res = await fetch("https://migrare.creadev.org/api/scan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ source: { zip: b64, name: "my-app.zip" } }),
});

const report = await res.json();

// use signal list as context before editing
for (const signal of report.signals) {
  console.log(signal.severity, signal.location.file, signal.description);
}`}</code></pre>
          </div>
        </div>
      </section>

      {/* Migrate endpoint */}
      <section className="section content-max">
        <p className="section-label">POST /api/migrate</p>
        <div className="help-block">
          <p className="help-text">
            Applies transforms and returns the modified files as <code>{"{path, content}"}</code> pairs.
            Treat the output as a <strong>diff to review</strong>, not a blind write.
            Use <code>dryRun: true</code> to see what would change without committing to it.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="code-block">
            <p className="code-block-label">request body</p>
            <pre><code>{`{
  source: {
    zip:  string,   // base64-encoded .zip bytes
    name: string
  },
  dryRun?:       boolean,  // default false — true returns log without file content
  targetAdapter?: "vite" | "nextjs"
}`}</code></pre>
          </div>

          <div className="code-block">
            <p className="code-block-label">response shape</p>
            <pre><code>{migrateShape}</code></pre>
          </div>

          <div className="code-block">
            <p className="code-block-label">recommended agent pattern</p>
            <pre><code>{`// 1. scan first — understand what you're dealing with
const scan = await callScan(zip);
if (scan.summary.migrationComplexity === "requires-manual") {
  // surface to human before proceeding
}

// 2. dry run — confirm transforms match expectations
const dry = await callMigrate(zip, { dryRun: true });
// show transformLog to human or include in context

// 3. apply — get file diffs
const result = await callMigrate(zip, { dryRun: false });

// 4. write via your own tools — don't blind-apply
for (const file of result.files) {
  // review diff, then write
  await myFileTools.write(file.path, file.content);
}

// 5. human checkpoint before commit`}</code></pre>
          </div>
        </div>
      </section>

      {/* API spec */}
      <section className="section content-max">
        <p className="section-label">machine-readable spec</p>
        <div className="help-block">
          <p className="help-text">
            <a href={specLink} target="_blank" rel="noopener noreferrer">
              GET /api/spec
            </a>{" "}
            returns a JSON document describing all endpoints, their request shapes,
            and response shapes. Stable across patch versions.
          </p>
        </div>
        <pre><code>{`fetch("https://migrare.creadev.org/api/spec")
  .then(r => r.json())
  .then(spec => { /* endpoints, shapes, version */ })`}</code></pre>
      </section>

      {/* llms.txt */}
      <section className="section content-max">
        <p className="section-label">llms.txt</p>
        <div className="help-block">
          <p className="help-text">
            <a href="/llms.txt" target="_blank" rel="noopener noreferrer">/llms.txt</a>{" "}
            is a plain-text summary of what migrare is and how to use its API —
            following the emerging{" "}
            <a
              href="https://llmstxt.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              llms.txt convention
            </a>
            . Fetch it at the start of a session to give an agent instant context
            without reading the full docs.
          </p>
        </div>
        <pre><code>{`fetch("https://migrare.creadev.org/llms.txt")
  .then(r => r.text())
  .then(ctx => {
    // prepend to system prompt or tool description
  })`}</code></pre>
      </section>

      {/* honest notes */}
      <section className="section content-max">
        <p className="section-label">honest notes</p>
        <div className="flex flex-col gap-3">
          {[
            ["Zip size", "The edge function handles typical Lovable exports (< 5 MB unzipped) comfortably. Very large monorepos may hit Workers CPU limits. Run the CLI locally for those."],
            ["Stateless", "Nothing is persisted between calls. Every request is independent. There is no session, no job ID, no polling — scan and migrate are synchronous and return immediately."],
            ["No auth", "The API is open. Rate limiting is handled by Cloudflare at the edge. If you're calling this in a tight loop from automation, add a pause between requests."],
            ["Transforms are surgical", "The engine only touches files it has explicit transforms for. It does not rewrite your whole app. Unknown patterns are flagged as signals, not auto-fixed."],
            ["Migrate ≠ commit", "The files array is a suggested diff. migrare has no access to your repo, no git integration, and no ability to commit anything. That step is always yours."],
          ].map(([title, desc]) => (
            <div key={title} className="flex gap-3 items-start" style={{ padding: "var(--sp-3) 0", borderBottom: "1px solid var(--border)" }}>
              <span className="t-green t-xs t-upper t-track" style={{ minWidth: "100px", paddingTop: "2px", flexShrink: 0 }}>
                {title}
              </span>
              <span className="help-text" style={{ margin: 0 }}>{desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <span className="footer-logo">migrare</span>
        <span className="footer-sep">·</span>
        <span className="t-muted t-xs">MIT license</span>
        <span className="footer-sep">·</span>
        <a href="https://github.com/dhaupin/migrare" target="_blank" rel="noopener noreferrer" className="footer-link">
          github.com/dhaupin/migrare
        </a>
        <span className="footer-sep">·</span>
        <a href="https://creadev.org" target="_blank" rel="noopener noreferrer" className="footer-link">
          creadev.org
        </a>
      </footer>
    </div>
  );
}
