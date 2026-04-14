import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import GithubIcon from "./GithubIcon";

const API = "";

export default function Footer() {
  const [serverOk, setServerOk] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then(r => r.json())
      .then(d => setServerOk(d.ok === true))
      .catch(() => setServerOk(false));

    // Auto-refresh every 30s
    const interval = setInterval(() => {
      fetch(`${API}/api/health`)
        .then(r => r.json())
        .then(d => setServerOk(d.ok === true))
        .catch(() => setServerOk(false));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="footer">
      {/* API status indicator */}
      {serverOk !== null && (
        <span className="badge flex gap-2 items-center" style={{ marginRight: 8 }}>
          <span className={`status-dot ${serverOk ? "dot-online" : "dot-offline"}`} />
          <span className="t-dim t-xs">{serverOk ? "api online" : "api offline"}</span>
        </span>
      )}

      <Link to="/app" className="footer-link">Migrate</Link>
      <span className="footer-sep">·</span>
      <Link to="/docs" className="footer-link">Docs</Link>
      <span className="footer-sep">·</span>
      <Link to="/for-ai" className="footer-link">For AI</Link>
      <span className="footer-sep">·</span>
      <a
        href="https://github.com/dhaupin/migrare"
        target="_blank"
        rel="noopener noreferrer"
        className="footer-link"
      >
        <GithubIcon />
        Source
      </a>
      <span className="footer-sep">·</span>
      <a
        href="https://github.com/dhaupin/migrare/blob/main/LICENSE"
        target="_blank"
        rel="noopener noreferrer"
        className="footer-link"
      >
        MIT license
      </a>
    </footer>
  );
}