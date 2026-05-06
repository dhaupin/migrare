import React, { useState, useRef, useCallback, useEffect } from "react";
import JSZip from "jszip";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import Tip from "../components/Tip";

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
          <span className="t-green dropzone-icon-success">✓</span>
          <span className="t-white dropzone-file">{loadedFile.name}</span>
          <span className="t-muted t-xs">{(loadedFile.size / 1024).toFixed(1)} KB · tap to replace</span>
        </>
      ) : (
        <>
          <span className="t-muted dropzone-icon">⬇</span>
          <span className="t-dim dropzone-copy">Drop or tap to upload ZIP</span>
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
        <div className="signal-meta-row flex flex-wrap gap-2 items-center">
          <span className="t-label">via:</span>
          {report.detectionSignals.map(s => <span key={s} className="sig-tag">{s}</span>)}
        </div>
      )}

      <div className="signal-list">
        {report.signals?.length === 0 && (
          <div className="log-line">
            <span className="log-glyph t-green">✓</span>
            <span className="log-text">No lock-in signals found - project looks portable</span>
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
                {" - "}
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
              Preview only - transforms were computed but no files produced.
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
  const [authUser, setAuthUser]         = useState(null);  // GitHub user when connected
  const [repos, setRepos]             = useState([]);    // Available repos
  const [selectedRepo, setSelectedRepo] = useState(null);  // Selected GitHub repo
  const [sourceType, setSourceType]       = useState("zip"); // "zip" | "github"
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

  // Check GitHub auth status on mount
  useEffect(() => {
    fetch(`${API}/api/auth/status`)
      .then(r => r.json())
      .then(d => {
        if (d.authenticated) {
          setAuthUser(d.user);
          // Fetch repos after auth
          fetch(`${API}/api/auth/repos`)
            .then(r => r.json())
            .then(repoData => setRepos(repoData.repos || []))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const handleFile = (file) => {
    setLoadedFile(file);
    setScanReport(null);
    setMigResult(null);
    setLogs([]);
    addLog("info", `Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  };

  const handleConnectGitHub = () => {
    // Generate state with redirect for CSRF protection
    const state = btoa(JSON.stringify({ redirect: window.location.origin + "/app" }));
    const clientId = import.meta.env.VITE_MIGRARE_GITHUB_CLIENT_ID || "Ov23lijPqkbtomPfV1aY";
    const redirectUri = encodeURIComponent(window.location.origin + "/oauth-callback");
    const scope = "repo,read:org";
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
  };

  const handleDisconnect = () => {
    setAuthUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setSourceType("zip");
  };

  // Compute if we have a source (either zip or github repo)
  const hasProject = !!loadedFile || (sourceType === "github" && selectedRepo);

  const runScan = async () => {
    if (!hasProject || scanning) return;
    setScanning(true); setScanReport(null); setMigResult(null);
    setProgress({ msg: sourceType === "github" ? "Loading from GitHub…" : "Reading zip…", pct: 10 });
    try {
      let scanPayload;
      if (sourceType === "github" && selectedRepo) {
        scanPayload = { source: { github: selectedRepo } };
      } else {
        const b64 = await fileToBase64(loadedFile);
        scanPayload = { source: { zip: b64, name: loadedFile.name } };
      }
      setProgress({ msg: "Scanning for lock-in signals…", pct: 35 });
      const res = await fetch(`${API}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scanPayload),
      });
      setProgress({ msg: "Building report…", pct: 80 });
      const report = await res.json();
      if (report.error) throw new Error(report.error);
      setProgress({ msg: "Done", pct: 100 });
      await sleep(200);
      setScanReport(report);
      addLog("ok", `Scan complete - ${report.signals?.length ?? 0} signals, complexity: ${report.summary?.migrationComplexity}`);
    } catch (err) {
      addLog("error", "Scan failed: " + err.message);
    } finally {
      setProgress(null); setScanning(false);
    }
  };

  const runMigrate = async () => {
    if (!hasProject || migrating) return;
    const dryRun = migMode === "preview";
    setMigrating(true); setMigResult(null);
    setProgress({ msg: sourceType === "github" ? "Loading from GitHub…" : "Reading zip…", pct: 10 });
    try {
      let migratePayload;
      if (sourceType === "github" && selectedRepo) {
        migratePayload = { source: { github: selectedRepo }, dryRun, targetAdapter: selectedTarget };
      } else {
        const b64 = await fileToBase64(loadedFile);
        migratePayload = { source: { zip: b64, name: loadedFile.name }, dryRun, targetAdapter: selectedTarget };
      }
      setProgress({ msg: dryRun ? "Computing transforms…" : "Applying transforms…", pct: 45 });
      const res = await fetch(`${API}/api/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(migratePayload),
      });
      setProgress({ msg: "Finalizing…", pct: 85 });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setProgress({ msg: "Done", pct: 100 });
      await sleep(200);
      setMigResult(result);
      addLog("ok", dryRun
        ? `Preview complete - ${result.transformLog?.length ?? 0} transforms would apply`
        : `Migration complete - ${result.files?.length ?? 0} files changed`);
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
  const apiOnline = serverOk === true;
  const hasFile = hasProject && apiOnline;
  const statusLabel = apiOnline
    ? "online"
    : serverOk === false
    ? "offline"
    : "checking…";

  return (
    <div className="app-shell">
      <Nav />

      <div className="app-body">

        {/* ── sidebar ── */}
        <aside className="sidebar">
          
          {/* API status */}
          <div className="flex items-center gap-2 mb-4">
            <span className="section-label section-label-inline">api</span>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                apiOnline
                  ? "bg-green-900/40 text-green-400"
                  : serverOk === false
                  ? "bg-red-900/40 text-red-400"
                  : "bg-zinc-700 text-zinc-400"
              }`}
            >
              {statusLabel}
            </span>
          </div>

          {/* source type tabs */}
          <div className="flex items-center gap-2 mb-2">
            <span className="section-label section-label-inline">source</span>
            <Tip text="Connect GitHub to scan your repos directly, or upload a ZIP export." />
          </div>
          <div className="source-tabs">
            <button
              className={`source-tab ${sourceType === "zip" ? "active" : ""}`}
              onClick={() => setSourceType("zip")}
            >
              <span className="t-xs">ZIP</span>
            </button>
            <button
              className={`source-tab ${sourceType === "github" ? "active" : ""}`}
              onClick={() => setSourceType("github")}
            >
              <span className="t-xs">GitHub</span>
            </button>
          </div>

          {/* source content based on type */}
          {sourceType === "zip" && (
            <DropZone onFile={handleFile} loadedFile={loadedFile} />
          )}

          {sourceType === "github" && !authUser && (
            <div className="connect-github-panel">
              <div className="connect-github-content">
                <div className="t-dim t-sm mb-2">
                  Connect your GitHub account to scan and migrate your repos directly.
                </div>
                <button className="btn btn-primary btn-block" onClick={handleConnectGitHub}>
                  <span className="btn-icon">◉</span> Connect GitHub
                </button>
              </div>
            </div>
          )}

          {sourceType === "github" && authUser && (
            <div className="connect-github-panel connected">
              <div className="connected-header">
                <img src={authUser.avatar_url} alt="" className="connected-avatar" />
                <div className="connected-info">
                  <span className="t-white t-sm">{authUser.login}</span>
                  <button className="btn btn-ghost btn-xs" onClick={handleDisconnect}>
                    disconnect
                  </button>
                </div>
              </div>
              {repos.length > 0 && (
                <select
                  className="repo-select"
                  value={selectedRepo || ""}
                  onChange={(e) => setSelectedRepo(e.target.value)}
                >
                  <option value="">Select a repo…</option>
                  {repos.map((r) => (
                    <option key={r.full_name} value={r.full_name}>
                      {r.full_name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* target */}
          <div className="flex items-center gap-2 mt-4 mb-2">
            <span className="section-label section-label-inline">output format</span>
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
                <div className="option-meta">{t.label}</div>
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
                disabled={!hasFile || busy}
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
              <div className="flex flex-col gap-1 option-panel">
                {/* toggle row */}
                <div className="flex gap-1">
                  {[
                    { id: "migrate", label: "migrate" },
                    { id: "preview", label: "preview" },
                  ].map(m => (
                    <button
                      key={m.id}
                      className={`btn btn-xs option-toggle ${migMode === m.id ? "btn-ghost is-active" : "btn-outline"}`}
                      onClick={() => setMigMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-primary btn-block btn-center"
                  disabled={!hasFile || busy}
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
                    ? "Preview runs all transforms internally and shows what would change - but produces no downloadable output."
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
            <span className="section-label section-label-inline">guide</span>
          </div>

          <div className="help-block">
            <p className="help-text">
              <strong>Scan</strong> is always read-only. No files change. Use it to understand
              what lock-in exists before deciding whether to migrate.
            </p>
            <p className="help-text">
              <strong>Preview</strong> runs transforms internally and shows the change log -
              no output is produced. Use it to verify the plan before committing.
            </p>
            <p className="help-text">
              <strong>Migrate</strong> applies everything and produces a ZIP of only the
              modified files. Review the diff before merging into your repo.
            </p>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span className="section-label section-label-inline">transforms</span>
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

      <Footer />
    </div>
  );
}
