import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useExternalLinkTargets } from "@/lib/externalLinks";
import { NotFoundPage } from "@/pages/public/NotFoundPage";
import { QuotexContactPage } from "@/pages/public/QuotexContactPage";
import { QuotexHomePage } from "@/pages/public/QuotexHomePage";

const TransactionSitePage = lazy(() =>
  import("@/pages/transactions/TransactionSitePage").then((m) => ({ default: m.TransactionSitePage }))
);
const CheckoutRemoteSignPage = lazy(() =>
  import("@/pages/transactions/TransactionSitePage").then((m) => ({ default: m.CheckoutRemoteSignPage }))
);

function CheckoutLoading() {
  return (
    <div className="min-h-screen bg-ink-950 p-6 text-white">
      <div className="mx-auto mt-24 max-w-md rounded-lg border border-white/10 bg-white/5 px-5 py-4">
        Loading checkout...
      </div>
    </div>
  );
}

export function CheckoutApp() {
  useExternalLinkTargets();

  return (
    <Routes>
      <Route path="/" element={<QuotexHomePage />} />
      <Route
        path="/checkout"
        element={
          <Suspense fallback={<CheckoutLoading />}>
            <TransactionSitePage />
          </Suspense>
        }
      />
      <Route
        path="/checkout/sign/:packetId"
        element={
          <Suspense fallback={<CheckoutLoading />}>
            <CheckoutRemoteSignPage />
          </Suspense>
        }
      />
      <Route path="/contact" element={<QuotexContactPage />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
