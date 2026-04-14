// main.jsx — Prestruct-compatible client entry.
// Uses hydrateRoot when SSR content is present, createRoot otherwise.
// This prevents FOUC on prerendered pages.
import React from "react";
import { hydrateRoot, createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppLayout from "./AppLayout.jsx";

const container = document.getElementById("root");

if (container && container.childElementCount > 0) {
  // Prerendered HTML present — hydrate to reuse it
  hydrateRoot(
    container,
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
} else {
  // No SSR content — fresh render (local dev)
  createRoot(container).render(
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
