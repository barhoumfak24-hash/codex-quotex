import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { AuthShell } from "./AuthShell";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";

export function EmployeeLoginPage() {
  const { signInDemo, signInStaff } = useAuth();
  const { setAgencyId } = useTenant();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // Demo quick-sign-in finds a seeded user of the requested role and uses
  // that user's tenant. Real staff sign in with their own username +
  // password and inherit the tenant from their account record — no
  // agency dropdown is shown because each install is branded for a
  // single agency.
  const demoQuickSignIn = (role: "agent" | "manager") => {
    const seeded = api.users.list().find((u) => u.role === role);
    if (seeded) {
      signInDemo(role, seeded.tenantId);
      if (seeded.tenantId) setAgencyId(seeded.tenantId);
    } else {
      signInDemo(role, null);
    }
    nav("/employee");
  };

  return (
    <AuthShell
      title="Agency sign-in"
      subtitle="For licensed agents, managers, and operations staff. Master admin provisions credentials."
      footer={
        <>
          <Link className="text-ink-900 underline hover:text-gold-600" to="/login">
            Are you a client? Sign in here
          </Link>
          <div className="mt-3 text-[11px] text-ink-400 leading-relaxed">
            One account per device — signing in here will sign out anyone else currently using
            this browser. Your account is already tied to your agency; no selection needed.
          </div>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const data = new FormData(e.currentTarget);
          const identifier = String(data.get("identifier")).trim();
          const password = String(data.get("password"));
          const u = signInStaff(identifier, password);
          if (!u || (u.role !== "agent" && u.role !== "manager")) {
            setError(
              u
                ? "That account isn't an agency user. Use the master portal in the footer."
                : "Username or password didn't match. Check the credentials from your master admin."
            );
            return;
          }
          // Each staff account is already bound to one agency. Activate
          // that tenant automatically — no selection step required.
          if (u.tenantId) setAgencyId(u.tenantId);
          nav("/employee");
        }}
        className="space-y-3"
      >
        <div>
          <label className="label">Username or email</label>
          <input
            className="input"
            name="identifier"
            required
            autoComplete="username"
            placeholder="e.g. agent01-demo-agency"
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="amber-falcon-3917"
          />
        </div>
        {error && <div className="text-xs text-rose-600">{error}</div>}
        <button className="btn-primary w-full" type="submit">
          Sign in
        </button>
      </form>
      <div className="mt-5 pt-5 border-t border-ink-100 text-xs text-ink-500">
        <div className="font-medium text-ink-700 mb-1">Demo quick-sign-in</div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-ghost text-xs"
            type="button"
            onClick={() => demoQuickSignIn("agent")}
          >
            Agent
          </button>
          <button
            className="btn-ghost text-xs"
            type="button"
            onClick={() => demoQuickSignIn("manager")}
          >
            Manager
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-400">
          Real credentials are visible to master admin under Master → Users.
        </p>
      </div>
    </AuthShell>
  );
}