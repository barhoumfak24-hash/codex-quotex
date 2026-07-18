import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { AuthShell } from "./AuthShell";
import { authFailureMessage, useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { getAppSurface, toAppRoute, toSurfaceRoute } from "@/lib/appSurface";

// Version-stamp the wording so audit trails can later say "consent
// was captured against terms v1.0". Bump on any material change.
const TERMS_VERSION = "1.0";

export function CustomerSignupPage() {
  const { agency, setAgencyId } = useTenant();
  const { registerCustomer } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirmPassword: "" });
  const activeAgencies = api.agencies.list().filter((item) => item.active);
  const [selectedAgencyId, setSelectedAgencyId] = useState(
    () => agency?.id ?? activeAgencies[0]?.id ?? "agency_palmcoast"
  );
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedAgency =
    activeAgencies.find((item) => item.id === selectedAgencyId) ?? activeAgencies[0] ?? agency;
  const agencyBranches = selectedAgency ? api.branches.listByAgency(selectedAgency.id) : [];
  const agencyName = selectedAgency?.name ?? "the agency";
  const isAppSurface = getAppSurface() === "agencyApp";
  const surfaceRoute = (path: string) =>
    isAppSurface ? toAppRoute(path) : toSurfaceRoute(path, location.pathname);

  const selectAgency = (id: string) => {
    setSelectedAgencyId(id);
    setSelectedBranchId("");
    setAgencyId(id);
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle={selectedAgency ? `For clients of ${selectedAgency.name}` : "For private client coverage"}
      footer={
        <>
          Already have an account?{" "}
          <Link
            className="text-ink-900 underline hover:text-gold-600"
            to={surfaceRoute("/login")}
            onClick={() => setAgencyId(selectedAgencyId)}
          >
            Sign in
          </Link>
        </>
      }
    >
      <div className="mb-4">
        <Disclaimer>
          Use your legal name and current contact information. Your agency uses this information to
          verify portal access, route requests, and prepare insurance documents.
        </Disclaimer>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting) return;
          setError(null);
          setAgencyId(selectedAgencyId);
          if (!selectedAgency) {
            setError("No active agency tenant.");
            return;
          }
          if (!identityConfirmed) {
            setError(
              "Identity confirmation is required before opening the Quotex client app."
            );
            return;
          }
          if (!ageConfirmed) {
            setError("Age confirmation is required before creating a client portal account.");
            return;
          }
          if (!consent) {
            setError(
              "Consent is required to continue. Please agree to the Terms and Conditions and email communications before requesting a quote."
            );
            return;
          }
          if (form.password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
          }
          if (form.password !== form.confirmPassword) {
            setError("Passwords do not match.");
            return;
          }
          setSubmitting(true);
          const result = await registerCustomer({
            tenantId: selectedAgency.id,
            branchId: selectedBranchId || undefined,
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim() || undefined,
            password: form.password,
          });
          if (!result.ok) {
            setError(authFailureMessage(result.reason, "customer"));
            setSubmitting(false);
            return;
          }
          const now = new Date().toISOString();
          const existingCustomer = api.customers.byUserId(result.user.id);
          const customer = existingCustomer
            ? api.customers.update(existingCustomer.id, {
                branchId: selectedBranchId || existingCustomer.branchId,
                marketingOptInEmail: true,
                termsAcceptedAt: now,
                termsVersion: TERMS_VERSION,
                emailConsentAt: now,
              })
            : api.customers.create({
                tenantId: selectedAgency.id,
                userId: result.user.id,
                email: result.user.email,
                name: result.user.name,
                phone: form.phone.trim() || undefined,
                branchId: selectedBranchId || undefined,
                marketingOptInEmail: true,
                marketingOptInSms: false,
                termsAcceptedAt: now,
                termsVersion: TERMS_VERSION,
                smsConsentAt: undefined,
                emailConsentAt: now,
              });
          if (!customer) {
            setError("Your secure account was created, but the customer profile could not be loaded. Sign in to continue.");
            setSubmitting(false);
            return;
          }
          // Internal audit event so agency staff have a non-mutable
          // record of the consent capture for CAN-SPAM
          // compliance purposes.
          api.status.create({
            tenantId: selectedAgency.id,
            source: "customer",
            message: `Customer ${form.name} accepted Terms v${TERMS_VERSION}, confirmed identity, and granted email consent during signup${
              selectedBranchId
                ? ` for ${api.branches.listByAgency(selectedAgency.id).find((branch) => branch.id === selectedBranchId)?.name ?? "selected branch"}`
                : ""
            }.`,
            visibility: "internal",
            customerId: customer.id,
            createdById: result.user.id,
          });
          setSubmitting(false);
          nav(isAppSurface ? surfaceRoute("/") : surfaceRoute("/customer/quote/new"), { replace: true });
        }}
        className="space-y-3"
      >
        <div className="rounded-lg border border-ink-200 bg-white p-3">
          <label className="label" htmlFor="signup-agency">
            Agency
          </label>
          <select
            id="signup-agency"
            className="input"
            value={selectedAgencyId}
            onChange={(e) => selectAgency(e.target.value)}
          >
            {activeAgencies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {agencyBranches.length > 0 && (
            <div className="mt-3">
              <label className="label" htmlFor="signup-branch">
                Branch
              </label>
              <select
                id="signup-branch"
                className="input"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
              >
                <option value="">Headquarters / main office</option>
                {agencyBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div>
          <label className="label">Full name</label>
          <input
            className="input"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            className="input"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Best phone number"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              type="password"
              className="input"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="signup-confirm-password">Confirm password</label>
            <input
              id="signup-confirm-password"
              type="password"
              className="input"
              required
              minLength={8}
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-gold-200 bg-gold-50/60 p-3 mt-2 cursor-pointer hover:bg-gold-50 transition-colors">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold-500"
            checked={identityConfirmed}
            onChange={(e) => setIdentityConfirmed(e.target.checked)}
          />
          <span className="text-xs text-ink-700 leading-relaxed">
            I confirm this account is for me and my identity information matches the
            agency records I am trying to access. Quotex may require a one-time code,
            staff approval, or identity verification before protected records are shown.
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-md border border-ink-200 p-3 mt-2 cursor-pointer hover:bg-ink-50/40 transition-colors">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold-500"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            aria-describedby="age-confirmation-text"
          />
          <span id="age-confirmation-text" className="text-xs text-ink-700 leading-relaxed">
            I confirm I am at least 18 years old and authorized to request insurance
            information for this account or household.
          </span>
        </label>

        {/* Required Terms + email consent checkbox. The "Create
            account" button below stays disabled until this is checked. */}
        <label className="flex items-start gap-3 rounded-md border border-ink-200 p-3 mt-2 cursor-pointer hover:bg-ink-50/40 transition-colors">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold-500"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-describedby="consent-text"
          />
          <span id="consent-text" className="text-xs text-ink-700 leading-relaxed">
            By checking this box I agree to the{" "}
            <Link
              className="font-semibold text-ink-900 underline underline-offset-2"
              to={toSurfaceRoute("/terms", location.pathname)}
            >
              Terms and Conditions
            </Link>{" "}
            and acknowledge the{" "}
            <Link
              className="font-semibold text-ink-900 underline underline-offset-2"
              to={toSurfaceRoute("/privacy", location.pathname)}
            >
              Privacy Policy
            </Link>{" "}
            and consent to
            receive <strong className="text-ink-900">emails</strong> from {agencyName} regarding my
            quote and ongoing communications. I can use the unsubscribe link in any email to opt out at any time.
          </span>
        </label>

        {error && (
          <div role="alert" className="text-xs text-rose-600 leading-relaxed">
            {error}
          </div>
        )}
        <button
          className="btn-primary w-full"
          type="submit"
          disabled={submitting || !identityConfirmed || !ageConfirmed || !consent}
          aria-disabled={submitting || !identityConfirmed || !ageConfirmed || !consent}
          title={
            identityConfirmed && ageConfirmed && consent
              ? undefined
              : "Identity, age, and communications consent are required to continue."
          }
        >
          {submitting ? "Creating account..." : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
