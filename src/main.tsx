import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { TenantProvider } from "./lib/tenant";
import { IntegrationNoticeProvider } from "./lib/integrationNotice";
import { printBootDiagnostic } from "./lib/diag";
import { initClientErrorTracking } from "./lib/errorTracking";
import "./index.css";

initClientErrorTracking();

// Visible in every deployed-app DevTools console — see src/lib/diag.ts.
printBootDiagnostic();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <IntegrationNoticeProvider>
        <AuthProvider>
          <TenantProvider>
            <App />
          </TenantProvider>
        </AuthProvider>
      </IntegrationNoticeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
