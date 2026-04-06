import React, { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";

// API always relative — works local (proxied to :4242) and on Cloudflare Pages
const API = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:...;base64,XXXX" — strip the prefix
      const b64 = reader.result.split(",")[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function downloadMigrationZip(result, originalName) {
  const zip = new JSZip();
  const folderName = originalName.replace(/\.zip$/i, "") + "-migrated";
  const folder = zip.folder(folderName);

  for (const { path, content } of result.files) {
    folder.file(path, content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = folderName + ".zip";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Topbar({ serverOk }) {
  return (
    <div style={s.topbar}>
      <div style={s.logo}>
        <span style={s.logoDot} />
        migrare
      </div>
      <span style={s.tagline}>escape vendor lock-in</span>
      <div style={s.topbarRight}>
        <span
          style={{
            ...s.badge,
            color: serverOk === null ? "var(--text-muted)" : serverOk ? "var(--green)" : "var(--red)",
            borderColor: serverOk === null ? "var(--border)" : serverOk ? "var(--green-dim)" : "var(--red)",
          }}
        >
          {serverOk === null ? "connecting…" : serverOk ? "● api ready" : "○ api offline"}
        </span>
        <Link to="/" style={s.ghLink}>
          ← home
        </Link>
        <a
          href="https://github.com/dhaupin/migrare"
          target="_blank"
          rel="noopener noreferrer"
          style={s.ghLink}
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

  return (
    <div
      style={{
        ...s.dropzone,
        borderColor: dragOver ? "var(--green)" : loadedFile ? "var(--green-dim)" : "var(--border-hi)",
        background: dragOver ? "var(--green-glow)" : "transparent",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
    >
      {loadedFile ? (
        <>
          <div style={{ fontSize: "18px", color: "var(--green)" }}>✓</div>
          <div style={{ color: "var(--text)", fontSize: "12px" }}>{loadedFile.name}</div>
          <div style={{ color: "var(--text-dim)", fontSize: "10px" }}>
            {(loadedFile.size / 1024).toFixed(1)} KB · click to replace
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: "22px", color: "var(--text-muted)" }}>⬇</div>
          <div style={{ color: "var(--text-dim)", fontSize: "12px" }}>Drop ZIP export</div>
          <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>or click to browse</div>
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

  const severityColor = { error: "var(--red)", warning: "var(--yellow)", info: "var(--cyan)" };
  const severityIcon = { error: "✗", warning: "⚠", info: "·" };
  const complexityColor = {
    straightforward: "var(--green)",
    moderate: "var(--yellow)",
    "requires-manual": "var(--red)",
  };

  return (
    <div style={s.reportBlock}>
      <div style={s.reportHeader}>
        <span style={s.platformBadge}>{report.platform}</span>
        <span
          style={{
            ...s.complexityBadge,
            color: complexityColor[report.summary?.migrationComplexity] ?? "var(--text-dim)",
          }}
        >
          {report.summary?.migrationComplexity ?? "—"}
        </span>
        <div style={s.statRow}>
          <span style={{ color: "var(--red)" }}>
            ✗ {report.summary?.bySeverity?.error ?? 0}
          </span>
          <span style={{ color: "var(--yellow)" }}>
            ⚠ {report.summary?.bySeverity?.warning ?? 0}
          </span>
          <span style={{ color: "var(--cyan)" }}>
            · {report.summary?.bySeverity?.info ?? 0}
          </span>
        </div>
      </div>

      {report.detectionSignals?.length > 0 && (
        <div style={s.detectionSignals}>
          <span style={s.dimLabel}>detected via:</span>
          {report.detectionSignals.map((sig) => (
            <span key={sig} style={s.sigTag}>{sig}</span>
          ))}
        </div>
      )}

      <div style={s.signalList}>
        {report.signals?.length === 0 && (
          <div style={s.logLine}>
            <span style={{ color: "var(--green)" }}>✓</span>
            <span style={s.logText}>No lock-in signals detected — project looks portable</span>
          </div>
        )}
        {(report.signals ?? []).map((sig) => (
          <div key={sig.id} style={s.signalItem}>
            <span style={{ color: severityColor[sig.severity] ?? "var(--text-dim)" }}>
              {severityIcon[sig.severity] ?? "·"}
            </span>
            <div style={s.signalBody}>
              <div style={s.signalFile}>
                {sig.location?.file}
                {sig.location?.line ? `:${sig.location.line}` : ""}
              </div>
              <div style={s.signalDesc}>{sig.description}</div>
              {sig.suggestion && (
                <div style={s.signalSug}>→ {sig.suggestion}</div>
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
    <div style={s.reportBlock}>
      <div style={s.reportHeader}>
        <span style={{ color: "var(--green)", fontSize: "13px" }}>
          ✓ migration complete
        </span>
        <span style={s.dimLabel}>{result.duration}ms</span>
        {result.dryRun && <span style={s.dryRunBadge}>dry run</span>}
      </div>

      {result.transformLog?.length > 0 && (
        <div style={s.signalList}>
          <div style={{ ...s.dimLabel, marginBottom: "8px" }}>transforms applied:</div>
          {result.transformLog.map((entry, i) => (
            <div key={i} style={s.logLine}>
              <span style={{ color: "var(--green)" }}>▸</span>
              <span style={s.logText}>
                <span style={{ color: "var(--cyan)" }}>{entry.transform}</span>
                {" — "}
                <span style={{ color: "var(--text-dim)" }}>{entry.file}</span>
                {" "}
                <span style={{ color: "var(--text-muted)" }}>({entry.action})</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {result.files?.length > 0 && !result.dryRun && (
        <button style={s.downloadBtn} onClick={onDownload}>
          ⬇ download migrated project ({result.files.length} files)
        </button>
      )}

      {result.dryRun && (
        <div style={{ ...s.logLine, marginTop: "8px" }}>
          <span style={{ color: "var(--yellow)" }}>◈</span>
          <span style={s.logText}>
            Dry run — no changes written. Uncheck "dry run" to apply transforms.
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tool page
// ---------------------------------------------------------------------------

export default function MigrateApp() {
  const [serverOk, setServerOk] = useState(null);
  const [loadedFile, setLoadedFile] = useState(null);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null); // { msg, pct }
  const [scanReport, setScanReport] = useState(null);
  const [migrationResult, setMigrationResult] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState("vite");
  const [dryRun, setDryRun] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const addLog = useCallback((type, msg) => {
    setLogs((prev) => [...prev, { type, msg, ts: Date.now() }]);
  }, []);

  // Health check on mount
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
    <div style={s.app}>
      <Topbar serverOk={serverOk} />

      <div style={s.body}>
        {/* Left sidebar — ingestion + target */}
        <aside style={s.sidebar}>
          <div style={s.sectionLabel}>source</div>

          <DropZone onFile={handleFile} loadedFile={loadedFile} />

          <div style={{ ...s.sectionLabel, marginTop: "1.5rem" }}>target format</div>
          {[
            { id: "vite", label: "Vite + React", desc: "Framework-agnostic (recommended)" },
            { id: "nextjs", label: "Next.js", desc: "App Router structure" },
          ].map((t) => (
            <div
              key={t.id}
              style={{
                ...s.targetOption,
                borderColor: selectedTarget === t.id ? "var(--green-dim)" : "var(--border)",
                background: selectedTarget === t.id ? "var(--green-glow)" : "transparent",
              }}
              onClick={() => setSelectedTarget(t.id)}
            >
              <span style={{ color: selectedTarget === t.id ? "var(--green)" : "var(--text-dim)" }}>
                {selectedTarget === t.id ? "◉" : "○"}
              </span>
              <div>
                <div style={{ color: "var(--text)", fontSize: "12px" }}>{t.label}</div>
                <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>{t.desc}</div>
              </div>
            </div>
          ))}

          <label style={s.dryRunLabel}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              style={{ accentColor: "var(--green)" }}
            />
            <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>dry run (preview only)</span>
          </label>

          <div style={s.actionButtons}>
            <button
              style={{ ...s.btn, opacity: hasProject && !busy ? 1 : 0.4 }}
              disabled={!hasProject || busy}
              onClick={runScan}
            >
              {scanning ? "◌ scanning…" : "◉ scan project"}
            </button>
            <button
              style={{ ...s.btnPrimary, opacity: hasProject && !busy ? 1 : 0.4 }}
              disabled={!hasProject || busy}
              onClick={runMigrate}
            >
              {migrating
                ? "◌ migrating…"
                : dryRun
                ? "◈ preview migration"
                : "▸ migrate project"}
            </button>
          </div>
        </aside>

        {/* Center — results */}
        <main style={s.main}>
          {progress && (
            <div style={s.progressBar}>
              <div style={s.progressTrack}>
                <div style={{ ...s.progressFill, width: `${progress.pct}%` }} />
              </div>
              <span style={s.progressMsg}>{progress.msg}</span>
            </div>
          )}

          {!scanReport && !migrationResult && logs.length === 0 && !progress && (
            <div style={s.emptyState}>
              <div style={s.emptyIcon}>⬇</div>
              <div style={s.emptyTitle}>Drop a ZIP to get started</div>
              <div style={s.emptyDesc}>
                Export your Lovable project from GitHub, drop the ZIP in the left panel,
                then scan for lock-in or migrate directly.
              </div>
            </div>
          )}

          {logs.map((log) => (
            <div key={log.ts} style={s.logLine}>
              <span
                style={{
                  color:
                    log.type === "ok"
                      ? "var(--green)"
                      : log.type === "error"
                      ? "var(--red)"
                      : "var(--text-dim)",
                }}
              >
                {log.type === "ok" ? "✓" : log.type === "error" ? "✗" : "·"}
              </span>
              <span style={s.logText}>{log.msg}</span>
            </div>
          ))}

          <ScanReport report={scanReport} />
          <MigrationResult result={migrationResult} onDownload={handleDownload} />
        </main>

        {/* Right sidebar — help */}
        <aside style={s.rightSidebar}>
          <div style={s.sectionLabel}>what to expect</div>
          <div style={s.helpBlock}>
            <p style={s.helpText}>
              <strong style={{ color: "var(--text)" }}>Scan</strong> detects lock-in signals
              without changing anything. Safe to run first.
            </p>
            <p style={{ ...s.helpText, marginTop: "0.75rem" }}>
              <strong style={{ color: "var(--text)" }}>Migrate</strong> applies transforms
              and produces a downloadable ZIP with only the changed files.
            </p>
            <p style={{ ...s.helpText, marginTop: "0.75rem" }}>
              Enable <strong style={{ color: "var(--text)" }}>dry run</strong> to preview
              what would change without downloading anything.
            </p>
          </div>

          <div style={{ ...s.sectionLabel, marginTop: "1.5rem" }}>lovable transforms</div>
          <div style={s.transformList}>
            {[
              ["remove-lovable-tagger", "Removes build dep + vite.config call"],
              ["abstract-supabase-client", "Moves credentials to env vars"],
              ["remove-env-bleed", "Renames GPT_ENGINEER_* to VITE_*"],
            ].map(([id, desc]) => (
              <div key={id} style={s.transformItem}>
                <div style={{ color: "var(--green)", fontSize: "11px" }}>◈ {id}</div>
                <div style={{ color: "var(--text-muted)", fontSize: "10px", marginTop: "2px" }}>{desc}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = {
  app: {
    display: "grid",
    gridTemplateRows: "44px 1fr",
    height: "100vh",
    overflow: "hidden",
    fontFamily: "var(--mono)",
  },

  // Topbar
  topbar: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: "1.5rem",
    padding: "0 1.25rem",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-1)",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "14px",
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
  },
  tagline: {
    color: "var(--text-muted)",
    fontSize: "11px",
    letterSpacing: "0.04em",
    fontFamily: "var(--sans)",
  },
  topbarRight: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "1rem",
  },
  badge: {
    fontSize: "10px",
    padding: "2px 8px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    letterSpacing: "0.05em",
    fontFamily: "var(--mono)",
  },
  ghLink: {
    color: "var(--text-dim)",
    fontSize: "11px",
    textDecoration: "none",
    letterSpacing: "0.04em",
  },

  // Body layout
  body: {
    display: "grid",
    gridTemplateColumns: "260px 1fr 240px",
    overflow: "hidden",
  },

  // Sidebar
  sidebar: {
    borderRight: "1px solid var(--border)",
    background: "var(--bg-1)",
    padding: "1rem",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },

  sectionLabel: {
    fontSize: "10px",
    letterSpacing: "0.12em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    padding: "0.25rem 0",
    marginBottom: "0.25rem",
  },

  // Drop zone
  dropzone: {
    border: "1px dashed",
    borderRadius: "var(--radius)",
    padding: "1.5rem 1rem",
    textAlign: "center",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    alignItems: "center",
    transition: "border-color 0.15s, background 0.15s",
  },

  // Target options
  targetOption: {
    display: "flex",
    gap: "0.6rem",
    alignItems: "flex-start",
    padding: "0.6rem 0.75rem",
    border: "1px solid",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    transition: "border-color 0.15s, background 0.15s",
  },

  dryRunLabel: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    cursor: "pointer",
    padding: "0.25rem 0",
  },

  actionButtons: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    marginTop: "0.5rem",
  },
  btn: {
    background: "var(--bg-2)",
    border: "1px solid var(--border-hi)",
    color: "var(--text)",
    padding: "8px 12px",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "var(--mono)",
    letterSpacing: "0.04em",
    transition: "opacity 0.15s",
    textAlign: "left",
  },
  btnPrimary: {
    background: "var(--green)",
    border: "none",
    color: "#000",
    padding: "9px 12px",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "var(--mono)",
    fontWeight: 500,
    letterSpacing: "0.04em",
    transition: "opacity 0.15s",
    textAlign: "left",
  },

  // Main content area
  main: {
    padding: "1.25rem",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },

  // Progress bar
  progressBar: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  progressTrack: {
    height: "2px",
    background: "var(--border)",
    borderRadius: "1px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "var(--green)",
    transition: "width 0.3s ease",
  },
  progressMsg: {
    fontSize: "11px",
    color: "var(--text-dim)",
    letterSpacing: "0.05em",
  },

  // Empty state
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    padding: "4rem 2rem",
    textAlign: "center",
    color: "var(--text-muted)",
  },
  emptyIcon: { fontSize: "28px" },
  emptyTitle: { fontSize: "14px", color: "var(--text-dim)", fontFamily: "var(--sans)" },
  emptyDesc: {
    fontSize: "12px",
    color: "var(--text-muted)",
    fontFamily: "var(--sans)",
    maxWidth: "340px",
    lineHeight: 1.6,
  },

  // Log lines
  logLine: {
    display: "flex",
    gap: "0.6rem",
    fontSize: "12px",
    alignItems: "flex-start",
  },
  logText: { color: "var(--text-dim)", lineHeight: 1.5 },

  // Report blocks
  reportBlock: {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    background: "var(--bg-1)",
    overflow: "hidden",
  },
  reportHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-2)",
    flexWrap: "wrap",
  },
  platformBadge: {
    fontSize: "11px",
    padding: "2px 8px",
    border: "1px solid var(--border-hi)",
    color: "var(--green)",
    borderRadius: "var(--radius)",
    letterSpacing: "0.08em",
  },
  complexityBadge: { fontSize: "11px", letterSpacing: "0.05em" },
  statRow: { marginLeft: "auto", display: "flex", gap: "0.75rem", fontSize: "12px" },

  detectionSignals: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    flexWrap: "wrap",
    padding: "0.5rem 1rem",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-1)",
  },
  dimLabel: { fontSize: "10px", color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" },
  sigTag: {
    fontSize: "10px",
    padding: "2px 6px",
    border: "1px solid var(--border)",
    color: "var(--text-dim)",
    borderRadius: "var(--radius)",
  },

  signalList: { padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "10px" },
  signalItem: { display: "flex", gap: "0.6rem", fontSize: "12px", alignItems: "flex-start" },
  signalBody: { display: "flex", flexDirection: "column", gap: "2px" },
  signalFile: { color: "var(--cyan)", fontSize: "11px" },
  signalDesc: { color: "var(--text-dim)", lineHeight: 1.5 },
  signalSug: { color: "var(--text-muted)", fontSize: "11px" },

  dryRunBadge: {
    fontSize: "10px",
    padding: "2px 6px",
    border: "1px solid var(--yellow)",
    color: "var(--yellow)",
    borderRadius: "var(--radius)",
    letterSpacing: "0.06em",
  },

  downloadBtn: {
    margin: "0 1rem 1rem",
    background: "var(--green)",
    color: "#000",
    border: "none",
    padding: "9px 16px",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: "var(--mono)",
    fontWeight: 500,
    letterSpacing: "0.04em",
  },

  // Right sidebar
  rightSidebar: {
    borderLeft: "1px solid var(--border)",
    background: "var(--bg-1)",
    padding: "1rem",
    overflowY: "auto",
  },
  helpBlock: { marginBottom: "0.5rem" },
  helpText: {
    fontFamily: "var(--sans)",
    fontSize: "12px",
    color: "var(--text-dim)",
    lineHeight: 1.6,
  },
  transformList: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  transformItem: {
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    background: "var(--bg-2)",
  },
};
