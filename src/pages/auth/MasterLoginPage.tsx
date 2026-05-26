import { useNavigate } from "react-router-dom";
import { AuthShell } from "./AuthShell";
import { useAuth } from "@/lib/auth";

export function MasterLoginPage() {
  const { signInDemo } = useAuth();
  const nav = useNavigate();
  return (
    <AuthShell
      title="Master portal"
      subtitle="Founder-only platform controls."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Real impl: server-side check w/ MFA. Demo: instantly grant master role.
          signInDemo("master_admin", null);
          nav("/master");
        }}
        className="space-y-3"
      >
        <div>
          <label className="label">Founder email</label>
          <input className="input" defaultValue="founder@quotex.example" required />
        </div>
        <div>
          <label className="label">Master passphrase</label>
          <input className="input" type="password" defaultValue="••••••••" required />
        </div>
        <button className="btn-primary w-full" type="submit">
          Enter master portal
        </button>
        <p className="text-xs text-ink-400">
          Production should enforce SSO + hardware MFA before granting master_admin.
        </p>
      </form>
    </AuthShell>
  );
}