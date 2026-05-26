import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, KeyRound, Sparkles } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

// First-time profile completion for an auto-provisioned staff account.
// Master admin generated the username + initial password; the staff member
// fills in their real name + contact details (and optionally rotates the
// password) the first time they sign in.
export function EmployeeWelcomePage() {
  const { user, signOut, refreshUser } = useAuth();
  const { agency } = useTenant();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!user || !agency) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) return;
    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (newPassword) {
      if (newPassword.length < 8) {
        setError("New password must be at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Passwords don't match.");
        return;
      }
    }

    const patch: Parameters<typeof api.users.update>[1] = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      title: title.trim() || undefined,
      bio: bio.trim() || undefined,
      profileCompleted: true,
    };
    if (newPassword) {
      patch.generatedPassword = newPassword;
      patch.passwordUpdatedAt = new Date().toISOString();
    }
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
              details — this is the last time you'll see this page.
            </p>
          </div>
        </div>

        <Disclaimer>
          You're signed in as <strong>{user.username ?? user.email}</strong>. One account per device
          — signing in elsewhere will end this session.
        </Disclaimer>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <CardHeader title="Your profile" subtitle="Visible to clients on your agency's portal." />
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label">Full name *</label>
              <input
                className="input"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jordan Park"
                autoFocus
              />
              <p className="mt-1 text-[11px] text-ink-400">
                Current placeholder: <span className="font-mono">{user.name}</span>
              </p>
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
              <label className="label">Phone (optional)</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
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
                  <KeyRound className="h-4 w-4 text-gold-600" /> Set your own password
                </span>
              }
              subtitle="Optional but recommended. Leave blank to keep the password your master admin generated."
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">New password</label>
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="label">Confirm new password</label>
                <input
                  className="input"
                  type="password"
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