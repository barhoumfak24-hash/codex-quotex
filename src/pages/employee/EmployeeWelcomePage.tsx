import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, KeyRound, Sparkles } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import {
  inferMailProvider,
  isValidBusinessEmail,
  MAIL_PROVIDER_OPTIONS,
} from "@/lib/mailProvider";
import type { MailProvider } from "@/types";

// First-time profile completion for an auto-provisioned staff account.
// Master admin generated the username + initial password; the staff member
// fills in their real identity, contact details, and permanent password
// the first time they sign in.
export function EmployeeWelcomePage() {
  const { user, signOut, refreshUser, changeMyPassword } = useAuth();
  const { agency } = useTenant();
  const nav = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [businessEmail, setBusinessEmail] = useState(user?.businessEmail ?? user?.email ?? "");
  const [mailProvider, setMailProvider] = useState<MailProvider>(
    inferMailProvider(user?.businessEmail ?? user?.email ?? "")
  );
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const email = user.businessEmail ?? user.email ?? "";
    setBusinessEmail(email);
    setMailProvider(user.mailProvider ?? inferMailProvider(email));
  }, [user?.id]);

  if (!user || !agency) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) return;
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    if (!cleanFirstName || !cleanLastName) {
      setError("Please enter your first and last name.");
      return;
    }
    if (!phone.trim()) {
      setError("Please enter your phone number.");
      return;
    }
    const cleanBusinessEmail = businessEmail.trim().toLowerCase();
    if (!isValidBusinessEmail(cleanBusinessEmail)) {
      setError("Please enter the business email you use every day.");
      return;
    }
    const existing = api.users.byEmail(cleanBusinessEmail);
    if (existing && existing.id !== user.id) {
      setError("That business email is already connected to another staff account.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Create a password with at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (!currentPassword) {
      setError("Enter the password you used to sign in.");
      return;
    }

    const passwordResult = await changeMyPassword(currentPassword, newPassword);
    if (!passwordResult.ok) {
      setError(passwordResult.reason);
      return;
    }

    const patch: Parameters<typeof api.users.update>[1] = {
      firstName: cleanFirstName,
      lastName: cleanLastName,
      name: `${cleanFirstName} ${cleanLastName}`,
      email: cleanBusinessEmail,
      businessEmail: cleanBusinessEmail,
      mailProvider,
      phone: phone.trim(),
      title: title.trim() || undefined,
      bio: bio.trim() || undefined,
      profileCompleted: true,
      passwordUpdatedAt: new Date().toISOString(),
    };
    api.users.update(user.id, patch);
    // Sync the in-memory user so the RequireProfile gate stops bouncing.
    refreshUser();
    nav("/employee", { replace: true });
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Card className="!p-8">
        <div className="flex items-start gap-3 mb-6">
          <div className="h-10 w-10 rounded-md bg-ink-900 text-gold-300 flex items-center justify-center">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Welcome to {agency.name}</h1>
            <p className="text-ink-500 text-sm mt-1">
              Your master admin generated this account for you. Take 30 seconds to fill in your
              details and create your password. This is the last time you'll see this page.
            </p>
          </div>
        </div>

        <Disclaimer>
          You're signed in as <strong>{user.username ?? user.email}</strong>. One account per device
          — signing in elsewhere will end this session.
        </Disclaimer>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <CardHeader
            title="Your sign-in profile"
            subtitle="Your business email becomes your staff sign-in and connects the Messages center."
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">First name *</label>
              <input
                className="input"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jordan"
                autoComplete="given-name"
              />
            </div>
            <div>
              <label className="label">Last name *</label>
              <input
                className="input"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Park"
                autoComplete="family-name"
              />
            </div>
            <div>
              <label className="label">Business email *</label>
              <input
                className="input"
                required
                type="email"
                value={businessEmail}
                onChange={(e) => {
                  const next = e.target.value;
                  setBusinessEmail(next);
                  setMailProvider(inferMailProvider(next));
                }}
                placeholder="you@agency.com"
                autoComplete="email"
              />
              <p className="mt-1 text-[11px] text-ink-400">
                This becomes your staff sign-in and connects the Messages center.
              </p>
            </div>
            <div>
              <label className="label">Mailbox provider</label>
              <select
                className="input"
                value={mailProvider}
                onChange={(e) => setMailProvider(e.target.value as MailProvider)}
              >
                {MAIL_PROVIDER_OPTIONS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Title (optional)</label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={user.role === "manager" ? "Agency Manager" : "Private Client Agent"}
              />
            </div>
            <div>
              <label className="label">Phone *</label>
              <input
                className="input"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                autoComplete="tel"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Short bio (optional)</label>
              <textarea
                className="input min-h-[70px]"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="One or two sentences shown next to your name when you contact clients."
              />
            </div>
          </div>

          <div className="pt-2 mt-4 border-t border-ink-100">
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-gold-600" /> Create your password
                </span>
              }
              subtitle="Required. After this setup, use your business email and this password to sign in."
            />
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Current password *</label>
                <input
                  className="input"
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="label">Password *</label>
                <input
                  className="input"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="label">Confirm password *</label>
                <input
                  className="input"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            {user.passwordUpdatedAt && (
              <p className="mt-2 text-[11px] text-ink-400">
                Current password was last set {fmt.relative(user.passwordUpdatedAt)}.
              </p>
            )}
          </div>

          {error && <div className="text-sm text-rose-600">{error}</div>}

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                signOut();
                nav("/employee/login");
              }}
            >
              Sign out
            </button>
            <button className="btn-primary" type="submit">
              <Check className="h-4 w-4" /> Complete profile
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
