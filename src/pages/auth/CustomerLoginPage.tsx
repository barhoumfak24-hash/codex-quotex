import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";

// Customer-only sign-in. Staff (agent, manager, master admin) sign-ins live
// in the public footer and at /employee/login and /master/login.
export function CustomerLoginPage() {
  const {
    signInDemo,
    signInCustomer,
    signInWithGoogle,
    resetCustomerPassword,
  } = useAuth();
  const { setAgencyId } = useTenant();
  const nav = useNavigate();
  const location = useLocation();
  const redirectFrom = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const target = redirectFrom || "/customer";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  const enterAsDemoCustomer = () => {
    signInDemo("customer", "agency_palmcoast");
    setAgencyId("agency_palmcoast");
    nav(target, { replace: true });
  };

  return (
    <AuthShell
      title="Customer sign-in"
      subtitle="Access your private client portfolio."
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="text-ink-900 underline hover:text-gold-600">
            Create an account
          </Link>
          <div className="mt-3 text-[11px] text-ink-400">
            Staff (agent, manager, master admin) sign-ins are in the footer below.
          </div>
        </>
      }
    >
      <button
        type="button"
        onClick={() => {
          signInWithGoogle();
          nav(target, { replace: true });
        }}
        className="btn-outline w-full"
      >
        <svg viewBox="0 0 48 48" className="h-4 w-4">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.5-5.9 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.3 6.5 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.3 6.5 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.3l-6.3-5.2C29.2 35 26.7 36 24 36c-5.4 0-9.9-3.4-11.5-8.1l-6.5 5C9.4 39.7 16.1 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.2C40.9 35.5 44 30.2 44 24c0-1.2-.1-2.3-.4-3.5z" />
        </svg>
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-xs text-ink-400">
        <div className="h-px flex-1 bg-ink-100" />
        or
        <div className="h-px flex-1 bg-ink-100" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const u = signInCustomer(email.trim(), password);
          if (!u) {
            setError(
              "Email and password don't match. Try the Forgot password link below."
            );
            return;
          }
          nav(target, { replace: true });
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
          />
        </div>
        {error && <div className="text-xs text-rose-600">{error}</div>}
        <button type="submit" className="btn-primary w-full">
          Sign in
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
        onReset={(input) => resetCustomerPassword(input)}
      />

      <div className="mt-5 pt-5 border-t border-ink-100">
        <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
          Demo
        </div>
        <button type="button" className="btn-gold w-full" onClick={enterAsDemoCustomer}>
          <Sparkles className="h-4 w-4" /> Continue as Demo Customer
        </button>
        <p className="mt-2 text-[11px] text-ink-400 text-center">
          One-click into the customer portal with seeded data.
        </p>
      </div>
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
  onReset: (email: string) => { tempPassword: string } | null;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; tempPassword: string }
    | { kind: "error"; message: string }
    | null
  >(null);

  function reset() {
    setEmail(initialEmail);
    setBusy(false);
    setResult(null);
  }

  function submit() {
    setBusy(true);
    try {
      const out = onReset(email.trim());
      if (!out) {
        setResult({
          kind: "error",
          message: "No customer account found for that email.",
        });
      } else {
        setResult({ kind: "ok", tempPassword: out.tempPassword });
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
              Enter the email on file and we'll generate a temporary password you can
              use to sign in. Production sends an email with a one-time reset link.
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
              Temporary password set. In production this is emailed to you; for the
              demo, copy it and sign in now.
            </div>
            <div className="rounded-md border border-ink-100 bg-ink-50/60 p-3 font-mono text-sm text-center select-all">
              {result.tempPassword}
            </div>
            <p className="text-[11px] text-ink-500">
              Sign in with this temporary password and change it from your portal
              Profile page.
            </p>
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