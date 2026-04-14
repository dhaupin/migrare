// main.jsx — Prestruct-compatible client entry.
// Uses hydrateRoot when SSR content is present, createRoot otherwise.
// This prevents FOUC on prerendered pages.
import React, { useEffect, useState } from "react";
import { hydrateRoot, createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppLayout from "./AppLayout.jsx";

const container = document.getElementById("root");

// Theme management with localStorage persistence and device preference detection
function ThemeManager({ children }) {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = stored || (prefersDark ? "dark" : "light");
    setTheme(initial);
    document.documentElement.classList.toggle("light", initial === "light");
  }, []);

  // Create/update toggle button
  useEffect(() => {
    if (!theme) return;
    
    let btn = document.getElementById("theme-toggle");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "theme-toggle";
      btn.className = "nav-icon";
      
      const navLinks = document.querySelector(".nav-links");
      if (navLinks) {
        navLinks.appendChild(btn);
        const navIcon = document.querySelector(".nav-icon");
        if (navIcon) navIcon.style.marginLeft = "var(--s2)";
      }
    }
    
    // Moon in light, sun in dark
    const isLight = theme === "light";
    const next = isLight ? "dark" : "light";
    btn.title = `Switch to ${next} mode`;
    btn.setAttribute("aria-label", `Switch to ${next} mode`);
    btn.innerHTML = isLight
      ? '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:16px;height:16px;fill:currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
      : '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:16px;height:16px;fill:currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
    btn.onclick = () => {
      localStorage.setItem("theme", next);
      document.documentElement.classList.toggle("light", next === "light");
      setTheme(next);
    };
  }, [theme]);

  return children;
}

if (container && container.childElementCount > 0) {
  // Prerendered HTML present — hydrate to reuse it
  hydrateRoot(
    container,
    <BrowserRouter>
      <ThemeManager>
        <AppLayout />
      </ThemeManager>
    </BrowserRouter>
  );
} else {
  // No SSR content — fresh render (local dev)
  createRoot(container).render(
    <BrowserRouter>
      <ThemeManager>
        <AppLayout />
      </ThemeManager>
    </BrowserRouter>
  );
}
