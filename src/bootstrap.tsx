import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./main";
function Platform() {
  const [view, setView] = useState(() => ({
    id: localStorage.getItem("kase-selected-issue") || "",
    page: 5,
  }));
  return (
    <App
      key={view.id}
      issueId={view.id}
      startPage={view.page}
      onSelect={(id) => {
        localStorage.setItem("kase-selected-issue", id);
        setView({ id, page: 0 });
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Platform />
  </React.StrictMode>,
);
