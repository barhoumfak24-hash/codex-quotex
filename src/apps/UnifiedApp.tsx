import { ArrowLeft } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CustomerLayout } from "@/components/layout/CustomerLayout";
import { EmployeeLayout } from "@/components/layout/EmployeeLayout";
import { MasterLayout } from "@/components/layout/MasterLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { RequireProfile } from "@/components/layout/RequireProfile";
import { RequireRole } from "@/components/layout/RequireRole";

import { CustomerLoginPage } from "@/pages/auth/CustomerLoginPage";
import { CustomerSignupPage } from "@/pages/auth/CustomerSignupPage";
import { EmployeeLoginPage } from "@/pages/auth/EmployeeLoginPage";
import { MasterLoginPage } from "@/pages/auth/MasterLoginPage";
import { QuoteStartGate } from "@/pages/auth/QuoteStartGate";

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

import { AgencySettingsPage } from "@/pages/employee/AgencySettingsPage";
import { AnalyticsPage } from "@/pages/employee/AnalyticsPage";
import { EmployeeCalendarPage } from "@/pages/employee/EmployeeCalendarPage";
import { CarrierRecommendationsPage } from "@/pages/employee/CarrierRecommendationsPage";
import { ClientDetailPage } from "@/pages/employee/ClientDetailPage";
import { ClientsPage } from "@/pages/employee/ClientsPage";
import { DocumentReviewPage } from "@/pages/employee/DocumentReviewPage";
import { EmployeeArchivePage } from "@/pages/employee/EmployeeArchivePage";
import { EmployeeAssetPage } from "@/pages/employee/EmployeeAssetPage";
import { EmployeeAccountingPage } from "@/pages/employee/EmployeeAccountingPage";
import { EmployeeAccountSettingsPage } from "@/pages/employee/EmployeeAccountSettingsPage";
import { EmployeeDashboard } from "@/pages/employee/EmployeeDashboard";
import { EmployeeBillingDetailPage } from "@/pages/employee/EmployeeBillingDetailPage";
import { EmployeeBillingPage } from "@/pages/employee/EmployeeBillingPage";
import { EmployeeClaimsPage } from "@/pages/employee/EmployeeClaimsPage";
import { EmployeeHrPage } from "@/pages/employee/EmployeeHrPage";
import { EmployeePoliciesPage } from "@/pages/employee/EmployeePoliciesPage";
import { EmployeePolicyPage } from "@/pages/employee/EmployeePolicyPage";
import { EmployeeStatusUpdatesPage } from "@/pages/employee/EmployeeStatusUpdatesPage";
import { EmployeeTrainingPage } from "@/pages/employee/EmployeeTrainingPage";
import { EmployeeWelcomePage } from "@/pages/employee/EmployeeWelcomePage";
import { MarketingActivityPage } from "@/pages/employee/MarketingActivityPage";
import { MessagesPage } from "@/pages/employee/MessagesPage";
import { ProspectDetailPage } from "@/pages/employee/ProspectDetailPage";
import { ProspectsPage } from "@/pages/employee/ProspectsPage";
import { RenewalsPage } from "@/pages/employee/RenewalsPage";
import { TasksPage } from "@/pages/employee/TasksPage";

import { AgenciesPage } from "@/pages/master/AgenciesPage";
import { AgencyDetailPage } from "@/pages/master/AgencyDetailPage";
import { AiRulesPage } from "@/pages/master/AiRulesPage";
import { BillingPage } from "@/pages/master/BillingPage";
import { CarrierDetailPage } from "@/pages/master/CarrierDetailPage";
import { CarrierLibraryPage } from "@/pages/master/CarrierLibraryPage";
import { CategoriesPage } from "@/pages/master/CategoriesPage";
import { CategoryDetailPage } from "@/pages/master/CategoryDetailPage";
import { DataToolsPage } from "@/pages/master/DataToolsPage";
import { ESignedDocumentsPage } from "@/pages/master/ESignedDocumentsPage";
import { MasterDashboard } from "@/pages/master/MasterDashboard";
import { MasterActivitiesPage } from "@/pages/master/MasterActivitiesPage";
import { MasterLeadsPage } from "@/pages/master/MasterLeadsPage";
import { MasterPlanBuilderPage } from "@/pages/master/MasterPlanBuilderPage";
import { MasterRenewalsPage } from "@/pages/master/MasterRenewalsPage";
import { MasterUsersPage } from "@/pages/master/MasterUsersPage";
import { PlatformSettingsPage } from "@/pages/master/PlatformSettingsPage";
import { TrainingVideosPage } from "@/pages/master/TrainingVideosPage";
import { UsageAnalyticsPage } from "@/pages/master/UsageAnalyticsPage";

import { AboutPage } from "@/pages/public/AboutPage";
import { AgencyMobileApp } from "@/apps/AgencyMobileApp";
import { ContactPage } from "@/pages/public/ContactPage";
import { HomePage } from "@/pages/public/HomePage";
import { MarketingSmartContactPage } from "@/pages/public/MarketingSmartContactPage";
import { NotFoundPage } from "@/pages/public/NotFoundPage";
import { PrivateClientPage } from "@/pages/public/PrivateClientPage";
import { QuotexContactPage } from "@/pages/public/QuotexContactPage";
import { QuotexHomePage } from "@/pages/public/QuotexHomePage";
import { ServicesPage } from "@/pages/public/ServicesPage";
import { SoftwareEntryPage } from "@/pages/software/SoftwareEntryPage";
import { CheckoutRemoteSignPage, TransactionSitePage } from "@/pages/transactions/TransactionSitePage";
import { useDemoNotice } from "@/lib/demo";

export function UnifiedApp() {
  return (
    <>
      <DemoReturnButton />
      <DemoRouteSandbox>
        <Routes>
        <Route path="/" element={<QuotexHomePage />} />
        <Route path="/agency-app/*" element={<AgencyMobileApp />} />
        <Route path="/app/*" element={<AgencyMobileApp />} />
      <Route path="/checkout" element={<TransactionSitePage />} />
      <Route path="/checkout/sign/:packetId" element={<CheckoutRemoteSignPage />} />
      <Route path="/contact" element={<QuotexContactPage />} />
      <Route path="/marketing/contact" element={<MarketingSmartContactPage />} />

      <Route element={<PublicLayout />}>
        <Route path="/agency" element={<HomePage />} />
        <Route path="/agency/services" element={<ServicesPage />} />
        <Route path="/agency/private-client" element={<PrivateClientPage />} />
        <Route path="/agency/about" element={<AboutPage />} />
        <Route path="/agency/contact" element={<ContactPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/private-client" element={<PrivateClientPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Route>

      <Route path="/login" element={<CustomerLoginPage />} />
      <Route path="/signup" element={<CustomerSignupPage />} />
      <Route path="/agency/login" element={<CustomerLoginPage />} />
      <Route path="/agency/signup" element={<CustomerSignupPage />} />
      <Route path="/software" element={<SoftwareEntryPage />} />
      <Route path="/employee/login" element={<EmployeeLoginPage />} />
      <Route path="/master/login" element={<MasterLoginPage />} />
      <Route path="/quote/start" element={<QuoteStartGate />} />
      <Route path="/agency/quote/start" element={<QuoteStartGate />} />

      <Route
        element={
          <RequireRole roles={["customer"]} redirectTo="/login">
            <CustomerLayout />
          </RequireRole>
        }
      >
        <Route path="/customer" element={<CustomerDashboard />} />
        <Route path="/customer/policies" element={<CustomerPoliciesPage />} />
        <Route path="/customer/policies/:policyId" element={<CustomerPolicyPage />} />
        <Route path="/customer/assets" element={<CustomerAssetsPage />} />
        <Route path="/customer/assets/:assetId" element={<CustomerAssetPage />} />
        <Route path="/customer/documents" element={<CustomerDocumentsPage />} />
        <Route path="/customer/claims" element={<CustomerClaimsPage />} />
        <Route path="/customer/settings" element={<CustomerSettingsPage />} />
        <Route path="/customer/quote/new" element={<QuoteFlowPage />} />
        <Route path="/customer/questionnaire/:sessionId" element={<ClientQuestionnairePage />} />
      </Route>

      <Route
        element={
          <RequireRole roles={["customer"]} redirectTo="/agency/login">
            <CustomerLayout />
          </RequireRole>
        }
      >
        <Route path="/agency/customer" element={<CustomerDashboard />} />
        <Route path="/agency/customer/policies" element={<CustomerPoliciesPage />} />
        <Route path="/agency/customer/policies/:policyId" element={<CustomerPolicyPage />} />
        <Route path="/agency/customer/assets" element={<CustomerAssetsPage />} />
        <Route path="/agency/customer/assets/:assetId" element={<CustomerAssetPage />} />
        <Route path="/agency/customer/documents" element={<CustomerDocumentsPage />} />
        <Route path="/agency/customer/claims" element={<CustomerClaimsPage />} />
        <Route path="/agency/customer/settings" element={<CustomerSettingsPage />} />
        <Route path="/agency/customer/quote/new" element={<QuoteFlowPage />} />
        <Route path="/agency/customer/questionnaire/:sessionId" element={<ClientQuestionnairePage />} />
      </Route>

      <Route
        element={
          <RequireRole
            roles={["agent", "manager", "csr"]}
            redirectTo="/employee/login"
          >
            <RequireProfile completePath="/employee/welcome">
              <EmployeeLayout />
            </RequireProfile>
          </RequireRole>
        }
      >
        <Route path="/employee/welcome" element={<EmployeeWelcomePage />} />
        <Route path="/employee" element={<EmployeeDashboard />} />
        <Route path="/employee/calendar" element={<EmployeeCalendarPage />} />
        <Route path="/employee/prospects" element={<ProspectsPage />} />
        <Route path="/employee/prospects/:prospectId" element={<ProspectDetailPage />} />
        <Route path="/employee/clients" element={<ClientsPage />} />
        <Route path="/employee/clients/:customerId" element={<ClientDetailPage />} />
        <Route path="/employee/clients/:customerId/assets/:assetId" element={<EmployeeAssetPage />} />
        <Route path="/employee/policies" element={<EmployeePoliciesPage />} />
        <Route path="/employee/policies/:policyId" element={<EmployeePolicyPage />} />
        <Route path="/employee/claims" element={<EmployeeClaimsPage />} />
        <Route path="/employee/billing" element={<EmployeeBillingPage />} />
        <Route path="/employee/billing/:policyId" element={<EmployeeBillingDetailPage />} />
        <Route path="/employee/carrier-downloads" element={<Navigate to="/employee/renewals" replace />} />
        <Route path="/employee/renewals" element={<RenewalsPage />} />
        <Route path="/employee/status-updates" element={<EmployeeStatusUpdatesPage />} />
        <Route path="/employee/training" element={<EmployeeTrainingPage />} />
        <Route path="/employee/archive" element={<EmployeeArchivePage />} />
        <Route path="/employee/documents" element={<DocumentReviewPage />} />
        <Route path="/employee/marketing" element={<MarketingActivityPage />} />
        <Route path="/employee/tasks" element={<TasksPage />} />
        <Route path="/employee/messages" element={<MessagesPage />} />
        <Route path="/employee/carriers" element={<CarrierRecommendationsPage />} />
        <Route path="/employee/analytics" element={<AnalyticsPage />} />
        <Route path="/employee/accounting" element={<EmployeeAccountingPage />} />
        <Route path="/employee/hr" element={<EmployeeHrPage />} />
        <Route path="/employee/settings" element={<AgencySettingsPage />} />
        <Route path="/employee/account-settings" element={<EmployeeAccountSettingsPage />} />
      </Route>

      <Route
        element={
          <RequireRole roles={["master_admin"]} redirectTo="/master/login">
            <MasterLayout />
          </RequireRole>
        }
      >
        <Route path="/master" element={<MasterDashboard />} />
        <Route path="/master/leads" element={<MasterLeadsPage />} />
        <Route path="/master/agencies" element={<AgenciesPage />} />
        <Route path="/master/agencies/:agencyId" element={<AgencyDetailPage />} />
        <Route path="/master/carriers" element={<CarrierLibraryPage />} />
        <Route path="/master/carriers/:carrierId" element={<CarrierDetailPage />} />
        <Route path="/master/categories" element={<CategoriesPage />} />
        <Route path="/master/categories/:categoryId" element={<CategoryDetailPage />} />
        <Route path="/master/billing" element={<BillingPage />} />
        <Route path="/master/renewals" element={<MasterRenewalsPage />} />
        <Route path="/master/activities" element={<MasterActivitiesPage />} />
        <Route path="/master/build-plan" element={<MasterPlanBuilderPage />} />
        <Route path="/master/e-signed-documents" element={<ESignedDocumentsPage />} />
        <Route path="/master/users" element={<MasterUsersPage />} />
        <Route path="/master/training" element={<TrainingVideosPage />} />
        <Route path="/master/ai-rules" element={<AiRulesPage />} />
        <Route path="/master/analytics" element={<UsageAnalyticsPage />} />
        <Route path="/master/data" element={<DataToolsPage />} />
        <Route path="/master/settings" element={<PlatformSettingsPage />} />
      </Route>

      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </DemoRouteSandbox>
    </>
  );
}

function DemoRouteSandbox({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const showDemoNotice = useDemoNotice();
  const appBase =
    pathname === "/agency-app" || pathname.startsWith("/agency-app/")
      ? "/agency-app"
      : pathname === "/app" || pathname.startsWith("/app/")
        ? "/app"
        : "";
  const websiteBase = pathname === "/agency" || pathname.startsWith("/agency/") ? "/agency" : "";
  const activeBase = websiteBase || appBase;

  function showBlockedNotice(feature: string) {
    showDemoNotice({
      feature,
      title: "This stays inside the demo",
      body: "Use the back button in the top-left corner to leave this demo. Links and actions inside the demo are kept inside this same demo surface.",
    });
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!activeBase || event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.hasAttribute("download")) return;
    const rawHref = anchor.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) return;

    if (rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
      event.preventDefault();
      showBlockedNotice(rawHref.startsWith("tel:") ? "Phone link" : "Email link");
      return;
    }

    const url = new URL(rawHref, window.location.href);
    if (url.origin !== window.location.origin) {
      event.preventDefault();
      showBlockedNotice("External link");
      return;
    }

    if (url.pathname === activeBase || url.pathname.startsWith(`${activeBase}/`)) {
      return;
    }

    const allowedRoots = websiteBase
      ? ["/", "/services", "/private-client", "/about", "/contact", "/login", "/signup", "/quote", "/customer"]
      : ["/", "/customer", "/login", "/signup", "/quote", "/contact"];
    const canStayInsideDemo = allowedRoots.some(
      (root) => url.pathname === root || (root !== "/" && url.pathname.startsWith(`${root}/`))
    );

    event.preventDefault();
    if (!canStayInsideDemo) {
      showBlockedNotice("Demo navigation");
      return;
    }

    const targetPath = url.pathname === "/" ? activeBase : `${activeBase}${url.pathname}`;
    navigate(`${targetPath}${url.search}${url.hash}`);
  }

  return <div onClickCapture={handleClickCapture}>{children}</div>;
}

function DemoReturnButton() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const isDemoSurface =
    pathname === "/agency" ||
    pathname.startsWith("/agency/") ||
    pathname === "/agency-app" ||
    pathname.startsWith("/agency-app/") ||
    pathname === "/app" ||
    pathname.startsWith("/app/");

  if (searchParams.get("demoBack") !== "1" && !isDemoSurface) return null;

  return (
    <Link
      to="/?demoPicker=1"
      className="fixed left-4 top-4 z-[90] inline-flex min-h-11 items-center gap-2 rounded-md border border-white/25 bg-black px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-gold-300"
      aria-label="Back to demos"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to demos
    </Link>
  );
}
