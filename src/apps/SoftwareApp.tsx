import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { EmployeeLayout } from "@/components/layout/EmployeeLayout";
import { MasterLayout } from "@/components/layout/MasterLayout";
import { RequireProfile } from "@/components/layout/RequireProfile";
import { RequireRole } from "@/components/layout/RequireRole";

const lazyPage = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K
) => lazy(() => loader().then((module) => ({ default: module[exportName] as React.ComponentType })));

function PortalLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8 text-ink-600">
      Opening workspace...
    </div>
  );
}

const EmployeeLoginPage = lazyPage(() => import("@/pages/auth/EmployeeLoginPage"), "EmployeeLoginPage");
const MasterLoginPage = lazyPage(() => import("@/pages/auth/MasterLoginPage"), "MasterLoginPage");
const NotFoundPage = lazyPage(() => import("@/pages/public/NotFoundPage"), "NotFoundPage");
const SoftwareEntryPage = lazyPage(() => import("@/pages/software/SoftwareEntryPage"), "SoftwareEntryPage");

const AgencySettingsPage = lazyPage(() => import("@/pages/employee/AgencySettingsPage"), "AgencySettingsPage");
const AnalyticsPage = lazyPage(() => import("@/pages/employee/AnalyticsPage"), "AnalyticsPage");
const EmployeeCalendarPage = lazyPage(() => import("@/pages/employee/EmployeeCalendarPage"), "EmployeeCalendarPage");
const CarrierRecommendationsPage = lazyPage(
  () => import("@/pages/employee/CarrierRecommendationsPage"),
  "CarrierRecommendationsPage"
);
const ClientDetailPage = lazyPage(() => import("@/pages/employee/ClientDetailPage"), "ClientDetailPage");
const ClientsPage = lazyPage(() => import("@/pages/employee/ClientsPage"), "ClientsPage");
const DocumentReviewPage = lazyPage(() => import("@/pages/employee/DocumentReviewPage"), "DocumentReviewPage");
const EmployeeArchivePage = lazyPage(() => import("@/pages/employee/EmployeeArchivePage"), "EmployeeArchivePage");
const EmployeeAssetPage = lazyPage(() => import("@/pages/employee/EmployeeAssetPage"), "EmployeeAssetPage");
const EmployeeAccountingPage = lazyPage(() => import("@/pages/employee/EmployeeAccountingPage"), "EmployeeAccountingPage");
const EmployeeAccountSettingsPage = lazyPage(
  () => import("@/pages/employee/EmployeeAccountSettingsPage"),
  "EmployeeAccountSettingsPage"
);
const EmployeeDashboard = lazyPage(() => import("@/pages/employee/EmployeeDashboard"), "EmployeeDashboard");
const EmployeeBillingDetailPage = lazyPage(
  () => import("@/pages/employee/EmployeeBillingDetailPage"),
  "EmployeeBillingDetailPage"
);
const EmployeeBillingPage = lazyPage(() => import("@/pages/employee/EmployeeBillingPage"), "EmployeeBillingPage");
const EmployeeClaimsPage = lazyPage(() => import("@/pages/employee/EmployeeClaimsPage"), "EmployeeClaimsPage");
const EmployeeHrPage = lazyPage(() => import("@/pages/employee/EmployeeHrPage"), "EmployeeHrPage");
const EmployeePoliciesPage = lazyPage(() => import("@/pages/employee/EmployeePoliciesPage"), "EmployeePoliciesPage");
const EmployeePolicyPage = lazyPage(() => import("@/pages/employee/EmployeePolicyPage"), "EmployeePolicyPage");
const EmployeeStatusUpdatesPage = lazyPage(
  () => import("@/pages/employee/EmployeeStatusUpdatesPage"),
  "EmployeeStatusUpdatesPage"
);
const EmployeeTrainingPage = lazyPage(() => import("@/pages/employee/EmployeeTrainingPage"), "EmployeeTrainingPage");
const EmployeeWelcomePage = lazyPage(() => import("@/pages/employee/EmployeeWelcomePage"), "EmployeeWelcomePage");
const MarketingActivityPage = lazyPage(() => import("@/pages/employee/MarketingActivityPage"), "MarketingActivityPage");
const MessagesPage = lazyPage(() => import("@/pages/employee/MessagesPage"), "MessagesPage");
const ProspectDetailPage = lazyPage(() => import("@/pages/employee/ProspectDetailPage"), "ProspectDetailPage");
const ProspectsPage = lazyPage(() => import("@/pages/employee/ProspectsPage"), "ProspectsPage");
const RenewalsPage = lazyPage(() => import("@/pages/employee/RenewalsPage"), "RenewalsPage");
const TasksPage = lazyPage(() => import("@/pages/employee/TasksPage"), "TasksPage");

const AgenciesPage = lazyPage(() => import("@/pages/master/AgenciesPage"), "AgenciesPage");
const AgencyDetailPage = lazyPage(() => import("@/pages/master/AgencyDetailPage"), "AgencyDetailPage");
const AiRulesPage = lazyPage(() => import("@/pages/master/AiRulesPage"), "AiRulesPage");
const BillingPage = lazyPage(() => import("@/pages/master/BillingPage"), "BillingPage");
const CarrierDetailPage = lazyPage(() => import("@/pages/master/CarrierDetailPage"), "CarrierDetailPage");
const CarrierLibraryPage = lazyPage(() => import("@/pages/master/CarrierLibraryPage"), "CarrierLibraryPage");
const CategoriesPage = lazyPage(() => import("@/pages/master/CategoriesPage"), "CategoriesPage");
const CategoryDetailPage = lazyPage(() => import("@/pages/master/CategoryDetailPage"), "CategoryDetailPage");
const DataToolsPage = lazyPage(() => import("@/pages/master/DataToolsPage"), "DataToolsPage");
const ESignedDocumentsPage = lazyPage(() => import("@/pages/master/ESignedDocumentsPage"), "ESignedDocumentsPage");
const MasterDashboard = lazyPage(() => import("@/pages/master/MasterDashboard"), "MasterDashboard");
const MasterActivitiesPage = lazyPage(() => import("@/pages/master/MasterActivitiesPage"), "MasterActivitiesPage");
const MasterPlanBuilderPage = lazyPage(() => import("@/pages/master/MasterPlanBuilderPage"), "MasterPlanBuilderPage");
const MasterRenewalsPage = lazyPage(() => import("@/pages/master/MasterRenewalsPage"), "MasterRenewalsPage");
const MasterUsersPage = lazyPage(() => import("@/pages/master/MasterUsersPage"), "MasterUsersPage");
const PlatformSettingsPage = lazyPage(() => import("@/pages/master/PlatformSettingsPage"), "PlatformSettingsPage");
const TrainingVideosPage = lazyPage(() => import("@/pages/master/TrainingVideosPage"), "TrainingVideosPage");
const UsageAnalyticsPage = lazyPage(() => import("@/pages/master/UsageAnalyticsPage"), "UsageAnalyticsPage");
const CheckoutRemoteSignPage = lazyPage(
  () => import("@/pages/transactions/TransactionSitePage"),
  "CheckoutRemoteSignPage"
);

export function SoftwareApp() {
  return (
    <Suspense fallback={<PortalLoading />}>
      <Routes>
        <Route path="/" element={<SoftwareEntryPage />} />
        <Route path="/software" element={<SoftwareEntryPage />} />
        <Route path="/login" element={<Navigate to="/employee/login" replace />} />
        <Route path="/signup" element={<Navigate to="/employee/login" replace />} />
        <Route path="/employee/login" element={<EmployeeLoginPage />} />
        <Route path="/master/login" element={<MasterLoginPage />} />
        <Route path="/checkout/sign/:packetId" element={<CheckoutRemoteSignPage />} />

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
    </Suspense>
  );
}
