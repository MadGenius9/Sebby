import React from "react";
import { createRoot } from "react-dom/client";
import { AppearanceProvider } from "./Appearance";
import { App } from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppearanceProvider>
      <App />
    </AppearanceProvider>
  </React.StrictMode>,
);
