import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Pencil,
  Save,
  ShieldCheck,
  UserCog,
  X,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { QuotexConnectPairingCard } from "@/components/settings/QuotexConnectPairingCard";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import {
  listMailboxConnections,
  listMailboxDiagnostics,
  startMailboxOAuth,
  type MailboxDiagnostic,
  type MailboxOAuthProvider,
} from "@/lib/mailboxOAuth";
import {
  inferMailProvider,
  isValidBusinessEmail,
  mailboxUrl,
  mailProviderLabel,
  MAIL_PROVIDER_OPTIONS,
} from "@/lib/mailProvider";
import type { MailProvider } from "@/types";
import type { ConnectedMailbox } from "@/types";

function lockedFieldClass(locked: boolean) {
  return locked
    ? "input pointer-events-none select-none cursor-default bg-ink-50 text-ink-700 opacity-100 focus:border-ink-200 focus:ring-0"
    : "input";
}

function roleLabel(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatMailboxTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EmployeeAccountSettingsPage() {
  const { user, refreshUser, changeMyPassword, signOut } = useAuth();
  const { agency } = useTenant();
  const navigate = useNavigate();
  const liveUser = user ? api.users.get(user.id) ?? user : null;
  const [profileLocked, setProfileLocked] = useState(true);
  const [securityLocked, setSecurityLocked] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [mailboxNotice, setMailboxNotice] = useState<string | null>(null);
  const [mailboxConnecting, setMailboxConnecting] = useState<MailboxOAuthProvider | null>(null);
  const [serverMailboxes, setServerMailboxes] = useState<ConnectedMailbox[]>([]);
  const [serverMailboxLoading, setServerMailboxLoading] = useState(false);
  const [serverMailboxError, setServerMailboxError] = useState<string | null>(null);
  const [mailboxDiagnostics, setMailboxDiagnostics] = useState<MailboxDiagnostic[]>([]);
  const [mailboxDiagnosticsLoading, setMailboxDiagnosticsLoading] = useState(false);
  const [mailboxDiagnosticsError, setMailboxDiagnosticsError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    firstName: "",
    lastName: "",
    businessEmail: "",
    phone: "",
    title: "",
    lineOfBusiness: "",
    mailProvider: "other" as MailProvider,
  });
  const [passwordDraft, setPasswordDraft] = useState({
    current: "",
    next: "",
    confirm: "",
  });

  useEffect(() => {
    if (!liveUser || !profileLocked) return;
    const inferredProvider = inferMailProvider(liveUser.businessEmail ?? liveUser.email);
    setProfileDraft({
      firstName: liveUser.firstName ?? liveUser.name.split(" ")[0] ?? "",
      lastName: liveUser.lastName ?? liveUser.name.split(" ").slice(1).join(" "),
      businessEmail: liveUser.businessEmail ?? liveUser.email,
      phone: liveUser.phone ?? "",
      title: liveUser.title ?? "",
      lineOfBusiness: liveUser.lineOfBusiness ?? "",
      mailProvider: liveUser.mailProvider ?? inferredProvider,
    });
  }, [
    liveUser?.id,
    liveUser?.firstName,
    liveUser?.lastName,
    liveUser?.name,
    liveUser?.businessEmail,
    liveUser?.email,
    liveUser?.phone,
    liveUser?.title,
    liveUser?.lineOfBusiness,
    liveUser?.mailProvider,
    profileLocked,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mailboxStatus = params.get("mailbox");
    if (mailboxStatus === "connected") {
      const provider = params.get("provider");
      setMailboxNotice(
        provider
          ? `${provider === "microsoft" ? "Microsoft" : "Google"} mailbox connected.`
          : "Mailbox connected."
      );
    } else if (mailboxStatus === "error") {
      setMailboxNotice("Mailbox authorization did not complete. Start the connection again.");
    } else {
      return;
    }
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (!liveUser || !agency?.id) {
      setServerMailboxes([]);
      setServerMailboxError(null);
      setMailboxDiagnostics([]);
      setMailboxDiagnosticsError(null);
      return;
    }
    let cancelled = false;
    setServerMailboxLoading(true);
    setMailboxDiagnosticsLoading(true);
    setServerMailboxError(null);
    setMailboxDiagnosticsError(null);
    Promise.all([
      listMailboxConnections({ user: liveUser, tenantId: agency.id, mineOnly: true }),
      listMailboxDiagnostics({ user: liveUser, tenantId: agency.id, mineOnly: true }),
    ])
      .then(([connectionsResult, diagnosticsResult]) => {
        if (cancelled) return;
        if (connectionsResult.ok) {
          setServerMailboxes(connectionsResult.connections);
          setServerMailboxError(null);
        } else {
          setServerMailboxes([]);
          setServerMailboxError(
            connectionsResult.message ?? connectionsResult.error ?? "Mailbox status could not be checked."
          );
        }
        if (diagnosticsResult.ok) {
          setMailboxDiagnostics(diagnosticsResult.diagnostics);
          setMailboxDiagnosticsError(null);
        } else {
          setMailboxDiagnostics([]);
          setMailboxDiagnosticsError(
            diagnosticsResult.message ?? diagnosticsResult.error ?? "Mailbox diagnostics could not be checked."
          );
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setServerMailboxes([]);
        setMailboxDiagnostics([]);
        setServerMailboxError(error instanceof Error ? error.message : "Mailbox status could not be checked.");
        setMailboxDiagnosticsError(error instanceof Error ? error.message : "Mailbox diagnostics could not be checked.");
      })
      .finally(() => {
        if (!cancelled) {
          setServerMailboxLoading(false);
          setMailboxDiagnosticsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agency?.id, liveUser?.id, liveUser?.tenantId, liveUser?.role]);

  const displayEmail = liveUser?.businessEmail ?? liveUser?.email ?? "";
  const staffMailbox = liveUser ? api.mailboxes.staff(liveUser.id) : undefined;
  const serverMailbox =
    serverMailboxes.find((mailbox) => mailbox.ownerType === "staff" && mailbox.userId === liveUser?.id) ??
    serverMailboxes[0];
  const effectiveMailbox = serverMailbox ?? staffMailbox;
  const mailboxAddress = effectiveMailbox?.address ?? displayEmail;
  const mailboxProvider = effectiveMailbox?.provider ?? inferMailProvider(mailboxAddress);
  const mailboxRequirements = api.mailboxes.productionRequirements(effectiveMailbox);
  const providerText = useMemo(
    () => mailProviderLabel(liveUser?.mailProvider ?? inferMailProvider(displayEmail)),
    [displayEmail, liveUser?.mailProvider]
  );

  if (!liveUser) return null;

  function updateProfileDraft<K extends keyof typeof profileDraft>(
    key: K,
    value: (typeof profileDraft)[K]
  ) {
    setProfileDraft((draft) => ({ ...draft, [key]: value }));
    setProfileError(null);
    setProfileSaved(false);
  }

  function resetProfileDraft() {
    if (!liveUser) return;
    setProfileDraft({
      firstName: liveUser.firstName ?? liveUser.name.split(" ")[0] ?? "",
      lastName: liveUser.lastName ?? liveUser.name.split(" ").slice(1).join(" "),
      businessEmail: liveUser.businessEmail ?? liveUser.email,
      phone: liveUser.phone ?? "",
      title: liveUser.title ?? "",
      lineOfBusiness: liveUser.lineOfBusiness ?? "",
      mailProvider: liveUser.mailProvider ?? inferMailProvider(liveUser.businessEmail ?? liveUser.email),
    });
    setProfileError(null);
    setProfileSaved(false);
  }

  function saveProfile() {
    if (!liveUser) return;
    const currentUser = liveUser;
    const firstName = profileDraft.firstName.trim();
    const lastName = profileDraft.lastName.trim();
    const businessEmail = profileDraft.businessEmail.trim().toLowerCase();
    const phone = profileDraft.phone.trim();
    if (!firstName || !lastName) {
      setProfileError("Add your first and last name.");
      return;
    }
    if (!isValidBusinessEmail(businessEmail)) {
      setProfileError("Add a valid business email.");
      return;
    }
    const duplicate = api.users
      .list()
      .some(
        (row) =>
          row.id !== currentUser.id &&
          (row.email.toLowerCase() === businessEmail ||
            row.businessEmail?.toLowerCase() === businessEmail)
      );
    if (duplicate) {
      setProfileError("That email is already used by another account.");
      return;
    }
    const updated = api.users.update(currentUser.id, {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      email: businessEmail,
      businessEmail,
      mailProvider: profileDraft.mailProvider,
      phone,
      title: profileDraft.title.trim() || undefined,
      lineOfBusiness:
        profileDraft.lineOfBusiness === "personal" || profileDraft.lineOfBusiness === "commercial"
          ? profileDraft.lineOfBusiness
          : undefined,
      profileCompleted: true,
    });
    if (!updated) {
      setProfileError("Account could not be saved. Try again.");
      return;
    }
    refreshUser();
    setProfileLocked(true);
    setProfileSaved(true);
    setProfileError(null);
  }

  async function savePassword() {
    setPasswordError(null);
    setPasswordSaved(false);
    if (passwordDraft.next.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (passwordDraft.next !== passwordDraft.confirm) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    const result = await changeMyPassword(passwordDraft.current, passwordDraft.next);
    if (!result.ok) {
      setPasswordError(result.reason);
      return;
    }
    setPasswordDraft({ current: "", next: "", confirm: "" });
    setSecurityLocked(true);
    setPasswordSaved(true);
  }

  async function connectMailbox(provider: MailboxOAuthProvider) {
    if (!liveUser) return;
    if (!agency?.id) {
      setMailboxNotice("Agency context is required before connecting a mailbox.");
      return;
    }
    const currentUser = liveUser;
    setMailboxConnecting(provider);
    setMailboxNotice(null);
    try {
      const result = await startMailboxOAuth({
        provider,
        user: currentUser,
        tenantId: agency.id,
        redirectAfter: "/employee/account-settings",
      });
      if (result.ok) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      setMailboxNotice(result.message ?? result.error ?? "Mailbox authorization could not be started.");
    } catch (error) {
      setMailboxNotice(error instanceof Error ? error.message : "Mailbox authorization could not be started.");
    } finally {
      setMailboxConnecting(null);
    }
  }

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Account settings</h1>
          <p className="text-ink-500 text-sm mt-1">
            View your account, update your contact information, manage password access, or sign out.
          </p>
        </div>
        <div className="rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
          {agency?.name ?? "Agency account"}
        </div>
      </div>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <UserCog className="h-4 w-4 text-gold-600" /> My information
            </span>
          }
          subtitle={
            profileLocked
              ? "Locked. Click Edit info before changing personal account details."
              : "Unlocked. Save to update your staff profile and message-center mailbox."
          }
          action={
            profileLocked ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  resetProfileDraft();
                  setProfileLocked(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit info
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    resetProfileDraft();
                    setProfileLocked(true);
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button type="button" className="btn-gold text-xs" onClick={saveProfile}>
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
              </div>
            )
          }
        />
        {profileError && (
          <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {profileError}
          </div>
        )}
        {profileSaved && (
          <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            Saved and locked.
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="label">First name</span>
            <input
              className={lockedFieldClass(profileLocked)}
              value={profileDraft.firstName}
              disabled={profileLocked}
              onChange={(event) => updateProfileDraft("firstName", event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Last name</span>
            <input
              className={lockedFieldClass(profileLocked)}
              value={profileDraft.lastName}
              disabled={profileLocked}
              onChange={(event) => updateProfileDraft("lastName", event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Business email</span>
            <input
              className={lockedFieldClass(profileLocked)}
              value={profileDraft.businessEmail}
              disabled={profileLocked}
              onChange={(event) => {
                const value = event.target.value;
                updateProfileDraft("businessEmail", value);
                updateProfileDraft("mailProvider", inferMailProvider(value));
              }}
            />
          </label>
          <label className="block">
            <span className="label">Phone</span>
            <input
              className={lockedFieldClass(profileLocked)}
              value={profileDraft.phone}
              disabled={profileLocked}
              onChange={(event) => updateProfileDraft("phone", event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Title</span>
            <input
              className={lockedFieldClass(profileLocked)}
              value={profileDraft.title}
              disabled={profileLocked}
              placeholder="Account executive, CSR, manager..."
              onChange={(event) => updateProfileDraft("title", event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Primary line</span>
            <select
              className={lockedFieldClass(profileLocked)}
              value={profileDraft.lineOfBusiness}
              disabled={profileLocked}
              onChange={(event) => updateProfileDraft("lineOfBusiness", event.target.value)}
            >
              <option value="">Not specified</option>
              <option value="personal">Personal lines</option>
              <option value="commercial">Commercial lines</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="label">Mailbox provider</span>
            <select
              className={lockedFieldClass(profileLocked)}
              value={profileDraft.mailProvider}
              disabled={profileLocked}
              onChange={(event) =>
                updateProfileDraft("mailProvider", event.target.value as MailProvider)
              }
            >
              {MAIL_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 grid gap-3 rounded-md border border-ink-100 bg-ink-50 p-4 text-sm md:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Role</div>
            <div className="mt-1 font-semibold text-ink-900">{roleLabel(liveUser.role)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Username</div>
            <div className="mt-1 font-semibold text-ink-900">{liveUser.username ?? "Email sign-in"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Messages mailbox</div>
            <div className="mt-1 font-semibold text-ink-900">{providerText}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
          <Lock className="h-3.5 w-3.5 text-gold-600" />
          {profileLocked ? "Locked." : "Unlocked."} Account changes update sign-in and message-center identity.
        </div>
      </Card>

      <QuotexConnectPairingCard />

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Mail className="h-4 w-4 text-gold-600" /> Message-center mailbox
            </span>
          }
          subtitle="This is the mailbox Quotex uses for client, prospect, holder, and carrier email sends from your account."
          action={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <a
                href={mailboxUrl(mailboxAddress, mailboxProvider)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open mailbox
              </a>
              <button
                type="button"
                className="btn-outline text-xs"
                disabled={mailboxConnecting !== null}
                onClick={() => void connectMailbox("google")}
              >
                {mailboxConnecting === "google" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Connect Google
              </button>
              <button
                type="button"
                className="btn-outline text-xs"
                disabled={mailboxConnecting !== null}
                onClick={() => void connectMailbox("microsoft")}
              >
                {mailboxConnecting === "microsoft" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Connect Microsoft
              </button>
            </div>
          }
        />
        {mailboxNotice && (
          <div className="mb-4 rounded-md bg-gold-50 px-3 py-2 text-xs font-medium text-gold-800">
            {mailboxNotice}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Mailbox</div>
            <div className="mt-1 truncate text-sm font-semibold text-ink-900">{mailboxAddress}</div>
          </div>
          <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Provider</div>
            <div className="mt-1 text-sm font-semibold text-ink-900">{mailProviderLabel(mailboxProvider)}</div>
          </div>
          <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">Status</div>
            <div className="mt-1 text-sm font-semibold text-ink-900">
              {serverMailboxLoading
                ? "Checking..."
                : effectiveMailbox?.status === "connected"
                  ? "Connected"
                  : "Needs authorization"}
            </div>
          </div>
          <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">
              {effectiveMailbox?.lastSyncAt || effectiveMailbox?.lastSendAt ? "Last activity" : "Mode"}
            </div>
            <div className="mt-1 text-sm font-semibold text-ink-900">
              {effectiveMailbox?.lastSyncAt
                ? `Synced ${formatMailboxTime(effectiveMailbox.lastSyncAt)}`
                : effectiveMailbox?.lastSendAt
                  ? `Sent ${formatMailboxTime(effectiveMailbox.lastSendAt)}`
                  : effectiveMailbox?.authMode === "demo"
                    ? "Legacy local record"
                    : effectiveMailbox?.authMode ?? "Pending"}
            </div>
          </div>
        </div>
        {serverMailboxError && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {serverMailboxError}
          </div>
        )}
        {effectiveMailbox?.lastError && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            Last mailbox error: {effectiveMailbox.lastError}
          </div>
        )}
        {mailboxRequirements.length > 0 && (
          <div className="mt-4 rounded-md border border-gold-200 bg-gold-50/60 px-3 py-2 text-xs text-gold-900">
            <div className="font-semibold">Production requirements</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {mailboxRequirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        <MailboxSyncPanel
          diagnostics={mailboxDiagnostics}
          loading={mailboxDiagnosticsLoading}
          error={mailboxDiagnosticsError}
        />
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-gold-600" /> Password
            </span>
          }
          subtitle={
            securityLocked
              ? "Locked. Click Change password before editing credentials."
              : "Unlocked. Enter your current password and choose a new password."
          }
          action={
            securityLocked ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setPasswordDraft({ current: "", next: "", confirm: "" });
                  setPasswordError(null);
                  setPasswordSaved(false);
                  setSecurityLocked(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Change password
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setPasswordDraft({ current: "", next: "", confirm: "" });
                    setPasswordError(null);
                    setSecurityLocked(true);
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button type="button" className="btn-gold text-xs" onClick={savePassword}>
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
              </div>
            )
          }
        />
        {passwordError && (
          <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {passwordError}
          </div>
        )}
        {passwordSaved && (
          <div className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            Password saved and locked.
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="label">Current password</span>
            <input
              type="password"
              className={lockedFieldClass(securityLocked)}
              value={passwordDraft.current}
              disabled={securityLocked}
              onChange={(event) =>
                setPasswordDraft((draft) => ({ ...draft, current: event.target.value }))
              }
            />
          </label>
          <label className="block">
            <span className="label">New password</span>
            <input
              type="password"
              className={lockedFieldClass(securityLocked)}
              value={passwordDraft.next}
              disabled={securityLocked}
              onChange={(event) =>
                setPasswordDraft((draft) => ({ ...draft, next: event.target.value }))
              }
            />
          </label>
          <label className="block">
            <span className="label">Confirm new password</span>
            <input
              type="password"
              className={lockedFieldClass(securityLocked)}
              value={passwordDraft.confirm}
              disabled={securityLocked}
              onChange={(event) =>
                setPasswordDraft((draft) => ({ ...draft, confirm: event.target.value }))
              }
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
          <Lock className="h-3.5 w-3.5 text-gold-600" />
          {securityLocked ? "Locked." : "Unlocked."} Password changes apply to the next staff sign-in.
        </div>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Mail className="h-4 w-4 text-gold-600" /> Session
            </span>
          }
          subtitle="End this browser session and return to the public Quotex page."
          action={
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => {
                signOut();
                navigate("/");
              }}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          }
        />
        <div className="rounded-md border border-ink-100 bg-ink-50 px-4 py-3 text-sm text-ink-600">
          Signed in as <span className="font-semibold text-ink-900">{liveUser.name}</span> using{" "}
          <span className="font-semibold text-ink-900">{displayEmail}</span>.
        </div>
      </Card>
    </div>
  );
}

function MailboxSyncPanel({
  diagnostics,
  loading,
  error,
}: {
  diagnostics: MailboxDiagnostic[];
  loading: boolean;
  error: string | null;
}) {
  const first = diagnostics[0];
  return (
    <div className="mt-4 rounded-md border border-ink-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Mailbox sync</div>
          <p className="mt-1 text-xs text-ink-500">
            Inbound replies mirror through provider API polling. Reconnect once after scope changes.
          </p>
        </div>
        {loading ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking
          </span>
        ) : first?.hasReadScope && first.tokenStatus === "valid" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Read ready
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700">
            <AlertTriangle className="h-3 w-3" /> Needs attention
          </span>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {error}
        </div>
      )}

      {!loading && diagnostics.length === 0 && !error && (
        <div className="mt-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs text-gold-900">
          No live mailbox connection has been authorized yet.
        </div>
      )}

      <div className="mt-3 space-y-3">
        {diagnostics.map((item) => (
          <div key={item.id} className="rounded-md border border-ink-100 bg-ink-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-ink-900">{item.address}</div>
                <div className="text-xs text-ink-500">{mailProviderLabel(providerToMailProvider(item.provider))}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <HealthPill ok={item.hasReadScope} label={item.hasReadScope ? "Read scope" : "No read scope"} />
                <HealthPill ok={item.cursorPresent} label={item.cursorPresent ? "Cursor saved" : "No cursor yet"} />
                <HealthPill ok={item.tokenStatus === "valid"} label={item.tokenStatus === "valid" ? "Token valid" : "Re-auth needed"} />
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
              <Metric label="Last poll" value={item.lastPoll ? formatMailboxTime(item.lastPoll.at) : "Not run yet"} />
              <Metric label="Fetched" value={item.lastPoll ? String(item.lastPoll.fetched) : "0"} />
              <Metric label="Created" value={item.lastPoll ? String(item.lastPoll.created) : "0"} />
              <Metric label="Inbound 24h" value={String(item.inboundLast24h)} />
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
              <Metric label="Updated" value={item.lastPoll ? String(item.lastPoll.updated) : "0"} />
              <Metric label="Deduped" value={item.lastPoll ? String(item.lastPoll.deduped) : "0"} />
              <Metric label="Errors" value={item.lastPoll ? String(item.lastPoll.errors) : "0"} />
            </div>
            <div className="mt-3 rounded-md bg-white px-3 py-2 text-[11px] text-ink-500">
              <div className="font-semibold text-ink-700">Granted scopes</div>
              <div className="mt-1 break-words">{item.grantedScopes.length ? item.grantedScopes.join(", ") : "None reported"}</div>
            </div>
            {item.lastError && (
              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {item.lastError}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-gold-200 bg-gold-50/60 px-3 py-2 text-xs text-gold-900">
        <div className="font-semibold">Required one-time checks</div>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>Reconnect the mailbox after this update so Google or Microsoft grants read permission.</li>
          <li>Confirm the Vercel Cron job for mailbox polling is enabled after deployment.</li>
        </ul>
      </div>
    </div>
  );
}

function HealthPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${
        ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink-100 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-1 font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function providerToMailProvider(provider: string): MailProvider {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "google" || normalized === "gmail") return "gmail";
  if (normalized === "microsoft" || normalized === "outlook") return "outlook";
  return "other";
}
