import { useState } from "react";
import { Pencil } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { useCustomer } from "@/lib/useCustomer";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

export function CustomerSettingsPage() {
  const customer = useCustomer();
  const [saved, setSaved] = useState(false);
  // Lock pattern: contact info is read-only by default. Customer
  // clicks "Edit contact info" to unlock the inputs; Save Changes
  // persists the patch AND re-locks the form so they don't leave
  // fields editable by accident.
  const [editing, setEditing] = useState(false);
  // Local form state — populated from the customer record on mount
  // and reset on cancel. The address autocomplete needs controlled
  // inputs so we lift everything into state instead of FormData.
  const [name, setName] = useState(customer?.name ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [mailingAddress, setMailingAddress] = useState(customer?.mailingAddress ?? "");
  const [garagingAddress, setGaragingAddress] = useState(customer?.garagingAddress ?? "");
  const [optInEmail, setOptInEmail] = useState(customer?.marketingOptInEmail ?? false);
  if (!customer) return null;

  function cancelEdit() {
    setName(customer!.name);
    setEmail(customer!.email);
    setPhone(customer!.phone ?? "");
    setMailingAddress(customer!.mailingAddress ?? "");
    setGaragingAddress(customer!.garagingAddress ?? "");
    setOptInEmail(customer!.marketingOptInEmail);
    setEditing(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    api.customers.update(customer!.id, {
      name,
      email,
      phone,
      mailingAddress,
      garagingAddress,
      marketingOptInEmail: optInEmail,
      marketingOptInSms: false,
    });
    setSaved(true);
    setEditing(false); // re-lock the form
    setTimeout(() => setSaved(false), 2000);
  }

  const locked = !editing;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Profile</h1>
        <p className="text-ink-500 text-sm mt-1">Update your contact details and preferences.</p>
      </div>
      <Card>
        <CardHeader
          title="Contact information"
          subtitle={
            locked
              ? "Locked. Tap Edit contact info below to make changes — saving re-locks the form automatically."
              : "Editing — save your changes to re-lock the form."
          }
        />
        {!locked && (
          <div className="mb-4">
            <Disclaimer>
              Demo only — do not enter real phone, email, or address. Use placeholder values.
            </Disclaimer>
          </div>
        )}
        <form className="grid sm:grid-cols-2 gap-4" onSubmit={handleSubmit}>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={locked}
              readOnly={locked}
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={locked}
              readOnly={locked}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={locked}
              readOnly={locked}
            />
          </div>
          <div className="hidden sm:block" />
          <div>
            <label className="label">Mailing address</label>
            {locked ? (
              <input
                className="input"
                value={mailingAddress}
                disabled
                readOnly
              />
            ) : (
              <AddressAutocomplete
                value={mailingAddress}
                onChange={setMailingAddress}
              />
            )}
          </div>
          <div>
            <label className="label">Garaging address</label>
            {locked ? (
              <input
                className="input"
                value={garagingAddress}
                disabled
                readOnly
              />
            ) : (
              <AddressAutocomplete
                value={garagingAddress}
                onChange={setGaragingAddress}
              />
            )}
          </div>
          <div className="sm:col-span-2 mt-2">
            <label className="label">Marketing preferences</label>
            <div className="flex items-center gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={optInEmail}
                  onChange={(e) => setOptInEmail(e.target.checked)}
                  disabled={locked}
                />
                Email
              </label>
            </div>
            <p className="mt-1 text-xs text-ink-500">
              You may opt out at any time. All marketing complies with CAN-SPAM requirements.
            </p>
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            {locked ? (
              <button
                type="button"
                className="btn-outline"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-4 w-4" /> Edit contact info
              </button>
            ) : (
              <>
                <button className="btn-primary" type="submit">
                  Save changes
                </button>
                <button className="btn-outline" type="button" onClick={cancelEdit}>
                  Cancel
                </button>
              </>
            )}
            {saved && <span className="text-sm text-emerald-600">Saved — locked again.</span>}
          </div>
        </form>
      </Card>

      <ChangePasswordCard />
    </div>
  );
}

// Same Locked / Edit / Save re-locks pattern as the contact info
// card above. Customer changes their portal password; staff-side
// changes for clients are out of scope for this surface.
function ChangePasswordCard() {
  const { changeMyPassword } = useAuth();
  const [locked, setLocked] = useState(true);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<
    | { kind: "ok" }
    | { kind: "error"; message: string }
    | null
  >(null);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setStatus(null);
    setLocked(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      setStatus({
        kind: "error",
        message: "New password must be at least 8 characters.",
      });
      return;
    }
    if (next !== confirm) {
      setStatus({
        kind: "error",
        message: "Passwords don't match. Re-type to confirm.",
      });
      return;
    }
    const out = changeMyPassword(current, next);
    if (!out.ok) {
      setStatus({ kind: "error", message: out.reason });
      return;
    }
    setStatus({ kind: "ok" });
    setCurrent("");
    setNext("");
    setConfirm("");
    setLocked(true);
  }

  return (
    <Card>
      <CardHeader
        title="Password"
        subtitle={
          locked
            ? "Locked. Tap Change password below to update — saving re-locks the form automatically."
            : "Editing — save your changes to re-lock."
        }
      />
      <form className="grid sm:grid-cols-2 gap-3" onSubmit={submit}>
        <div className="sm:col-span-2">
          <label className="label">Current password</label>
          <input
            type="password"
            className="input"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={locked}
            readOnly={locked}
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="label">New password</label>
          <input
            type="password"
            className="input"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={locked}
            readOnly={locked}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={locked}
            readOnly={locked}
            autoComplete="new-password"
          />
        </div>
        {status?.kind === "error" && (
          <div className="sm:col-span-2 rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
            {status.message}
          </div>
        )}
        {status?.kind === "ok" && (
          <div className="sm:col-span-2 text-sm text-emerald-600">
            Password updated — locked again.
          </div>
        )}
        <div className="sm:col-span-2 flex items-center gap-3">
          {locked ? (
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                setLocked(false);
                setStatus(null);
              }}
            >
              <Pencil className="h-4 w-4" /> Change password
            </button>
          ) : (
            <>
              <button className="btn-primary" type="submit">
                Save changes
              </button>
              <button
                className="btn-outline"
                type="button"
                onClick={reset}
              >
                Cancel
              </button>
            </>
          )}
          <span className="text-[11px] text-ink-500">
            Minimum 8 characters. The platform stores a hashed password in
            production.
          </span>
        </div>
      </form>
    </Card>
  );
}
