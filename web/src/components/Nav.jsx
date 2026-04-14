import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import GithubIcon from "./GithubIcon";

const API = "";

function MenuIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(null);
  const [serverOk, setServerOk] = useState(null);
  const location = useLocation();

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const initial = stored || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    setTheme(initial);
    document.documentElement.classList.toggle("light", initial === "light");
  }, []);

  useEffect(() => {
    fetch(`${API}/api/health`)
      .then(r => r.json())
      .then(d => setServerOk(d.ok === true))
      .catch(() => setServerOk(false));
  }, []);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${API}/api/health`)
        .then(r => r.json())
        .then(d => setServerOk(d.ok === true))
        .catch(() => setServerOk(false));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    if (!theme) return;
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("light", next === "light");
  };

  // Close menu on route change
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
      
      {/* Desktop nav links - visible on larger screens */}
      <div className="nav-links">
        {navItems.map((item) => (
          <Link
            key={item.href}
            to={item.href}
            className="nav-link"
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="nav-right">
        {/* API status indicator */}
        {serverOk !== null && (
          <span className="badge flex gap-2 items-center" style={{ marginRight: 8 }}>
            <span className={`status-dot ${serverOk ? "dot-online" : "dot-offline"}`} />
            <span className="t-dim t-xs">{serverOk ? "api online" : "api offline"}</span>
          </span>
        )}

        {/* Theme toggle */}
        <button
          className="nav-icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          id="theme-toggle"
        >
          {theme === "light" ? <MoonIcon /> : <SunIcon />}
        </button>

        {/* Hamburger menu */}
        <button
          className="nav-icon nav-hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {/* Mobile menu dropdown */}
      <div className={`nav-menu ${menuOpen ? "open" : ""}`}>
        {navItems.map((item) => (
          <Link
            key={item.href}
            to={item.href}
            className="nav-menu-item"
          >
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