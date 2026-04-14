import React, { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ width: 18, height: 18, fill: "currentColor", display: "block" }}>
    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
  </svg>
);

const API = "";

// ─── helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function downloadMigrationZip(result, originalName) {
  const zip = new JSZip();
  const name = originalName.replace(/\.zip$/i, "") + "-migrated";
  const folder = zip.folder(name);
  for (const { path, content } of result.files) folder.file(path, content);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name + ".zip"; a.click();
  URL.revokeObjectURL(url);
}

// ─── tooltip component ────────────────────────────────────────────────────────
// Uses fixed positioning computed from trigger bounds — avoids overflow clipping.
// Touch: tap to toggle, tap elsewhere to dismiss.

function Tip({ text }) {
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(false);
  const triggerRef = useRef();
  const contentRef = useRef();

  const position = () => {
    const t = triggerRef.current;
    const c = contentRef.current;
    if (!t || !c) return;
    const tr = t.getBoundingClientRect();
    const cw = c.offsetWidth || 260;
    const ch = c.offsetHeight || 60;
    const vw = window.innerWidth;
    const gap = 8;

    // Preferred: above trigger
    let top = tr.top - ch - gap;
    let below = false;
    if (top < 8) { top = tr.bottom + gap; below = true; }

    // Horizontal: center on trigger, clamp to viewport
    let left = tr.left + tr.width / 2 - cw / 2;
    left = Math.max(8, Math.min(left, vw - cw - 8));

    // Arrow offset relative to tooltip left
    const arrowX = tr.left + tr.width / 2 - left;
    let arrowCls = "";
    if (arrowX < 20) arrowCls = "arrow-left";
    else if (arrowX > cw - 20) arrowCls = "arrow-right";

    setPos({ top, left, below, arrowCls });
  };

  const show = () => { position(); setActive(true); };
  const hide = () => setActive(false);
  const toggle = (e) => { e.stopPropagation(); active ? hide() : show(); };

  useEffect(() => {
    if (!active) return;
    const close = () => hide();
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [active]);

  return (
    <span className={`tooltip ${active ? "active" : ""}`}>
      <span
        ref={triggerRef}
        className="tooltip-trigger"
        aria-label="help"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={toggle}
        onFocus={show}
        onBlur={hide}
        tabIndex={0}
      >?</span>
      <span
        ref={contentRef}
        className={[
          "tooltip-content",
          pos?.below ? "below" : "",
          pos?.arrowCls ?? "",
        ].filter(Boolean).join(" ")}
        style={pos ? { top: pos.top, left: pos.left, position: "fixed" } : undefined}
      >{text}</span>
    </span>
  );
}

// ─── spinner component ────────────────────────────────────────────────────────

function Spinner({ label, size = "" }) {
  return (
    <span className="spinner">
      <span className={`spinner-ring ${size ? "spinner-ring-" + size : ""}`} />
      {label && <span>{label}</span>}
    </span>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function Topbar({ serverOk }) {
  const dotCls = serverOk === null ? "" : serverOk ? "dot-online" : "dot-offline";
  const statusText = serverOk === null ? "connecting…" : serverOk ? "api ready" : "api offline";

  return (
    <div className="topbar">
      <Link to="/" className="logo">
        <span className="logo-dot" />
        migrare
      </Link>
      <div className="topbar-right">
        <span className="badge flex gap-2 items-center">
          <span className={`status-dot ${dotCls}`} />
          {statusText}
        </span>
        <Link to="/" className="nav-link">← home</Link>
        <a href="https://github.com/dhaupin/migrare" target="_blank" rel="noopener noreferrer" className="nav-icon" aria-label="GitHub repository"><GithubIcon /></a>
      </div>
    </div>
  );
}

function DropZone({ onFile, loadedFile }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".zip")) onFile(file);
  };

  return (
    <div
      className={["dropzone", dragOver && "drag-over", loadedFile && "loaded"].filter(Boolean).join(" ")}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
      role="button" tabIndex={0}
      onKeyDown={e => e.key === "Enter" && inputRef.current.click()}
      aria-label="Upload zip file"
    >
      {loadedFile ? (
        <>
          <span className="t-green" style={{ fontSize: 20 }}>✓</span>
          <span className="t-white" style={{ fontSize: 12 }}>{loadedFile.name}</span>
          <span className="t-muted t-xs">{(loadedFile.size / 1024).toFixed(1)} KB · tap to replace</span>
        </>
      ) : (
        <>
          <span className="t-muted" style={{ fontSize: 22 }}>⬇</span>
          <span className="t-dim" style={{ fontSize: 12 }}>Drop or tap to upload ZIP</span>
          <span className="t-muted t-xs">.zip exports from Lovable, Bolt, Replit</span>
        </>
      )}
      <input ref={inputRef} type="file" accept=".zip" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }} />
    </div>
  );
}

function ScanReport({ report }) {
  if (!report) return null;
  const sevGlyph = { error: "✗", warning: "⚠", info: "·" };
  const sevCls   = { error: "t-red", warning: "t-yellow", info: "t-cyan" };
  const complexCls = { straightforward: "badge-green", moderate: "badge-yellow", "requires-manual": "badge-red" };

  return (
    <div className="card fade-up">
      <div className="card-header">
        <span className="badge badge-green">{report.platform}</span>
        <span className={`badge ${complexCls[report.summary?.migrationComplexity] ?? ""}`}>
          {report.summary?.migrationComplexity}
        </span>
        <div className="stat-row">
          <span className="t-red">✗ {report.summary?.bySeverity?.error ?? 0}</span>
          <span className="t-yellow">⚠ {report.summary?.bySeverity?.warning ?? 0}</span>
          <span className="t-cyan">· {report.summary?.bySeverity?.info ?? 0}</span>
        </div>
      </div>

      {report.detectionSignals?.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center"
          style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <span className="t-label">via:</span>
          {report.detectionSignals.map(s => <span key={s} className="sig-tag">{s}</span>)}
        </div>
      )}

      <div style={{ padding: "8px 16px", display: "flex", flexDirection: "column" }}>
        {report.signals?.length === 0 && (
          <div className="log-line">
            <span className="log-glyph t-green">✓</span>
            <span className="log-text">No lock-in signals found — project looks portable</span>
          </div>
        )}
        {(report.signals ?? []).map(sig => (
          <div key={sig.id} className="signal-item">
            <span className={`signal-glyph ${sevCls[sig.severity]}`}>{sevGlyph[sig.severity]}</span>
            <div className="signal-body">
              <span className="signal-file">{sig.location?.file}{sig.location?.line ? `:${sig.location.line}` : ""}</span>
              <span className="signal-desc">{sig.description}</span>
              {sig.suggestion && <span className="signal-sug">→ {sig.suggestion}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MigrationResult({ result, onDownload }) {
  if (!result) return null;
  return (
    <div className="card fade-up">
      <div className="card-header">
        <span className="t-green t-sm">✓ migration complete</span>
        <span className="t-muted t-xs">{result.duration}ms</span>
        {result.dryRun && <span className="badge badge-yellow">preview only</span>}
      </div>
      {result.transformLog?.length > 0 && (
        <div className="card-body flex flex-col gap-2">
          <span className="t-label mb-2">transforms applied</span>
          {result.transformLog.map((entry, i) => (
            <div key={i} className="log-line">
              <span className="log-glyph t-green">▸</span>
              <span className="log-text">
                <span className="t-cyan">{entry.transform}</span>
                {" — "}
                <span className="t-dim">{entry.file}</span>
                {" "}
                <span className="t-muted">({entry.action})</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {result.files?.length > 0 && !result.dryRun && (
        <div className="card-body">
          <button className="btn btn-primary btn-block btn-center" onClick={onDownload}>
            ⬇ download migrated project ({result.files.length} files)
          </button>
        </div>
      )}
      {result.dryRun && (
        <div className="card-body">
          <div className="log-line">
            <span className="log-glyph t-yellow">◈</span>
            <span className="log-text">
              Preview only — transforms were computed but no files produced.
              Use "migrate" to get the downloadable output.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main ────────────────────────────────────────────────────────────────────

export default function MigrateApp() {
  const [serverOk, setServerOk]           = useState(null);
  const [loadedFile, setLoadedFile]       = useState(null);
  const [logs, setLogs]                   = useState([]);
  const [progress, setProgress]           = useState(null);
  const [scanReport, setScanReport]       = useState(null);
  const [migResult, setMigResult]         = useState(null);
  const [selectedTarget, setSelectedTarget] = useState("vite");
  const [scanning, setScanning]           = useState(false);
  const [migrating, setMigrating]         = useState(false);
  const [migMode, setMigMode]             = useState("migrate"); // "migrate" | "preview"

  const addLog = useCallback((type, msg) => {
    setLogs(prev => [...prev, { type, msg, ts: Date.now() }]);
  }, []);

  // Scroll panel to bottom whenever output changes
  const panelRef = useRef();
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    // Small rAF delay so DOM has painted the new content first
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [logs, scanReport, migResult, progress]);

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then(r => r.json())
      .then(d => setServerOk(d.ok === true))
      .catch(() => setServerOk(false));
  }, []);

  const handleFile = (file) => {
    setLoadedFile(file);
    setScanReport(null);
    setMigResult(null);
    setLogs([]);
    addLog("info", `Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  };

  const runScan = async () => {
    if (!loadedFile || scanning) return;
    setScanning(true); setScanReport(null); setMigResult(null);
    setProgress({ msg: "Reading zip…", pct: 10 });
    try {
      const b64 = await fileToBase64(loadedFile);
      setProgress({ msg: "Scanning for lock-in signals…", pct: 35 });
      const res = await fetch(`${API}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: { zip: b64, name: loadedFile.name } }),
      });
      setProgress({ msg: "Building report…", pct: 80 });
      const report = await res.json();
      if (report.error) throw new Error(report.error);
      setProgress({ msg: "Done", pct: 100 });
      await sleep(200);
      setScanReport(report);
      addLog("ok", `Scan complete — ${report.signals?.length ?? 0} signals, complexity: ${report.summary?.migrationComplexity}`);
    } catch (err) {
      addLog("error", "Scan failed: " + err.message);
    } finally {
      setProgress(null); setScanning(false);
    }
  };

  const runMigrate = async () => {
    if (!loadedFile || migrating) return;
    const dryRun = migMode === "preview";
    setMigrating(true); setMigResult(null);
    setProgress({ msg: "Reading zip…", pct: 10 });
    try {
      const b64 = await fileToBase64(loadedFile);
      setProgress({ msg: dryRun ? "Computing transforms…" : "Applying transforms…", pct: 45 });
      const res = await fetch(`${API}/api/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: { zip: b64, name: loadedFile.name }, dryRun, targetAdapter: selectedTarget }),
      });
      setProgress({ msg: "Finalizing…", pct: 85 });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setProgress({ msg: "Done", pct: 100 });
      await sleep(200);
      setMigResult(result);
      addLog("ok", dryRun
        ? `Preview complete — ${result.transformLog?.length ?? 0} transforms would apply`
        : `Migration complete — ${result.files?.length ?? 0} files changed`);
    } catch (err) {
      addLog("error", "Migration failed: " + err.message);
    } finally {
      setProgress(null); setMigrating(false);
    }
  };

  const handleDownload = async () => {
    if (!migResult?.files?.length) return;
    try {
      await downloadMigrationZip(migResult, loadedFile.name);
      addLog("ok", "Download started");
    } catch (err) {
      addLog("error", "Download failed: " + err.message);
    }
  };

  const busy = scanning || migrating;
  const hasProject = !!loadedFile;

  return (
    <div className="app-shell">
      <Topbar serverOk={serverOk} />

      <div className="app-body">

        {/* ── sidebar ── */}
        <aside className="sidebar">

          {/* source */}
          <div className="flex items-center gap-2 mb-2">
            <span className="section-label" style={{ marginBottom: 0, flex: 1 }}>source</span>
            <Tip
              text="Export your project as a ZIP from Lovable (or zip a GitHub clone). Drop it here."
              
            />
          </div>
          <DropZone onFile={handleFile} loadedFile={loadedFile} />

          {/* target */}
          <div className="flex items-center gap-2 mt-4 mb-2">
            <span className="section-label" style={{ marginBottom: 0, flex: 1 }}>output format</span>
            <Tip
              text="Vite + React is framework-agnostic. Next.js uses App Router conventions."
              
            />
          </div>
          {[
            { id: "vite",   label: "Vite + React",  desc: "Recommended" },
            { id: "nextjs", label: "Next.js",        desc: "App Router" },
          ].map(t => (
            <div
              key={t.id}
              className={`target-option ${selectedTarget === t.id ? "active" : ""}`}
              onClick={() => setSelectedTarget(t.id)}
              role="radio" aria-checked={selectedTarget === t.id}
              tabIndex={0} onKeyDown={e => e.key === "Enter" && setSelectedTarget(t.id)}
            >
              <span className={selectedTarget === t.id ? "t-green" : "t-muted"}>
                {selectedTarget === t.id ? "◉" : "○"}
              </span>
              <div>
                <div className="t-white" style={{ fontSize: 12 }}>{t.label}</div>
                <div className="t-muted t-xs">{t.desc}</div>
              </div>
            </div>
          ))}

          {/* actions */}
          <div className="flex flex-col gap-2 mt-4">
            {/* scan */}
            <div className="flex items-center gap-2">
              <button
                className="btn btn-ghost btn-block"
                disabled={!hasProject || busy}
                onClick={runScan}
              >
                {scanning ? <Spinner label="scanning…" /> : "◉ scan"}
              </button>
              <Tip
                text="Read-only. Detects lock-in signals without changing anything. Run this first to understand what's there."
                
              />
            </div>

            {/* migrate mode toggle + button */}
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1" style={{ flex: 1 }}>
                {/* toggle row */}
                <div className="flex gap-1">
                  {[
                    { id: "migrate", label: "migrate" },
                    { id: "preview", label: "preview" },
                  ].map(m => (
                    <button
                      key={m.id}
                      className={`btn btn-xs ${migMode === m.id ? "btn-ghost" : "btn-outline"}`}
                      style={{
                        flex: 1,
                        justifyContent: "center",
                        borderColor: migMode === m.id ? "var(--accent-dim)" : undefined,
                        color: migMode === m.id ? "var(--accent)" : undefined,
                      }}
                      onClick={() => setMigMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-primary btn-block btn-center"
                  disabled={!hasProject || busy}
                  onClick={runMigrate}
                >
                  {migrating
                    ? <Spinner label={migMode === "preview" ? "computing…" : "migrating…"} />
                    : migMode === "preview"
                    ? "◈ preview transforms"
                    : "▸ migrate project"}
                </button>
              </div>
              <Tip
                text={
                  migMode === "preview"
                    ? "Preview runs all transforms internally and shows what would change — but produces no downloadable output."
                    : "Applies all transforms and produces a downloadable ZIP of only the changed files."
                }
                
              />
            </div>
          </div>
        </aside>

        {/* ── main panel ── */}
        <main className="panel-main" ref={panelRef}>
          {progress && (
            <div className="progress fade-up">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
              </div>
              <span className="progress-label">{progress.msg}</span>
            </div>
          )}

          {!scanReport && !migResult && logs.length === 0 && !progress && (
            <div className="empty-state">
              <span className="empty-icon">◎</span>
              <span className="empty-title">Ready when you are</span>
              <span className="empty-desc">
                Upload a ZIP, scan it to see what lock-in exists, then migrate when you're ready.
              </span>
            </div>
          )}

          {logs.map(log => (
            <div key={log.ts} className="log-line">
              <span className={`log-glyph ${log.type === "ok" ? "t-green" : log.type === "error" ? "t-red" : "t-dim"}`}>
                {log.type === "ok" ? "✓" : log.type === "error" ? "✗" : "·"}
              </span>
              <span className="log-text">{log.msg}</span>
            </div>
          ))}

          <ScanReport report={scanReport} />
          <MigrationResult result={migResult} onDownload={handleDownload} />
        </main>

        {/* ── right sidebar ── */}
        <aside className="sidebar-right">
          <div className="flex items-center gap-2 mb-3">
            <span className="section-label" style={{ marginBottom: 0, flex: 1 }}>guide</span>
          </div>

          <div className="help-block">
            <p className="help-text">
              <strong>Scan</strong> is always read-only. No files change. Use it to understand
              what lock-in exists before deciding whether to migrate.
            </p>
            <p className="help-text">
              <strong>Preview</strong> runs transforms internally and shows the change log —
              no output is produced. Use it to verify the plan before committing.
            </p>
            <p className="help-text">
              <strong>Migrate</strong> applies everything and produces a ZIP of only the
              modified files. Review the diff before merging into your repo.
            </p>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className="section-label" style={{ marginBottom: 0, flex: 1 }}>transforms</span>
          </div>

          <div className="flex flex-col gap-2">
            {[
              ["remove-lovable-tagger",    "Strips build dep + vite.config call"],
              ["abstract-supabase-client", "Moves credentials to env vars"],
              ["remove-env-bleed",         "Renames GPT_ENGINEER_* → VITE_*"],
            ].map(([id, desc]) => (
              <div key={id} className="transform-item">
                <div className="t-green t-xs">◈ {id}</div>
                <div className="t-muted t-xs mt-1">{desc}</div>
              </div>
            ))}
          </div>
        </aside>

      </div>
    </div>
  );
}
