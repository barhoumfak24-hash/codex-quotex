import { Suspense, lazy, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { QuotexMark, QuotexWordmark } from "./components/layout/Logo";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { useExternalLinkTargets } from "./lib/externalLinks";
import type { AppSurface } from "./lib/appSurface";

declare const __APP_SURFACE__: string | undefined;

function normalizeSurface(raw: string): AppSurface {
  const surface = raw.toLowerCase();
  if (surface === "software" || surface === "website") return surface;
  if (surface === "app" || surface === "agency-app" || surface === "agencyapp" || surface === "mobile-app") {
    return "agencyApp";
  }
  if (surface === "checkout" || surface === "transaction" || surface === "transactions") return "checkout";
  return "unified";
}

const rawSurface =
  typeof __APP_SURFACE__ === "string" && __APP_SURFACE__.trim()
    ? __APP_SURFACE__
    : "unified";
const surface = normalizeSurface(rawSurface);
const SurfaceApp =
  surface === "software"
    ? lazy(() => import("./apps/SoftwareApp").then((m) => ({ default: m.SoftwareApp })))
    : surface === "agencyApp"
      ? lazy(() => import("./apps/AgencyMobileApp").then((m) => ({ default: m.AgencyMobileApp })))
    : surface === "website"
      ? lazy(() => import("./apps/AgencyWebsiteApp").then((m) => ({ default: m.AgencyWebsiteApp })))
      : surface === "checkout"
        ? lazy(() => import("./apps/CheckoutApp").then((m) => ({ default: m.CheckoutApp })))
        : lazy(() => import("./apps/UnifiedApp").then((m) => ({ default: m.UnifiedApp })));

function reloadPage() {
  window.location.reload();
}

function LoadingBrand({ showRefresh = false }: { showRefresh?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={showRefresh ? "false" : "true"}
      aria-label="Loading Quotex"
      className="min-h-screen bg-ink-50 text-ink-900 flex items-center justify-center p-6"
    >
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-3">
          <QuotexMark size="xl" className="shadow-soft" />
          <QuotexWordmark className="text-3xl text-ink-950" />
        </div>
        {showRefresh && (
          <button type="button" className="btn-outline" onClick={reloadPage}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

function LoadingSurface() {
  const [showRefresh, setShowRefresh] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setShowRefresh(true), 8000);
    const showOfflineRefresh = () => setShowRefresh(true);

    window.addEventListener("offline", showOfflineRefresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("offline", showOfflineRefresh);
    };
  }, []);

  return <LoadingBrand showRefresh={showRefresh} />;
}

function LoadingFailureSurface() {
  return <LoadingBrand showRefresh />;
}

export default function App() {
  useExternalLinkTargets();

  const content = (
    <ErrorBoundary fallback={<LoadingFailureSurface />}>
      <Suspense fallback={<LoadingSurface />}>
        <SurfaceApp />
      </Suspense>
    </ErrorBoundary>
  );

  if (surface === "website") {
    return (
      <div className="min-h-screen bg-[#090807] px-4 py-5 md:px-8 md:py-8">
        <div className="mx-auto min-h-[calc(100vh-2.5rem)] max-w-[1500px] overflow-hidden rounded-[30px] border border-white/15 bg-white shadow-[0_28px_90px_rgba(0,0,0,0.48)] md:min-h-[calc(100vh-4rem)]">
          {content}
        </div>
      </div>
    );
  }

  return content;
}
