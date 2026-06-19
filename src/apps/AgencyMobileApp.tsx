import { useEffect } from "react";
import type { MouseEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Building2, LogIn, Sparkles } from "lucide-react";
import { CustomerLayout } from "@/components/layout/CustomerLayout";
import { QuotexMark } from "@/components/layout/Logo";
import { RequireRole } from "@/components/layout/RequireRole";
import { CustomerLoginPage } from "@/pages/auth/CustomerLoginPage";
import { CustomerSignupPage } from "@/pages/auth/CustomerSignupPage";
import { ClientQuestionnairePage } from "@/pages/customer/ClientQuestionnairePage";
import { CustomerAssetPage } from "@/pages/customer/CustomerAssetPage";
import { CustomerAssetsPage } from "@/pages/customer/CustomerAssetsPage";
import { CustomerClaimsPage } from "@/pages/customer/CustomerClaimsPage";
import { CustomerDashboard } from "@/pages/customer/CustomerDashboard";
import { CustomerDocumentsPage } from "@/pages/customer/CustomerDocumentsPage";
import { CustomerPoliciesPage } from "@/pages/customer/CustomerPoliciesPage";
import { CustomerPolicyPage } from "@/pages/customer/CustomerPolicyPage";
import { CustomerSettingsPage } from "@/pages/customer/CustomerSettingsPage";
import { QuoteFlowPage } from "@/pages/customer/QuoteFlowPage";
import { ContactPage } from "@/pages/public/ContactPage";
import { MarketingSmartContactPage } from "@/pages/public/MarketingSmartContactPage";
import { useAuth } from "@/lib/auth";
import { useDemoNotice } from "@/lib/demo";
import { useTenant } from "@/lib/tenant";

export function AgencyMobileApp() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const showDemoNotice = useDemoNotice();
  const appBase = pathname === "/agency-app" || pathname.startsWith("/agency-app/")
    ? "/agency-app"
    : pathname === "/app" || pathname.startsWith("/app/")
      ? "/app"
      : "";
  const appPath = (path: string) => (appBase ? (path === "/" ? appBase : `${appBase}${path}`) : path);
  const routePath = (path: string) => (path === "/" ? "" : path.replace(/^\//, ""));
  const phoneInternalRoutes = [
    "/",
    "/customer",
    "/login",
    "/signup",
    "/quote",
    "/contact",
  ];

  useEffect(() => {
    document.documentElement.classList.add("agency-mobile-document");
    return () => {
      document.documentElement.classList.remove("agency-mobile-document");
    };
  }, []);

  function keepInternalLinksInsidePhone(event: MouseEvent<HTMLDivElement>) {
    if (!appBase || event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.hasAttribute("download")) return;
    const rawHref = anchor.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) {
      return;
    }
    if (rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
      event.preventDefault();
      showDemoNotice({
        feature: rawHref.startsWith("tel:") ? "Phone link" : "Email link",
        title: "This stays inside the demo app",
        body: "Phone and email links are disabled here so the demo app cannot open anything outside the phone frame.",
      });
      return;
    }
    const url = new URL(rawHref, window.location.href);
    if (url.origin !== window.location.origin) {
      event.preventDefault();
      showDemoNotice({
        feature: "External link",
        title: "This stays inside the demo app",
        body: "Use the back button in the top-left corner to leave the demo. Links inside the phone are kept inside the app demo.",
      });
      return;
    }
    if (url.pathname.startsWith(appBase)) return;
    if (!phoneInternalRoutes.some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`))) {
      return;
    }
    event.preventDefault();
    navigate(appPath(`${url.pathname}${url.search}${url.hash}`));
  }

  return (
    <div
      className="flex h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(179,143,61,0.24),transparent_32%),linear-gradient(135deg,#181611_0%,#050505_100%)] px-3 pb-3 pt-16 text-ink-950 md:px-4 md:pb-4 md:pt-20"
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[430px] flex-col overflow-hidden rounded-[34px] border border-white/18 bg-[#f8f5ef] shadow-[0_28px_100px_rgba(0,0,0,0.55)] md:max-h-[900px]">
        <div className="flex items-center justify-between border-b border-ink-100 bg-[#11100c] px-5 py-3 text-[11px] font-semibold text-white/70">
          <span>9:41</span>
          <span className="h-5 w-24 rounded-full bg-black/80" aria-hidden="true" />
          <span>100%</span>
        </div>
        <div
          className="agency-mobile-frame relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-[#f8f5ef]"
          onClickCapture={keepInternalLinksInsidePhone}
        >
          <Routes>
            <Route index element={<QuotexAppHome appPath={appPath} />} />
            <Route path={routePath("/login")} element={<CustomerLoginPage />} />
            <Route path={routePath("/signup")} element={<CustomerSignupPage />} />
            <Route path={routePath("/marketing/contact")} element={<MarketingSmartContactPage />} />
            <Route
              path={routePath("/quote/start")}
              element={
                <RequireRole roles={["customer"]} redirectTo={appPath("/login")}>
                  <Navigate to={appPath("/customer/quote/new")} replace />
                </RequireRole>
              }
            />
            <Route
              path={routePath("/contact")}
              element={
                <RequireRole roles={["customer"]} redirectTo={appPath("/login")}>
                  <ContactPage />
                </RequireRole>
              }
            />

            <Route
              element={
                <RequireRole roles={["customer"]} redirectTo={appPath("/login")}>
                  <CustomerLayout />
                </RequireRole>
              }
            >
              <Route path={routePath("/customer")} element={<CustomerDashboard />} />
              <Route path={routePath("/customer/policies")} element={<CustomerPoliciesPage />} />
              <Route path={routePath("/customer/policies/:policyId")} element={<CustomerPolicyPage />} />
              <Route path={routePath("/customer/assets")} element={<CustomerAssetsPage />} />
              <Route path={routePath("/customer/assets/:assetId")} element={<CustomerAssetPage />} />
              <Route path={routePath("/customer/documents")} element={<CustomerDocumentsPage />} />
              <Route path={routePath("/customer/claims")} element={<CustomerClaimsPage />} />
              <Route path={routePath("/customer/settings")} element={<CustomerSettingsPage />} />
              <Route path={routePath("/customer/quote/new")} element={<QuoteFlowPage />} />
              <Route path={routePath("/customer/questionnaire/:sessionId")} element={<ClientQuestionnairePage />} />
            </Route>

            <Route path={routePath("/services")} element={<Navigate to={appPath("/")} replace />} />
            <Route path={routePath("/private-client")} element={<Navigate to={appPath("/")} replace />} />
            <Route path={routePath("/about")} element={<Navigate to={appPath("/")} replace />} />
            <Route path={routePath("/software")} element={<Navigate to={appPath("/")} replace />} />
            <Route path="*" element={<Navigate to={appPath("/")} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function QuotexAppHome({ appPath }: { appPath: (path: string) => string }) {
  const { user } = useAuth();
  const { agency } = useTenant();
  const signedInCustomer = user?.role === "customer";

  return (
    <main className="flex min-h-full flex-col px-5 py-5">
      <header className="flex items-center gap-3">
        <QuotexMark className="h-12 w-12 border border-ink-200 bg-black shadow-sm" letterClassName="text-[30px] text-white" />
        <div className="min-w-0">
          <div className="font-display text-2xl leading-none text-ink-950">Quotex</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-700">
            Client app
          </div>
        </div>
      </header>

      <section className="mt-6 rounded-[24px] border border-gold-200 bg-white p-4 shadow-[0_18px_48px_rgba(39,32,17,0.12)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-[11px] font-semibold text-gold-800">
          <Building2 className="h-3.5 w-3.5" />
          Secure client access
        </div>
        <h1 className="mt-4 font-display text-3xl leading-[1.02] text-ink-950">
          {signedInCustomer ? "Your client actions are ready." : "Sign in before opening agency tools."}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-600">
          {signedInCustomer
            ? "Your agency context is verified. You can open your portal, start a quote, or contact your agency from here."
            : "Sign in or create an account, choose your agency and branch when applicable, then open your portal and quote tools."}
        </p>
        {signedInCustomer && agency && (
          <div className="mt-4 rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
              Verified agency
            </div>
            <div className="mt-1 font-semibold text-ink-900">{agency.name}</div>
          </div>
        )}
      </section>

      {signedInCustomer ? (
        <section className="mt-4 grid gap-3">
          <Link to={appPath("/customer")} className="flex items-center justify-between rounded-2xl bg-black px-5 py-4 text-base font-semibold text-white shadow-sm">
            <span className="flex items-center gap-3">
              <LogIn className="h-5 w-5" />
              Go to my portal
            </span>
            <ArrowRight className="h-5 w-5" />
          </Link>
          <Link to={appPath("/customer/quote/new")} className="flex items-center justify-between rounded-2xl bg-gold-700 px-5 py-4 text-base font-semibold text-white shadow-sm">
            <span className="flex items-center gap-3">
              <Sparkles className="h-5 w-5" />
              Start a quote
            </span>
            <ArrowRight className="h-5 w-5" />
          </Link>
          <Link to={appPath("/contact")} className="flex items-center justify-between rounded-2xl border border-ink-200 bg-white px-5 py-4 text-base font-semibold text-ink-950 shadow-sm">
            <span className="flex items-center gap-3">
              <Building2 className="h-5 w-5" />
              Contact my agency
            </span>
            <ArrowRight className="h-5 w-5" />
          </Link>
        </section>
      ) : (
        <section className="mt-4 grid gap-3">
          <Link to={appPath("/login")} className="flex items-center justify-between rounded-2xl bg-black px-5 py-4 text-base font-semibold text-white shadow-sm">
            <span className="flex items-center gap-3">
              <LogIn className="h-5 w-5" />
              Sign in with Google or email
            </span>
            <ArrowRight className="h-5 w-5" />
          </Link>
          <Link to={appPath("/signup")} className="flex items-center justify-between rounded-2xl border border-ink-200 bg-white px-5 py-4 text-base font-semibold text-ink-950 shadow-sm">
            <span className="flex items-center gap-3">
              <Building2 className="h-5 w-5" />
              Create Quotex account
            </span>
            <ArrowRight className="h-5 w-5" />
          </Link>
          <div className="rounded-2xl border border-ink-100 bg-white/70 px-4 py-2.5 text-xs leading-relaxed text-ink-500">
            Portal, quote, and agency contact tools unlock after customer sign-in.
          </div>
        </section>
      )}
    </main>
  );
}
