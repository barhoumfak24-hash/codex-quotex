import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole, ShieldCheck, UserPlus } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { authFailureMessage, useAuth } from "@/lib/auth";

type Mode = "sign-in" | "create";

export function MasterLoginPage() {
  const { createMasterAccount, signInMaster } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitSignIn(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await signInMaster(signInEmail, signInPassword);
      if (!result.ok) {
        setMessage(authFailureMessage(result.reason, "master"));
        return;
      }
      nav("/master");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (createPassword !== confirmPassword) {
      setMessage("The confirmation password does not match.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createMasterAccount({
        name: createName,
        email: createEmail,
        password: createPassword,
      });
      if (!result.ok) {
        setMessage(createErrorLabel(result.reason));
        return;
      }
      nav("/master");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title="Master portal" subtitle="Founder-only platform controls.">
      <div className="mb-4 grid grid-cols-2 rounded-lg border border-ink-200 bg-ink-50 p-1">
        <button
          type="button"
          className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${
            mode === "sign-in" ? "bg-white text-ink-950 shadow-sm" : "text-ink-500"
          }`}
          onClick={() => {
            setMode("sign-in");
            setMessage(null);
          }}
        >
          <LockKeyhole className="h-4 w-4" />
          Sign in
        </button>
        <button
          type="button"
          className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${
            mode === "create" ? "bg-white text-ink-950 shadow-sm" : "text-ink-500"
          }`}
          onClick={() => {
            setMode("create");
            setMessage(null);
          }}
        >
          <UserPlus className="h-4 w-4" />
          Create account
        </button>
      </div>

      {mode === "sign-in" ? (
        <form onSubmit={submitSignIn} className="space-y-3">
          <div>
            <label className="label">Founder email</label>
            <input
              className="input"
              type="email"
              value={signInEmail}
              onChange={(event) => setSignInEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Master passphrase</label>
            <input
              className="input"
              type="password"
              value={signInPassword}
              onChange={(event) => setSignInPassword(event.target.value)}
              required
            />
          </div>
          <button className="btn-primary w-full" type="submit" disabled={submitting}>
            {submitting ? "Checking access..." : "Enter master portal"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCreate} className="space-y-3">
          <div>
            <label className="label">Full name</label>
            <input
              className="input"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              disabled={submitting}
              required
            />
          </div>
          <div>
            <label className="label">Founder email</label>
            <input
              className="input"
              type="email"
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
              disabled={submitting}
              required
            />
          </div>
          <div>
            <label className="label">Master passphrase</label>
            <input
              className="input"
              type="password"
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
              disabled={submitting}
              minLength={12}
              required
            />
          </div>
          <div>
            <label className="label">Confirm passphrase</label>
            <input
              className="input"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={submitting}
              minLength={12}
              required
            />
          </div>
          <button className="btn-primary w-full" type="submit" disabled={submitting}>
            <ShieldCheck className="h-4 w-4" />
            {submitting ? "Creating..." : "Create master account"}
          </button>
        </form>
      )}

      {message && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {message}
        </div>
      )}
      <p className="mt-3 text-xs text-ink-400">
        Master access is limited to one provisioned owner and should be protected with MFA.
      </p>
    </AuthShell>
  );
}

function createErrorLabel(reason: "exists" | "invalid_email" | "weak_password" | "missing_name" | "server_unavailable") {
  if (reason === "exists") return "The master portal already has its one allowed account.";
  if (reason === "invalid_email") return "Enter a valid founder email.";
  if (reason === "weak_password") return "Use a passphrase with at least 12 characters.";
  if (reason === "server_unavailable") return "The server auth system is unavailable. Try again in a moment.";
  return "Enter the founder's full name.";
}
