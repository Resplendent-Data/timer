import React from "react";
import ReactDOM from "react-dom/client";
import { Widget } from "./features/widget/Widget";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Widget />
  </React.StrictMode>
);
