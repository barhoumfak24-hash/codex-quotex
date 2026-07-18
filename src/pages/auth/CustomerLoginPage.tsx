import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Building2, LoaderCircle } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { authFailureMessage, useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { getAppSurface, toAppRoute, toSurfaceRoute } from "@/lib/appSurface";

// Customer-only sign-in. Staff (agent, manager, master admin) sign-ins live
// in the public footer and at /employee/login and /master/login.
export function CustomerLoginPage() {
  const {
    signInCustomer,
    resetCustomerPassword,
  } = useAuth();
  const { agency, setAgencyId } = useTenant();
  const nav = useNavigate();
  const location = useLocation();
  const redirectFrom = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const isAppSurface = getAppSurface() === "agencyApp";
  const surfaceRoute = (path: string) =>
    isAppSurface ? toAppRoute(path) : toSurfaceRoute(path, location.pathname);
  const target = redirectFrom ? surfaceRoute(redirectFrom) : surfaceRoute("/customer");
  const activeAgencies = api.agencies.list().filter((item) => item.active);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedAgencyId, setSelectedAgencyId] = useState(
    () => agency?.id ?? activeAgencies[0]?.id ?? "agency_palmcoast"
  );
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const selectedAgency =
    activeAgencies.find((item) => item.id === selectedAgencyId) ?? activeAgencies[0] ?? agency;
  const agencyBranches = selectedAgency ? api.branches.listByAgency(selectedAgency.id) : [];

  const selectAgency = (id: string) => {
    setSelectedAgencyId(id);
    setSelectedBranchId("");
    setAgencyId(id);
  };

  const rememberBranchForUser = (signedUser: {
    id: string;
    role: string;
    name: string;
    email: string;
    phone?: string;
  }) => {
    if (!selectedBranchId || signedUser.role !== "customer" || !selectedAgency) return;
    const profile = api.customers.byUserId(signedUser.id);
    if (profile) {
      api.customers.update(profile.id, { branchId: selectedBranchId });
      return;
    }
    api.customers.create({
      tenantId: selectedAgency.id,
      userId: signedUser.id,
      name: signedUser.name,
      email: signedUser.email,
      phone: signedUser.phone,
      branchId: selectedBranchId,
      marketingOptInEmail: true,
      marketingOptInSms: false,
    });
  };

  return (
    <AuthShell
      title={isAppSurface ? "Quotex app sign-in" : "Customer sign-in"}
      subtitle={
        isAppSurface
          ? "Choose your agency, then access your client portal."
          : "Access your private client portfolio."
      }
      footer={
        <>
          New here?{" "}
          <Link
            to={surfaceRoute("/signup")}
            onClick={() => setAgencyId(selectedAgencyId)}
            className="text-ink-900 underline hover:text-gold-600"
          >
            Create an account
          </Link>
          {!isAppSurface && (
            <div className="mt-3 text-[11px] text-ink-400">
              Staff (agent, manager, master admin) sign-ins are in the footer below.
            </div>
          )}
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-ink-200 bg-white p-3">
        <label className="label flex items-center gap-2" htmlFor="agency">
          <Building2 className="h-4 w-4 text-gold-600" />
          Agency
        </label>
        <select
          id="agency"
          className="input mt-1"
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
            <label className="label" htmlFor="branch">
              Branch
            </label>
            <select
              id="branch"
              className="input mt-1"
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
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          The Quotex app is one client app. Your agency selection controls which
          customer portal opens after sign-in.
        </p>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting) return;
          setError(null);
          setSubmitting(true);
          try {
            setAgencyId(selectedAgencyId);
            const result = await signInCustomer(email.trim(), password, selectedAgencyId);
            if (!result.ok) {
              setError(authFailureMessage(result.reason, "customer"));
              return;
            }
            rememberBranchForUser(result.user);
            nav(target, { replace: true });
          } finally {
            setSubmitting(false);
          }
        }}
        className="space-y-3"
      >
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
          />
        </div>
        {error && <div className="text-xs text-rose-600">{error}</div>}
        <button type="submit" className="btn-primary flex w-full items-center justify-center gap-2" disabled={submitting}>
          {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {submitting ? "Signing in..." : "Sign in"}
        </button>
        <button
          type="button"
          className="text-xs text-ink-500 hover:text-ink-900 w-full text-right"
          onClick={() => setForgotOpen(true)}
        >
          Forgot password?
        </button>
      </form>

      <ForgotPasswordModal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        initialEmail={email}
        onReset={(input) => resetCustomerPassword(input, selectedAgencyId)}
      />
    </AuthShell>
  );
}

function ForgotPasswordModal({
  open,
  onClose,
  initialEmail,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  initialEmail: string;
  onReset: (email: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" } | { kind: "error"; message: string } | null>(null);

  function reset() {
    setEmail(initialEmail);
    setBusy(false);
    setResult(null);
  }

  async function submit() {
    setBusy(true);
    try {
      const out = await onReset(email.trim());
      if (!out.ok) {
        setResult({
          kind: "error",
          message: out.reason === "rate_limited"
            ? "Too many requests. Wait one minute and try again."
            : "Reset instructions could not be sent right now. Please try again.",
        });
      } else {
        setResult({ kind: "ok" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Reset password"
      size="sm"
    >
      <div className="space-y-3">
        {!result && (
          <>
            <p className="text-sm text-ink-700">
              Enter the email on file and we will send password reset instructions.
            </p>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-outline text-sm"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={submit}
                disabled={busy || !email.trim()}
              >
                {busy ? "Resetting…" : "Send reset"}
              </button>
            </div>
          </>
        )}
        {result?.kind === "error" && (
          <div className="space-y-3">
            <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-sm text-alert">
              {result.message}
            </div>
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={() => setResult(null)}
            >
              Try again
            </button>
          </div>
        )}
        {result?.kind === "ok" && (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              If an account exists for that email, password reset instructions have been sent.
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
