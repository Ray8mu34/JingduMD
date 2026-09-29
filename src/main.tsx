import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles.css";
import ReaderWorkspace from "./ReaderWorkspace";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ReaderWorkspace /></React.StrictMode>
);
