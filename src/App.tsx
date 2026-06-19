import { Suspense, lazy } from "react";
import { ArrowLeft } from "lucide-react";
import { getDemoExitHref } from "./lib/demoExit";
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

function LoadingSurface() {
  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 flex items-center justify-center p-6">
      <div className="flex items-center gap-4 rounded-lg border border-ink-100 bg-white px-5 py-4 shadow-soft">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-ink-900 font-display text-xl text-white">
          Q
        </div>
        <div>
          <p className="font-semibold">Loading Quotex</p>
          <p className="text-sm text-ink-500">Opening the software workspace...</p>
        </div>
      </div>
    </div>
  );
}

function DemoExitButton() {
  return (
    <a
      href={getDemoExitHref()}
      className="fixed left-5 top-5 z-[200] inline-flex items-center gap-2 rounded-full border border-gold-200 bg-gold-300 px-5 py-3 text-sm font-bold text-ink-950 shadow-[0_16px_40px_rgba(0,0,0,0.32)] transition hover:bg-gold-200"
    >
      <ArrowLeft className="h-4 w-4" />
      Exit demo
    </a>
  );
}

export default function App() {
  useExternalLinkTargets();

  if (surface === "website") {
    return (
      <>
        <DemoExitButton />
        <div className="min-h-screen bg-[#090807] px-4 pb-5 pt-20 md:px-8 md:pb-8 md:pt-24">
          <div className="mx-auto min-h-[calc(100vh-8rem)] max-w-[1500px] overflow-hidden rounded-[30px] border border-white/15 bg-white shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
            <Suspense fallback={<LoadingSurface />}>
              <SurfaceApp />
            </Suspense>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {surface === "agencyApp" && <DemoExitButton />}
      <Suspense fallback={<LoadingSurface />}>
        <SurfaceApp />
      </Suspense>
    </>
  );
}
