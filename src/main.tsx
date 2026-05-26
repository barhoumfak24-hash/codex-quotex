import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { TenantProvider } from "./lib/tenant";
import { DemoProvider } from "./lib/demo";
import { printBootDiagnostic } from "./lib/diag";
import "./index.css";

// Visible in every deployed-app DevTools console — see src/lib/diag.ts.
printBootDiagnostic();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <DemoProvider>
        <AuthProvider>
          <TenantProvider>
            <App />
          </TenantProvider>
        </AuthProvider>
      </DemoProvider>
    </BrowserRouter>
  </React.StrictMode>
);