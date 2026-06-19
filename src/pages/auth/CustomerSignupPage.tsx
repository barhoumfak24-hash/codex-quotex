import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { AuthShell } from "./AuthShell";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { getAppSurface, toAppRoute, toSurfaceRoute } from "@/lib/appSurface";

// Version-stamp the wording so audit trails can later say "consent
// was captured against terms v1.0". Bump on any material change.
const TERMS_VERSION = "1.0";

export function CustomerSignupPage() {
  const { agency, setAgencyId } = useTenant();
  const { signInWithEmail } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const activeAgencies = api.agencies.list().filter((item) => item.active);
  const [selectedAgencyId, setSelectedAgencyId] = useState(
    () => agency?.id ?? activeAgencies[0]?.id ?? "agency_palmcoast"
  );
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          Demo environment — please use a fake name and a non-personal email. Do not enter real
          phone, address, or identity information.
        </Disclaimer>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
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
          if (!consent) {
            setError(
              "Consent is required to continue. Please agree to the Terms and Conditions and email communications before requesting a quote."
            );
            return;
          }
          if (api.users.byEmail(form.email)) {
            setError("An account with that email already exists.");
            return;
          }
          const now = new Date().toISOString();
          const user = api.users.create({
            role: "customer",
            tenantId: selectedAgency.id,
            email: form.email,
            name: form.name,
            phone: form.phone,
          });
          const customer = api.customers.create({
            tenantId: selectedAgency.id,
            userId: user.id,
            email: form.email,
            name: form.name,
            phone: form.phone,
            branchId: selectedBranchId || undefined,
            marketingOptInEmail: true,
            marketingOptInSms: false,
            // Compliance trail — immutable evidence of when consent
            // was captured + the version of the wording it was
            // captured against.
            termsAcceptedAt: now,
            termsVersion: TERMS_VERSION,
            smsConsentAt: undefined,
            emailConsentAt: now,
          });
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
            createdById: user.id,
          });
          signInWithEmail(form.email);
          nav(isAppSurface ? surfaceRoute("/") : surfaceRoute("/customer/quote/new"));
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

        <label className="flex items-start gap-3 rounded-md border border-gold-200 bg-gold-50/60 p-3 mt-2 cursor-pointer hover:bg-gold-50 transition-colors">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold-500"
            checked={identityConfirmed}
            onChange={(e) => setIdentityConfirmed(e.target.checked)}
          />
          <span className="text-xs text-ink-700 leading-relaxed">
            I confirm this account is for me and my identity information matches the
            agency records I am trying to access. Production can replace this demo
            confirmation with camera ID scan, one-time code, or staff approval.
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
            <strong className="text-ink-900">Terms and Conditions</strong> and consent to
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
          disabled={!identityConfirmed || !consent}
          aria-disabled={!identityConfirmed || !consent}
          title={
            identityConfirmed && consent
              ? undefined
              : "Identity confirmation and communications consent are required to continue."
          }
        >
          Create account
        </button>
      </form>
    </AuthShell>
  );
}
