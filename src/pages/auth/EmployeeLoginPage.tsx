import { useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { AuthShell } from "./AuthShell";
import { resolveAgencyByKey } from "@/lib/agencyWebsite";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { isStaffRole, staffRoleLabel, type StaffRole } from "@/lib/roles";

const STAFF_LOGIN_ROLES: StaffRole[] = [
  "agent",
  "manager",
  "csr",
];

export function EmployeeLoginPage() {
  const { signInStaff, registerStaff } = useAuth();
  const { setAgencyId } = useTenant();
  const nav = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [agencyCode, setAgencyCode] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [mode, setMode] = useState<"signIn" | "create">("signIn");
  const [role, setRole] = useState<StaffRole>("agent");
  const requestedAgency = resolveAgencyByKey(
    api.agencies.list(),
    new URLSearchParams(location.search).get("agency")
  );
  const postLoginPath = safeEmployeeRedirect(new URLSearchParams(location.search).get("next"));
  const registrationAgency = agencyCode.trim() ? api.agencies.byCode(agencyCode) : undefined;
  const registrationBranches = registrationAgency
    ? api.branches.listByAgency(registrationAgency.id)
    : [];

  function registrationError(reason: string): string {
    if (reason === "agency_not_found") return "Agency code wasn't recognized.";
    if (reason === "inactive_agency") return "That agency is inactive. Contact the master admin.";
    if (reason === "duplicate_email") return "That email already has an account.";
    if (reason === "slot_limit") return "This agency has used all purchased user slots.";
    if (reason === "weak_password") return "Password must be at least 8 characters.";
    return "Please fill in every required field.";
  }

  return (
    <AuthShell
      title={requestedAgency ? `${requestedAgency.name} sign-in` : "Agency sign-in"}
      subtitle="Sign in with your business email and password, or create your staff account."
      footer={
        <div className="text-[11px] text-ink-400 leading-relaxed">
          One account per device - signing in here will sign out anyone else currently using
          this browser. New staff only need the agency code when creating an account.
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 rounded-md border border-ink-200 bg-ink-50 p-1">
        <button
          type="button"
          className={`rounded px-3 py-2 text-sm font-medium ${
            mode === "signIn" ? "bg-white shadow-sm text-ink-900" : "text-ink-500"
          }`}
          onClick={() => {
            setMode("signIn");
            setError(null);
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`rounded px-3 py-2 text-sm font-medium ${
            mode === "create" ? "bg-white shadow-sm text-ink-900" : "text-ink-500"
          }`}
          onClick={() => {
            setMode("create");
            setError(null);
          }}
        >
          Create account
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const data = new FormData(e.currentTarget);
          if (mode === "create") {
            const code = String(data.get("agencyCode")).trim();
            const agency = api.agencies.byCode(code);
            if (!agency) {
              setError("Agency code wasn't recognized. Check the code from your master admin.");
              return;
            }
            const password = String(data.get("password"));
            const confirmPassword = String(data.get("confirmPassword"));
            if (password !== confirmPassword) {
              setError("Passwords don't match.");
              return;
            }
            const result = registerStaff({
              agencyCode: code,
              branchId: selectedBranchId || undefined,
              role,
              firstName: String(data.get("firstName")),
              lastName: String(data.get("lastName")),
              phone: String(data.get("phone")),
              businessEmail: String(data.get("businessEmail")),
              password,
            });
            if (!result.ok) {
              setError(registrationError(result.reason));
              return;
            }
            setAgencyId(result.agencyId);
            nav(postLoginPath);
            return;
          }

          const identifier = String(data.get("identifier")).trim();
          const password = String(data.get("password"));
          const u = signInStaff(identifier, password);
          if (!u || !isStaffRole(u.role)) {
            setError(
              u
                ? "That account isn't an agency user. Use the master portal in the footer."
                : "Email or password didn't match an active agency staff account."
            );
            return;
          }
          if (u.tenantId) setAgencyId(u.tenantId);
          nav(postLoginPath);
        }}
        className="space-y-3"
      >
        {mode === "create" ? (
          <>
            <div>
              <label className="label">Agency code</label>
              <input
                className="input uppercase tracking-wider"
                name="agencyCode"
                required
                value={agencyCode}
                onChange={(e) => {
                  setAgencyCode(e.target.value.toUpperCase());
                  setSelectedBranchId("");
                }}
                autoComplete="organization"
                placeholder="e.g. PCPC2026"
              />
              <p className="mt-1 text-[11px] text-ink-400">
                This confirms the agency before your staff account is created.
              </p>
            </div>
            {registrationBranches.length > 0 && (
              <div>
                <label className="label" htmlFor="staff-branch">
                  Select branch
                </label>
                <select
                  id="staff-branch"
                  name="branchId"
                  className="input"
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                >
                  <option value="">Headquarters / main office</option>
                  {registrationBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First name</label>
                <input className="input" name="firstName" required autoComplete="given-name" />
              </div>
              <div>
                <label className="label">Last name</label>
                <input className="input" name="lastName" required autoComplete="family-name" />
              </div>
            </div>
            <div>
              <label className="label">Business email</label>
              <input
                className="input"
                name="businessEmail"
                type="email"
                required
                autoComplete="email"
                placeholder="you@agency.com"
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" name="phone" required autoComplete="tel" />
            </div>
            <div>
              <label className="label">Role</label>
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
              >
                {STAFF_LOGIN_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {staffRoleLabel(role)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Password</label>
                <input
                  className="input"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="label">Confirm</label>
                <input
                  className="input"
                  name="confirmPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="label">Business email</label>
              <input
                className="input"
                name="identifier"
                required
                autoComplete="username"
                placeholder="you@agency.com"
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
              />
            </div>
          </>
        )}

        {error && <div className="text-xs text-rose-600">{error}</div>}
        <button className="btn-primary w-full" type="submit">
          {mode === "create" ? "Create account" : "Sign in"}
        </button>
      </form>

    </AuthShell>
  );
}

function safeEmployeeRedirect(value: string | null): string {
  if (!value) return "/employee";
  if (!value.startsWith("/employee")) return "/employee";
  if (value.startsWith("//")) return "/employee";
  if (value.includes("://")) return "/employee";
  return value;
}
