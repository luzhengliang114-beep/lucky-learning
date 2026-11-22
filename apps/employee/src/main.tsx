import React from "react";
import { createRoot } from "react-dom/client";
import { applyBrandToDocument } from "@open-training/shared";
import { App } from "./App";
import "./styles.css";

applyBrandToDocument("employee");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
