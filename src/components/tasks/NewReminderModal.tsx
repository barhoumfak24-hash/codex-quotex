import { useEffect, useMemo, useState } from "react";
import { Bell, Building2, Calendar as CalendarIcon, Sparkles, User, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { ImportancePicker } from "@/components/tasks/ImportancePicker";
import { RecurrencePicker, buildRecurrence } from "@/components/tasks/RecurrencePicker";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { ReminderRecurrencePattern, TaskSeverity, User as UserType } from "@/types";

const PRESETS = [
  { label: "In 1 hour", ms: 60 * 60 * 1000 },
  { label: "Tomorrow morning", ms: 24 * 60 * 60 * 1000 },
  { label: "In 3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "Next week", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

type RecipientGroup = "company" | "personal" | "managers";

const RECIPIENT_GROUP_LABELS: Record<RecipientGroup, string> = {
  company: "Company line agents",
  personal: "Personal line agents",
  managers: "Managers",
};

function matchesRecipientGroup(user: UserType, group: RecipientGroup): boolean {
  if (group === "managers") return user.role === "manager";
  if (user.role !== "agent") return false;
  if (user.lineOfBusiness === "commercial") return group === "company";
  if (user.lineOfBusiness === "personal") return group === "personal";
  const profileText = `${user.title ?? ""} ${user.bio ?? ""} ${user.email} ${user.name}`.toLowerCase();
  const looksCompanyLine =
    /\b(company|commercial|business|bop|workers'? comp|general liability|professional liability)\b/.test(
      profileText
    );
  return group === (looksCompanyLine ? "company" : "personal");
}

function groupIds(staff: UserType[], group: RecipientGroup): string[] {
  return staff.filter((u) => matchesRecipientGroup(u, group)).map((u) => u.id);
}

function nowPlusMs(ms: number): string {
  const d = new Date(Date.now() + ms);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

export function NewReminderModal({
  open,
  onClose,
  tenantId,
  userId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  userId: string;
  onCreated?: () => void;
}) {
  const [kind, setKind] = useState<"personal" | "company">("personal");
  const [title, setTitle] = useState("");
  const [presetIdx, setPresetIdx] = useState<number | "custom">(1);
  const [customAt, setCustomAt] = useState<string>(() => nowPlusMs(24 * 60 * 60 * 1000));
  const [note, setNote] = useState("");
  const [importance, setImportance] = useState<TaskSeverity>("info");
  const [recipientIds, setRecipientIds] = useState<Set<string>>(new Set());
  const [recipientGroup, setRecipientGroup] = useState<RecipientGroup>("personal");
  const [recurrencePattern, setRecurrencePattern] = useState<
    "none" | ReminderRecurrencePattern
  >("none");
  const [customInterval, setCustomInterval] = useState<number>(14);
  const [endsAt, setEndsAt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staff = useMemo(
    () =>
      api.users
        .list(tenantId)
        .filter((u) => u.role === "agent" || u.role === "manager")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tenantId, open]
  );

  const visibleRecipients = useMemo(
    () =>
      staff
        .filter((u) => matchesRecipientGroup(u, recipientGroup))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [recipientGroup, staff]
  );

  useEffect(() => {
    if (!open) return;
    setKind("personal");
    setTitle("");
    setPresetIdx(1);
    setCustomAt(nowPlusMs(24 * 60 * 60 * 1000));
    setNote("");
    setImportance("info");
    setRecipientGroup("personal");
    setRecipientIds(new Set(groupIds(staff, "personal")));
    setRecurrencePattern("none");
    setCustomInterval(14);
    setEndsAt("");
    setError(null);
    setBusy(false);
  }, [open, staff]);

  function toggleRecipient(id: string) {
    setRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function targetIso(): string | null {
    if (presetIdx === "custom") {
      if (!customAt) return null;
      const ts = new Date(customAt).getTime();
      if (Number.isNaN(ts)) return null;
      if (ts <= Date.now()) return null;
      return new Date(ts).toISOString();
    }
    return new Date(Date.now() + PRESETS[presetIdx].ms).toISOString();
  }

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError(
        kind === "company"
          ? "Give the company reminder a short title so recipients know what it's about."
          : "Give the reminder a short title so you'll know what it's about."
      );
      return;
    }
    if (kind === "company" && recipientIds.size === 0) {
      setError("Pick at least one recipient.");
      return;
    }
    const at = targetIso();
    if (!at) {
      setError("Pick a future date + time.");
      return;
    }

    const recurrence = buildRecurrence(recurrencePattern, customInterval, endsAt);
    setBusy(true);
    try {
      if (kind === "company") {
        api.reminders.createBatch({
          tenantId,
          userIds: Array.from(recipientIds),
          title: title.trim(),
          remindAt: at,
          note: note.trim() || undefined,
          importance,
          recurrence,
        });
      } else {
        api.reminders.create({
          tenantId,
          userId,
          title: title.trim(),
          remindAt: at,
          note: note.trim() || undefined,
          importance,
          recurrence,
        });
      }
      onCreated?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const isCompany = kind === "company";
  const visibleSelectedCount = visibleRecipients.filter((u) => recipientIds.has(u.id)).length;
  const allSelected =
    visibleRecipients.length > 0 && visibleSelectedCount === visibleRecipients.length;
  const target = targetIso();

  return (
    <Modal open={open} onClose={onClose} title="New reminder" size="lg">
      <div className="space-y-5">
        <div>
          <label className="label">Reminder type</label>
          <div className="grid sm:grid-cols-2 gap-2">
            <button
              type="button"
              className={`rounded-md border px-3 py-2.5 text-left text-sm ${
                kind === "personal"
                  ? "border-gold-400 bg-gold-50 text-ink-900"
                  : "border-ink-200 bg-white hover:border-ink-300"
              }`}
              onClick={() => setKind("personal")}
              disabled={busy}
            >
              <div className="flex items-center gap-2 font-semibold">
                <User className="h-4 w-4 text-gold-700" /> Personal
              </div>
              <div className="mt-1 text-xs text-ink-500">Only appears on your dashboard.</div>
            </button>
            <button
              type="button"
              className={`rounded-md border px-3 py-2.5 text-left text-sm ${
                kind === "company"
                  ? "border-gold-400 bg-gold-50 text-ink-900"
                  : "border-ink-200 bg-white hover:border-ink-300"
              }`}
              onClick={() => setKind("company")}
              disabled={busy}
            >
              <div className="flex items-center gap-2 font-semibold">
                <Building2 className="h-4 w-4 text-gold-700" /> Company
              </div>
              <div className="mt-1 text-xs text-ink-500">
                Send independent copies to selected teammates.
              </div>
            </button>
          </div>
        </div>

        <p className="text-sm text-ink-600 flex items-start gap-2">
          {isCompany ? (
            <Building2 className="h-4 w-4 text-gold-600 mt-0.5 shrink-0" />
          ) : (
            <Sparkles className="h-4 w-4 text-gold-600 mt-0.5 shrink-0" />
          )}
          <span>
            {isCompany
              ? "Pick who should receive it. Each teammate gets their own copy, so dismissing or snoozing does not affect anyone else."
              : "A general reminder for yourself. Not tied to any Activity Center card, useful for follow-ups like calling a carrier rep or checking a policy update."}
          </span>
        </p>

        <div>
          <label className="label">Title</label>
          <input
            className="input text-sm"
            placeholder={
              isCompany
                ? "e.g., Quarterly carrier appetite review @ 3pm"
                : "e.g., Call carrier rep about endorsement"
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            disabled={busy}
          />
        </div>

        {isCompany && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="label !mb-0">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Recipients ({visibleSelectedCount}/{visibleRecipients.length})
                </span>
              </label>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="company-recipient-sort">
                  Recipient group
                </label>
                <select
                  id="company-recipient-sort"
                  className="input !h-8 !w-auto !py-1 text-xs"
                  value={recipientGroup}
                  onChange={(e) => {
                    const nextGroup = e.target.value as RecipientGroup;
                    setRecipientGroup(nextGroup);
                    setRecipientIds(new Set(groupIds(staff, nextGroup)));
                  }}
                  disabled={busy || staff.length === 0}
                >
                  <option value="company">Company line agents</option>
                  <option value="personal">Personal line agents</option>
                  <option value="managers">Managers</option>
                </select>
                <button
                  type="button"
                  className="text-xs text-ink-600 hover:text-ink-900 underline"
                  disabled={busy || staff.length === 0}
                  onClick={() => {
                    if (allSelected) setRecipientIds(new Set());
                    else setRecipientIds(new Set(visibleRecipients.map((u) => u.id)));
                  }}
                >
                  {allSelected ? "Unselect all" : "Select all"}
                </button>
              </div>
            </div>
            {staff.length === 0 ? (
              <div className="text-sm text-ink-400">
                No agents or managers in this agency yet.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 dropdown-scroll-y rounded-md border border-ink-100 p-2 bg-ink-50/30">
                {visibleRecipients.length === 0 && (
                  <div className="sm:col-span-2 px-3 py-5 text-center text-sm text-ink-400">
                    No {RECIPIENT_GROUP_LABELS[recipientGroup].toLowerCase()} in this agency yet.
                  </div>
                )}
                {visibleRecipients.map((u) => {
                  const checked = recipientIds.has(u.id);
                  return (
                    <label
                      key={u.id}
                      className={`flex items-start gap-2 rounded px-2 py-1.5 cursor-pointer text-sm ${
                        checked
                          ? "bg-gold-50 border border-gold-200"
                          : "border border-transparent hover:bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        onChange={() => toggleRecipient(u.id)}
                        disabled={busy}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-ink-800 truncate">
                          {u.name}
                          {u.id === userId ? " (you)" : ""}
                        </span>
                        <span className="block text-[11px] text-ink-500">
                          {u.role === "manager" ? "Manager" : "Agent"} - {u.email}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label">When?</label>
          <div className="grid sm:grid-cols-2 gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPresetIdx(i)}
                disabled={busy}
                className={`text-left rounded-md border px-3 py-2 text-sm ${
                  presetIdx === i
                    ? "border-gold-400 bg-gold-50"
                    : "border-ink-200 bg-white hover:border-ink-300"
                }`}
              >
                <div className="font-medium">{p.label}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">
                  {fmt.dateTime(new Date(Date.now() + p.ms).toISOString())}
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPresetIdx("custom")}
              disabled={busy}
              className={`text-left rounded-md border px-3 py-2 text-sm sm:col-span-2 ${
                presetIdx === "custom"
                  ? "border-gold-400 bg-gold-50"
                  : "border-ink-200 bg-white hover:border-ink-300"
              }`}
            >
              <div className="font-medium flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" /> Pick a custom date + time
              </div>
              {presetIdx === "custom" && (
                <input
                  type="datetime-local"
                  className="input mt-2 text-sm"
                  value={customAt}
                  onChange={(e) => setCustomAt(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Importance</label>
          <ImportancePicker value={importance} onChange={setImportance} disabled={busy} />
        </div>

        <RecurrencePicker
          pattern={recurrencePattern}
          onPatternChange={setRecurrencePattern}
          customInterval={customInterval}
          onCustomIntervalChange={setCustomInterval}
          endsAt={endsAt}
          onEndsAtChange={setEndsAt}
          disabled={busy}
        />

        <div>
          <label className="label">Note (optional)</label>
          <textarea
            className="input text-sm min-h-[80px]"
            placeholder={
              isCompany
                ? "Background, links, prep steps, or context recipients should see when this fires."
                : "Anything else you want surfaced when this fires?"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
        </div>

        {error && (
          <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
          <div className="text-[11px] text-ink-500 flex items-center gap-1.5 flex-wrap">
            <Bell className="h-3 w-3 text-blue-500" />
            {isCompany ? "Surfaces on each recipient's dashboard" : "Will surface on your dashboard"}{" "}
            <Badge tone="info">{target ? fmt.relative(target) : "-"}</Badge>
            {recurrencePattern !== "none" && (
              <Badge tone="warn">
                Recurs{" "}
                {recurrencePattern === "custom"
                  ? `every ${customInterval}d`
                  : recurrencePattern}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={submit}
              disabled={busy}
            >
              <Bell className="h-3.5 w-3.5" />
              {busy
                ? "Saving..."
                : isCompany
                ? `Send to ${recipientIds.size} recipient${recipientIds.size === 1 ? "" : "s"}`
                : "Save reminder"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
