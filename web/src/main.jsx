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
    // Check localStorage first, then device preference, default to dark
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = stored || (prefersDark ? "dark" : "light");
    setTheme(initial);
    document.documentElement.classList.toggle("light", initial === "light");
  }, []);

  // Render toggle button in nav once theme is initialized
  useEffect(() => {
    if (theme && !document.getElementById("theme-toggle")) {
      const btn = document.createElement("button");
      btn.id = "theme-toggle";
      btn.className = "nav-icon";
      btn.title = `Switch to ${theme === "light" ? "dark" : "light"} mode`;
      btn.innerHTML = theme === "light"
        ? '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:16px;height:16px;fill:currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        : '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:16px;height:16px;fill:currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
      btn.setAttribute("aria-label", `Switch to ${theme === "light" ? "dark" : "light"} mode`);
      
      // Insert after nav-links
      const navLinks = document.querySelector(".nav-links");
      if (navLinks) {
        navLinks.appendChild(btn);
        // Update margin on nav-icon to create gap
        const navIcon = document.querySelector(".nav-icon");
        if (navIcon) navIcon.style.marginLeft = "var(--s2)";
      }
    }
  }, [theme]);

  // Toggle theme - use onclick property set each time to avoid stale closure
  useEffect(() => {
    const btn = document.getElementById("theme-toggle");
    if (btn && theme) {
      const next = theme === "light" ? "dark" : "light";
      btn.title = `Switch to ${next} mode`;
      btn.setAttribute("aria-label", `Switch to ${next} mode`);
      btn.innerHTML = next === "light"
        ? '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:16px;height:16px;fill:currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        : '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:16px;height:16px;fill:currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
      btn.onclick = () => {
        const newTheme = document.documentElement.classList.contains("light") ? "dark" : "light";
        localStorage.setItem("theme", newTheme);
        document.documentElement.classList.toggle("light", newTheme === "light");
        setTheme(newTheme);
      };
    }
  }, [theme]);

  // Render children
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
