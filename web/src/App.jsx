// App.jsx — client entry wrapper only.
// BrowserRouter must live here and ONLY here (Prestruct requirement).
import React from "react";
import { BrowserRouter } from "react-router-dom";
import AppLayout from "./AppLayout.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
