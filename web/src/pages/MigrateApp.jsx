import React, { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";

const API = "";

// ─── helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  const folderName = originalName.replace(/\.zip$/i, "") + "-migrated";
  const folder = zip.folder(folderName);
  for (const { path, content } of result.files) folder.file(path, content);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = folderName + ".zip";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── sub-components ──────────────────────────────────────────────────────────

function Topbar({ serverOk }) {
  const statusCls = serverOk === null ? "" : serverOk ? "badge-green" : "badge-red";
  const statusText = serverOk === null ? "connecting…" : serverOk ? "● api ready" : "○ api offline";

  return (
    <div className="topbar">
      <Link to="/" className="logo">
        <span className="logo-dot" />
        migrare
      </Link>
      <span className="t-muted t-xs" style={{ fontFamily: "var(--sans)" }}>
        escape vendor lock-in
      </span>
      <div className="topbar-right">
        <span className={`badge ${statusCls}`}>{statusText}</span>
        <Link to="/" className="nav-link">← home</Link>
        <a
          href="https://github.com/dhaupin/migrare"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-link"
        >
          GitHub ↗
        </a>
      </div>
    </div>
  );
}

function DropZone({ onFile, loadedFile }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".zip")) onFile(file);
  };

  const zoneCls = [
    "dropzone",
    dragOver ? "drag-over" : "",
    loadedFile ? "loaded" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={zoneCls}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current.click()}
      aria-label="Upload zip file"
    >
      {loadedFile ? (
        <>
          <span className="t-green" style={{ fontSize: "20px" }}>✓</span>
          <span className="t-white" style={{ fontSize: "12px" }}>{loadedFile.name}</span>
          <span className="t-muted t-xs">
            {(loadedFile.size / 1024).toFixed(1)} KB · click to replace
          </span>
        </>
      ) : (
        <>
          <span className="t-muted" style={{ fontSize: "22px" }}>⬇</span>
          <span className="t-dim" style={{ fontSize: "12px" }}>Drop ZIP export</span>
          <span className="t-muted t-xs">click to browse · .zip only</span>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); }}
      />
    </div>
  );
}

function ScanReport({ report }) {
  if (!report) return null;

  const sevGlyph = { error: "✗", warning: "⚠", info: "·" };
  const sevCls   = { error: "t-red", warning: "t-yellow", info: "t-cyan" };
  const complexCls = {
    straightforward: "badge-green",
    moderate: "badge-yellow",
    "requires-manual": "badge-red",
  };

  return (
    <div className="card fade-in">
      <div className="card-header">
        <span className="badge badge-green">{report.platform}</span>
        <span className={`badge ${complexCls[report.summary?.migrationComplexity] ?? ""}`}>
          {report.summary?.migrationComplexity}
        </span>
        <div className="stat-row">
          <span className="t-red t-sm">✗ {report.summary?.bySeverity?.error ?? 0}</span>
          <span className="t-yellow t-sm">⚠ {report.summary?.bySeverity?.warning ?? 0}</span>
          <span className="t-cyan t-sm">· {report.summary?.bySeverity?.info ?? 0}</span>
        </div>
      </div>

      {report.detectionSignals?.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center" style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-1)" }}>
          <span className="t-label">via:</span>
          {report.detectionSignals.map((sig) => (
            <span key={sig} className="sig-tag">{sig}</span>
          ))}
        </div>
      )}

      <div className="card-body" style={{ display: "flex", flexDirection: "column", padding: "8px 16px" }}>
        {report.signals?.length === 0 && (
          <div className="log-line">
            <span className="log-glyph t-green">✓</span>
            <span className="log-text">No lock-in signals detected — project looks portable</span>
          </div>
        )}
        {(report.signals ?? []).map((sig) => (
          <div key={sig.id} className="signal-item">
            <span className={`signal-glyph ${sevCls[sig.severity]}`}>
              {sevGlyph[sig.severity]}
            </span>
            <div className="signal-body">
              <span className="signal-file">
                {sig.location?.file}{sig.location?.line ? `:${sig.location.line}` : ""}
              </span>
              <span className="signal-desc">{sig.description}</span>
              {sig.suggestion && (
                <span className="signal-sug">→ {sig.suggestion}</span>
              )}
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
    <div className="card fade-in">
      <div className="card-header">
        <span className="t-green t-sm">✓ migration complete</span>
        <span className="t-muted t-xs">{result.duration}ms</span>
        {result.dryRun && <span className="badge badge-yellow">dry run</span>}
      </div>

      {result.transformLog?.length > 0 && (
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span className="t-label" style={{ marginBottom: "4px" }}>transforms applied</span>
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
        <div style={{ padding: "0 16px 16px" }}>
          <button className="btn btn-primary btn-block" onClick={onDownload}>
            ⬇ download migrated project ({result.files.length} files)
          </button>
        </div>
      )}

      {result.dryRun && (
        <div className="card-body">
          <div className="log-line">
            <span className="log-glyph t-yellow">◈</span>
            <span className="log-text">
              Dry run — no changes written. Uncheck "dry run" to apply transforms.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function MigrateApp() {
  const [serverOk, setServerOk] = useState(null);
  const [loadedFile, setLoadedFile] = useState(null);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null);
  const [scanReport, setScanReport] = useState(null);
  const [migrationResult, setMigrationResult] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState("vite");
  const [dryRun, setDryRun] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const addLog = useCallback((type, msg) => {
    setLogs((prev) => [...prev, { type, msg, ts: Date.now() }]);
  }, []);

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then((d) => setServerOk(d.ok === true))
      .catch(() => setServerOk(false));
  }, []);

  const handleFile = (file) => {
    setLoadedFile(file);
    setScanReport(null);
    setMigrationResult(null);
    setLogs([]);
    addLog("info", `Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  };

  const runScan = async () => {
    if (!loadedFile || scanning) return;
    setScanning(true);
    setScanReport(null);
    setMigrationResult(null);
    setProgress({ msg: "Reading zip…", pct: 5 });
    try {
      const b64 = await fileToBase64(loadedFile);
      setProgress({ msg: "Scanning for lock-in signals…", pct: 30 });
      const res = await fetch(`${API}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: { zip: b64, name: loadedFile.name } }),
      });
      setProgress({ msg: "Building report…", pct: 80 });
      const report = await res.json();
      if (report.error) throw new Error(report.error);
      setProgress({ msg: "Complete", pct: 100 });
      await sleep(250);
      setScanReport(report);
      addLog("ok", `Scan complete — ${report.signals?.length ?? 0} signals found`);
    } catch (err) {
      addLog("error", "Scan failed: " + err.message);
    } finally {
      setProgress(null);
      setScanning(false);
    }
  };

  const runMigrate = async () => {
    if (!loadedFile || migrating) return;
    setMigrating(true);
    setMigrationResult(null);
    setProgress({ msg: "Reading zip…", pct: 5 });
    try {
      const b64 = await fileToBase64(loadedFile);
      setProgress({ msg: "Applying transforms…", pct: 40 });
      const res = await fetch(`${API}/api/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: { zip: b64, name: loadedFile.name },
          dryRun,
          targetAdapter: selectedTarget,
        }),
      });
      setProgress({ msg: "Finalizing…", pct: 85 });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setProgress({ msg: "Done", pct: 100 });
      await sleep(250);
      setMigrationResult(result);
      addLog(
        "ok",
        dryRun
          ? `Dry run complete — ${result.transformLog?.length ?? 0} transforms previewed`
          : `Migration complete — ${result.files?.length ?? 0} files changed`
      );
    } catch (err) {
      addLog("error", "Migration failed: " + err.message);
    } finally {
      setProgress(null);
      setMigrating(false);
    }
  };

  const handleDownload = async () => {
    if (!migrationResult?.files?.length) return;
    try {
      await downloadMigrationZip(migrationResult, loadedFile.name);
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
        {/* Left sidebar */}
        <aside className="sidebar">
          <p className="section-label" style={{ marginBottom: "var(--sp-3)" }}>source</p>

          <DropZone onFile={handleFile} loadedFile={loadedFile} />

          <p className="section-label" style={{ marginTop: "var(--sp-4)" }}>target format</p>

          {[
            { id: "vite",   label: "Vite + React",  desc: "Framework-agnostic (recommended)" },
            { id: "nextjs", label: "Next.js",        desc: "App Router structure" },
          ].map((t) => (
            <div
              key={t.id}
              className={`target-option ${selectedTarget === t.id ? "active" : ""}`}
              onClick={() => setSelectedTarget(t.id)}
              role="radio"
              aria-checked={selectedTarget === t.id}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setSelectedTarget(t.id)}
            >
              <span className={selectedTarget === t.id ? "t-green" : "t-muted"}>
                {selectedTarget === t.id ? "◉" : "○"}
              </span>
              <div>
                <div className="t-white" style={{ fontSize: "12px" }}>{t.label}</div>
                <div className="t-muted t-xs">{t.desc}</div>
              </div>
            </div>
          ))}

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            dry run (preview only)
          </label>

          <div className="flex flex-col gap-2" style={{ marginTop: "var(--sp-2)" }}>
            <button
              className="btn btn-ghost btn-block"
              disabled={!hasProject || busy}
              onClick={runScan}
            >
              {scanning
                ? <><span className="spin" style={{ display: "inline-block" }}>◌</span> scanning…</>
                : "◉ scan project"}
            </button>
            <button
              className="btn btn-primary btn-block"
              disabled={!hasProject || busy}
              onClick={runMigrate}
            >
              {migrating
                ? <><span className="spin" style={{ display: "inline-block" }}>◌</span> migrating…</>
                : dryRun
                ? "◈ preview migration"
                : "▸ migrate project"}
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="panel-main">
          {progress && (
            <div className="progress fade-in">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
              </div>
              <span className="progress-label">{progress.msg}</span>
            </div>
          )}

          {!scanReport && !migrationResult && logs.length === 0 && !progress && (
            <div className="empty-state">
              <span className="empty-icon">⬇</span>
              <span className="empty-title">Drop a ZIP to get started</span>
              <span className="empty-desc">
                Export your Lovable project from GitHub, drop the ZIP in the left panel,
                then scan for lock-in or migrate directly.
              </span>
            </div>
          )}

          {logs.map((log) => (
            <div key={log.ts} className="log-line">
              <span
                className={`log-glyph ${log.type === "ok" ? "t-green" : log.type === "error" ? "t-red" : "t-dim"}`}
              >
                {log.type === "ok" ? "✓" : log.type === "error" ? "✗" : "·"}
              </span>
              <span className="log-text">{log.msg}</span>
            </div>
          ))}

          <ScanReport report={scanReport} />
          <MigrationResult result={migrationResult} onDownload={handleDownload} />
        </main>

        {/* Right sidebar */}
        <aside className="sidebar-right">
          <p className="section-label" style={{ marginBottom: "var(--sp-4)" }}>guide</p>

          <div className="help-block">
            <p className="help-text">
              <strong>Scan</strong> detects lock-in without changing anything. Safe to run first.
            </p>
            <p className="help-text">
              <strong>Migrate</strong> applies transforms and produces a downloadable ZIP with only the changed files.
            </p>
            <p className="help-text">
              Enable <strong>dry run</strong> to preview what would change without downloading anything.
            </p>
          </div>

          <p className="section-label" style={{ marginBottom: "var(--sp-3)" }}>lovable transforms</p>

          <div className="flex flex-col gap-2">
            {[
              ["remove-lovable-tagger", "Removes build dep + vite.config call"],
              ["abstract-supabase-client", "Moves credentials to env vars"],
              ["remove-env-bleed", "Renames GPT_ENGINEER_* to VITE_*"],
            ].map(([id, desc]) => (
              <div key={id} className="transform-item">
                <div className="t-green t-xs">◈ {id}</div>
                <div className="t-muted t-xs" style={{ marginTop: "2px" }}>{desc}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
