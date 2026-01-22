/**
 * Widget window entry point.
 *
 * This is mounted in a separate Tauri window for the always-on-top timer widget.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { Widget } from "./components/Widget";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Widget />
  </React.StrictMode>,
);
