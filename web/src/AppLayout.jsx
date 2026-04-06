// AppLayout.jsx — Prestruct critical rule: NO BrowserRouter import here.
import React, { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import "./design.css";
import Home from "./pages/Home.jsx";
import MigrateApp from "./pages/MigrateApp.jsx";
import ForAI from "./pages/ForAI.jsx";

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
          <Route path="/"      element={<Home />} />
          <Route path="/app"   element={<MigrateApp />} />
          <Route path="/for-ai" element={<ForAI />} />
          <Route path="*"      element={<Home />} />
        </Routes>
      </div>
    </>
  );
}
