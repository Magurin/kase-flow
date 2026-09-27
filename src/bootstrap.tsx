import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./main";
import type { Page } from "./ctx";
// Storage can be unavailable (private mode, blocked site data); selection then
// simply is not remembered.
const remembered = () => {
  try {
    return localStorage.getItem("kase-selected-issue") || "";
  } catch {
    return "";
  }
};
const remember = (id: string) => {
  try {
    localStorage.setItem("kase-selected-issue", id);
  } catch {}
};
function Platform() {
  const [view, setView] = useState<{ id: string; page: Page }>(() => ({
    id: remembered(),
    page: "issues",
  }));
  return (
    <App
      key={view.id}
      issueId={view.id}
      startPage={view.page}
      onSelect={(id) => {
        remember(id);
        setView({ id, page: "overview" });
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Platform />
  </React.StrictMode>,
);
