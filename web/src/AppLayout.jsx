// AppLayout.jsx — Prestruct critical rule: NO BrowserRouter import here.
// BrowserRouter lives only in App.jsx (client entry) and main.jsx.
// This file is loaded by the prerender script via ssrLoadModule with StaticRouter.
// Do not add inline <style> tags — use the external global.css import instead.
import React, { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import "./global.css";
import Home from "./pages/Home.jsx";
import MigrateApp from "./pages/MigrateApp.jsx";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function AppLayout() {
  return (
    <>
      <ScrollToTop />
      <div id="app-root">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/app" element={<MigrateApp />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </div>
    </>
  );
}
