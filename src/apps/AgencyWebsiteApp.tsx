import { Navigate, Route, Routes } from "react-router-dom";
import { CustomerLayout } from "@/components/layout/CustomerLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { RequireRole } from "@/components/layout/RequireRole";
import { CustomerLoginPage } from "@/pages/auth/CustomerLoginPage";
import { CustomerSignupPage } from "@/pages/auth/CustomerSignupPage";
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
import { AboutPage } from "@/pages/public/AboutPage";
import { ContactPage } from "@/pages/public/ContactPage";
import { HomePage } from "@/pages/public/HomePage";
import { MarketingSmartContactPage } from "@/pages/public/MarketingSmartContactPage";
import { NotFoundPage } from "@/pages/public/NotFoundPage";
import { PrivateClientPage } from "@/pages/public/PrivateClientPage";
import { PrivacyPage, TermsPage } from "@/pages/public/LegalPages";
import { ServicesPage } from "@/pages/public/ServicesPage";

export function AgencyWebsiteApp() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/private-client" element={<PrivateClientPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Route>

      <Route path="/login" element={<CustomerLoginPage />} />
      <Route path="/signup" element={<CustomerSignupPage />} />
      <Route path="/quote/start" element={<QuoteStartGate />} />
      <Route path="/marketing/contact" element={<MarketingSmartContactPage />} />
      <Route path="/app" element={<Navigate to="/login" replace />} />

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

      <Route path="/software" element={<Navigate to="/404" replace />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
