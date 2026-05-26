import { Navigate, Route, Routes } from "react-router-dom";
import { PublicLayout } from "./components/layout/PublicLayout";
import { CustomerLayout } from "./components/layout/CustomerLayout";
import { EmployeeLayout } from "./components/layout/EmployeeLayout";
import { MasterLayout } from "./components/layout/MasterLayout";
import { RequireRole } from "./components/layout/RequireRole";
import { RequireProfile } from "./components/layout/RequireProfile";

// Public
import { HomePage } from "./pages/public/HomePage";
import { ServicesPage } from "./pages/public/ServicesPage";
import { PrivateClientPage } from "./pages/public/PrivateClientPage";
import { AboutPage } from "./pages/public/AboutPage";
import { ContactPage } from "./pages/public/ContactPage";

// Auth
import { CustomerLoginPage } from "./pages/auth/CustomerLoginPage";
import { CustomerSignupPage } from "./pages/auth/CustomerSignupPage";
import { EmployeeLoginPage } from "./pages/auth/EmployeeLoginPage";
import { MasterLoginPage } from "./pages/auth/MasterLoginPage";
import { QuoteStartGate } from "./pages/auth/QuoteStartGate";

// Customer
import { CustomerDashboard } from "./pages/customer/CustomerDashboard";
import { CustomerPoliciesPage } from "./pages/customer/CustomerPoliciesPage";
import { CustomerAssetsPage } from "./pages/customer/CustomerAssetsPage";
import { CustomerAssetPage } from "./pages/customer/CustomerAssetPage";
import { CustomerPolicyPage } from "./pages/customer/CustomerPolicyPage";
import { CustomerDocumentsPage } from "./pages/customer/CustomerDocumentsPage";
import { CustomerClaimsPage } from "./pages/customer/CustomerClaimsPage";
import { CustomerSettingsPage } from "./pages/customer/CustomerSettingsPage";
import { ClientQuestionnairePage } from "./pages/customer/ClientQuestionnairePage";
import { QuoteFlowPage } from "./pages/customer/QuoteFlowPage";

// Employee
import { EmployeeDashboard } from "./pages/employee/EmployeeDashboard";
import { ProspectsPage } from "./pages/employee/ProspectsPage";
import { ProspectDetailPage } from "./pages/employee/ProspectDetailPage";
import { ClientsPage } from "./pages/employee/ClientsPage";
import { ClientDetailPage } from "./pages/employee/ClientDetailPage";
import { EmployeeAssetPage } from "./pages/employee/EmployeeAssetPage";
import { EmployeePoliciesPage } from "./pages/employee/EmployeePoliciesPage";
import { EmployeePolicyPage } from "./pages/employee/EmployeePolicyPage";
import { RenewalsPage } from "./pages/employee/RenewalsPage";
import { EmployeeStatusUpdatesPage } from "./pages/employee/EmployeeStatusUpdatesPage";
import { EmployeeArchivePage } from "./pages/employee/EmployeeArchivePage";
import { DocumentReviewPage } from "./pages/employee/DocumentReviewPage";
import { MarketingActivityPage } from "./pages/employee/MarketingActivityPage";
import { MessagesPage } from "./pages/employee/MessagesPage";
import { TasksPage } from "./pages/employee/TasksPage";
import { AnalyticsPage } from "./pages/employee/AnalyticsPage";
import { CarrierRecommendationsPage } from "./pages/employee/CarrierRecommendationsPage";
import { AgencySettingsPage } from "./pages/employee/AgencySettingsPage";
import { EmployeeWelcomePage } from "./pages/employee/EmployeeWelcomePage";

// Master
import { MasterDashboard } from "./pages/master/MasterDashboard";
import { AgenciesPage } from "./pages/master/AgenciesPage";
import { AgencyDetailPage } from "./pages/master/AgencyDetailPage";
import { CarrierLibraryPage } from "./pages/master/CarrierLibraryPage";
import { CarrierDetailPage } from "./pages/master/CarrierDetailPage";
import { CategoryDetailPage } from "./pages/master/CategoryDetailPage";
import { BillingPage } from "./pages/master/BillingPage";
import { MasterUsersPage } from "./pages/master/MasterUsersPage";
import { AiRulesPage } from "./pages/master/AiRulesPage";
import { UsageAnalyticsPage } from "./pages/master/UsageAnalyticsPage";
import { DataToolsPage } from "./pages/master/DataToolsPage";
import { PlatformSettingsPage } from "./pages/master/PlatformSettingsPage";
import { CategoriesPage } from "./pages/master/CategoriesPage";

import { NotFoundPage } from "./pages/public/NotFoundPage";

export default function App() {
  return (
    <Routes>
      {/* Public site */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/private-client" element={<PrivateClientPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
      </Route>

      {/* Auth (no portal shell) */}
      <Route path="/login" element={<CustomerLoginPage />} />
      <Route path="/signup" element={<CustomerSignupPage />} />
      <Route path="/employee/login" element={<EmployeeLoginPage />} />
      <Route path="/master/login" element={<MasterLoginPage />} />
      <Route path="/quote/start" element={<QuoteStartGate />} />

      {/* Customer portal — role gated */}
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
        <Route
          path="/customer/questionnaire/:sessionId"
          element={<ClientQuestionnairePage />}
        />
      </Route>

      {/* Employee portal */}
      <Route
        element={
          <RequireRole roles={["agent", "manager"]} redirectTo="/employee/login">
            <RequireProfile completePath="/employee/welcome">
              <EmployeeLayout />
            </RequireProfile>
          </RequireRole>
        }
      >
        <Route path="/employee/welcome" element={<EmployeeWelcomePage />} />
        <Route path="/employee" element={<EmployeeDashboard />} />
        <Route path="/employee/prospects" element={<ProspectsPage />} />
        <Route path="/employee/prospects/:prospectId" element={<ProspectDetailPage />} />
        <Route path="/employee/clients" element={<ClientsPage />} />
        <Route path="/employee/clients/:customerId" element={<ClientDetailPage />} />
        <Route
          path="/employee/clients/:customerId/assets/:assetId"
          element={<EmployeeAssetPage />}
        />
        <Route path="/employee/policies" element={<EmployeePoliciesPage />} />
        <Route path="/employee/policies/:policyId" element={<EmployeePolicyPage />} />
        <Route path="/employee/renewals" element={<RenewalsPage />} />
        <Route path="/employee/status-updates" element={<EmployeeStatusUpdatesPage />} />
        <Route path="/employee/archive" element={<EmployeeArchivePage />} />
        <Route path="/employee/documents" element={<DocumentReviewPage />} />
        <Route path="/employee/marketing" element={<MarketingActivityPage />} />
        <Route path="/employee/tasks" element={<TasksPage />} />
        <Route path="/employee/messages" element={<MessagesPage />} />
        <Route path="/employee/carriers" element={<CarrierRecommendationsPage />} />
        <Route path="/employee/analytics" element={<AnalyticsPage />} />
        <Route path="/employee/settings" element={<AgencySettingsPage />} />
      </Route>

      {/* Master portal */}
      <Route
        element={
          <RequireRole roles={["master_admin"]} redirectTo="/master/login">
            <MasterLayout />
          </RequireRole>
        }
      >
        <Route path="/master" element={<MasterDashboard />} />
        <Route path="/master/agencies" element={<AgenciesPage />} />
        <Route path="/master/agencies/:agencyId" element={<AgencyDetailPage />} />
        <Route path="/master/carriers" element={<CarrierLibraryPage />} />
        <Route path="/master/carriers/:carrierId" element={<CarrierDetailPage />} />
        <Route path="/master/categories" element={<CategoriesPage />} />
        <Route path="/master/categories/:categoryId" element={<CategoryDetailPage />} />
        <Route path="/master/billing" element={<BillingPage />} />
        <Route path="/master/users" element={<MasterUsersPage />} />
        <Route path="/master/ai-rules" element={<AiRulesPage />} />
        <Route path="/master/analytics" element={<UsageAnalyticsPage />} />
        <Route path="/master/data" element={<DataToolsPage />} />
        <Route path="/master/settings" element={<PlatformSettingsPage />} />
      </Route>

      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}