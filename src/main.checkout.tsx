import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { CheckoutApp } from "./apps/CheckoutApp";
import { printBootDiagnostic } from "./lib/diag";
import "./index.css";

printBootDiagnostic();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <CheckoutApp />
    </BrowserRouter>
  </React.StrictMode>
);
