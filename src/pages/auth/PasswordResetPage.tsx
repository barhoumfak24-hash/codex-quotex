import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthShell } from "./AuthShell";
import { authFailureMessage, resetPasswordWithToken } from "@/lib/auth";

export function PasswordResetPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Set a new password for your Quotex account."
      footer={<Link className="text-ink-900 underline" to="/login">Return to sign in</Link>}
    >
      {complete ? (
        <div className="space-y-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            Your password has been updated. You can sign in now.
          </div>
          <Link className="btn-primary w-full" to="/login">Sign in</Link>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitting) return;
            setError(null);
            if (!token) {
              setError("This reset link is invalid or has expired. Request a new link from sign in.");
              return;
            }
            if (password.length < 8) {
              setError("Password must be at least 8 characters.");
              return;
            }
            if (password !== confirmPassword) {
              setError("Passwords do not match.");
              return;
            }
            setSubmitting(true);
            const result = await resetPasswordWithToken(token, password);
            setSubmitting(false);
            if (!result.ok) {
              setError(result.reason === "invalid_credentials"
                ? "This reset link is invalid or has expired. Request a new link from sign in."
                : authFailureMessage(result.reason));
              return;
            }
            setComplete(true);
          }}
        >
          <div>
            <label className="label" htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="reset-confirm-password">Confirm new password</label>
            <input
              id="reset-confirm-password"
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          {error && <div role="alert" className="text-xs leading-relaxed text-rose-600">{error}</div>}
          <button className="btn-primary w-full" type="submit" disabled={submitting}>
            {submitting ? "Updating password..." : "Update password"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
