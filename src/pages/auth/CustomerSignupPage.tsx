import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { AuthShell } from "./AuthShell";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { Disclaimer } from "@/components/ui/Disclaimer";

// Version-stamp the wording so audit trails can later say "consent
// was captured against terms v1.0". Bump on any material change.
const TERMS_VERSION = "1.0";

export function CustomerSignupPage() {
  const { agency } = useTenant();
  const { signInWithEmail } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agencyName = agency?.name ?? "the agency";

  return (
    <AuthShell
      title="Create your account"
      subtitle={agency ? `For clients of ${agency.name}` : "For private client coverage"}
      footer={
        <>
          Already have an account?{" "}
          <Link className="text-ink-900 underline hover:text-gold-600" to="/login">
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
          if (!agency) {
            setError("No active agency tenant.");
            return;
          }
          if (!consent) {
            setError(
              "Consent is required to continue. Please agree to the Terms and Conditions and SMS + email communications before requesting a quote."
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
            tenantId: agency.id,
            email: form.email,
            name: form.name,
            phone: form.phone,
          });
          const customer = api.customers.create({
            tenantId: agency.id,
            userId: user.id,
            email: form.email,
            name: form.name,
            phone: form.phone,
            marketingOptInEmail: true,
            marketingOptInSms: true,
            // Compliance trail — immutable evidence of when consent
            // was captured + the version of the wording it was
            // captured against.
            termsAcceptedAt: now,
            termsVersion: TERMS_VERSION,
            smsConsentAt: now,
            emailConsentAt: now,
          });
          // Internal audit event so agency staff have a non-mutable
          // record of the consent capture for TCPA / CAN-SPAM
          // compliance purposes.
          api.status.create({
            tenantId: agency.id,
            source: "customer",
            message: `Customer ${form.name} accepted Terms v${TERMS_VERSION} and granted SMS + email consent during signup.`,
            visibility: "internal",
            customerId: customer.id,
            createdById: user.id,
          });
          signInWithEmail(form.email);
          nav("/customer/quote/new");
        }}
        className="space-y-3"
      >
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
            placeholder="Required for SMS consent"
          />
        </div>

        {/* Required Terms + SMS/email consent checkbox. The "Create
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
            receive <strong className="text-ink-900">SMS text messages</strong> and{" "}
            <strong className="text-ink-900">emails</strong> from {agencyName} regarding my
            quote and ongoing communications. Message and data rates may apply. Reply{" "}
            <code className="text-[10px] px-1 py-0.5 rounded bg-ink-100 text-ink-700">STOP</code>{" "}
            to any SMS or use the unsubscribe link in any email to opt out at any time.
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
          disabled={!consent}
          aria-disabled={!consent}
          title={
            consent
              ? undefined
              : "You must agree to the Terms and Conditions and SMS + email consent to continue."
          }
        >
          Create account
        </button>
      </form>
    </AuthShell>
  );
}