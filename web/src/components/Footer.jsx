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

  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-col footer-col-left">
        <span className="footer-logo">migrare</span>
        <span className="footer-sep">·</span>
        <span className="t-dim t-xs">© {year} Creadev</span>
        <span className="footer-sep">·</span>
        <a
          href="https://github.com/dhaupin/migrare/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          MIT
        </a>
      </div>

      <div className="footer-col footer-col-right">
        {/* API status indicator */}
        {serverOk !== null && (
          <span className="badge flex gap-2 items-center" style={{ marginRight: 12 }}>
            <span className={`status-dot ${serverOk ? "dot-online" : "dot-offline"}`} />
            <span className="t-dim t-xs">{serverOk ? "api" : "offline"}</span>
          </span>
        )}

        <Link to="/app" className="footer-link">Migrate</Link>
        <Link to="/docs" className="footer-link">Docs</Link>
        <Link to="/for-ai" className="footer-link">For AI</Link>
        <Link to="/contact" className="footer-link">Contact</Link>
        <Link to="/terms" className="footer-link">Terms</Link>
        <Link to="/privacy" className="footer-link">Privacy</Link>
        <a
          href="https://github.com/dhaupin/migrare"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          <GithubIcon />
        </a>
      </div>
    </footer>
  );
}