import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import GithubIcon, { MenuIcon, CloseIcon } from "./GithubIcon";
import ThemeToggleIsland from "./ThemeToggleIsland";

const API = "";

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [serverOk, setServerOk] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const location = useLocation();

  // Check auth status on mount
  useEffect(() => {
    fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then((d) => setServerOk(d.ok === true))
      .catch(() => setServerOk(false));

    // Check sessionStorage for token
    const stored = sessionStorage.getItem("gh_token");
    if (stored) {
      validateToken(stored);
    }
  }, []);

  const validateToken = async (tkn) => {
    try {
      const res = await fetch(`${API}/api/auth/github/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tkn }),
      });
      if (res.ok) {
        const data = await res.json();
        setAuthUser(data.user);
        sessionStorage.setItem("gh_token", tkn);
      }
    } catch {}
  };

  const handleAuth = async () => {
    if (!token.trim()) return;
    setLoading(true);
    await validateToken(token.trim());
    setLoading(false);
    setShowTokenInput(false);
    setToken("");
  };

  const handleLogout = async () => {
    sessionStorage.removeItem("gh_token");
    setAuthUser(null);
    await fetch(`${API}/api/auth/logout`, { method: "POST" });
  };

  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${API}/api/health`)
        .then((r) => r.json())
        .then((d) => setServerOk(d.ok === true))
        .catch(() => setServerOk(false));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const navItems = [
    { href: "/app", label: "Migrate" },
    { href: "/docs", label: "Docs" },
    { href: "/for-ai", label: "For AI" },
    { href: "/contact", label: "Contact" },
  ];

  return (
    <nav className="nav">
      <Link to="/" className="logo">
        <span className="logo-dot" />
        migrare
      </Link>

      <div className="nav-links">
        {navItems.map((item) => (
          <Link key={item.href} to={item.href} className="nav-link">
            {item.label}
          </Link>
        ))}
      </div>

      <div className="nav-right">
        {serverOk !== null && (
          <span className="badge badge-status">
            <span className={`status-dot ${serverOk ? "dot-online" : "dot-offline"}`} />
            <span className="t-dim t-xs">{serverOk ? "api online" : "api offline"}</span>
          </span>
        )}

        {/* Auth section */}
        {authUser ? (
          <div className="auth-section">
            <img src={authUser.avatar} alt="" className="auth-avatar" />
            <span className="auth-name t-xs">{authUser.login}</span>
            <button onClick={handleLogout} className="btn btn-sm btn-secondary">
              Logout
            </button>
          </div>
        ) : showTokenInput ? (
          <div className="auth-input-group">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              className="auth-input"
              onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            />
            <button onClick={handleAuth} disabled={loading} className="btn btn-sm">
              {loading ? "..." : "Add"}
            </button>
            <button onClick={() => setShowTokenInput(false)} className="btn btn-sm btn-ghost">
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowTokenInput(true)}
            className="btn btn-sm btn-secondary"
          >
            <GithubIcon />
            Connect
          </button>
        )}

        <ThemeToggleIsland />

        <button
          className="nav-icon nav-hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          type="button"
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      <div className={`nav-menu ${menuOpen ? "open" : ""}`}>
        {navItems.map((item) => (
          <Link key={item.href} to={item.href} className="nav-menu-item">
            {item.label}
          </Link>
        ))}
        <a
          href="https://github.com/dhaupin/migrare"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-menu-item"
        >
          <GithubIcon />
          Source
        </a>
      </div>
    </nav>
  );
}
