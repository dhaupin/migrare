// AppLayout.jsx — Prestruct critical rule: NO BrowserRouter import here.
import React, { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import "./design.css";
import Home from "./pages/Home.jsx";
import MigrateApp from "./pages/MigrateApp.jsx";
import ForAI from "./pages/ForAI.jsx";
import Docs from "./pages/Docs.jsx";
import Contact from "./pages/Contact.jsx";
import Terms from "./pages/Terms.jsx";
import Privacy from "./pages/Privacy.jsx";
import OAuthCallback from "./pages/OAuthCallback.jsx";

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
          <Route path="/docs" element={<Docs />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/oauth-callback" element={<OAuthCallback />} />
          <Route path="*"      element={<Home />} />
        </Routes>
      </div>
    </>
  );
}
