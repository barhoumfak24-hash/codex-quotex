import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Mail, Send, Trash2, Users, X } from "lucide-react";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmt } from "@/lib/format";
import type {
  AssetType,
  CustomMessageAttachment,
  CustomMessageAudience,
  CustomMessageRecurrence,
  ProspectStatus,
} from "@/types";

const ASSET_TYPES: AssetType[] = [
  "coastal_home",
  "luxury_vehicle",
  "yacht",
  "jewelry",
  "umbrella_liability",
  "full_portfolio",
  "other",
];

const PROSPECT_STATUSES: ProspectStatus[] = [
  "new",
  "contacted",
  "quote_in_progress",
  "abandoned",
  "nurturing",
  "converted",
  "lost",
];

// =====================================================================
// Custom (non-AI) message composer.
//
// What ships out is exactly what staff types — the AI never rewrites
// these messages. Lives in api.customMessages, not the MarketingMessage
// table the AI campaigns use.
// =====================================================================

export function CustomMessageComposer({
  open,
  onClose,
  onSubmitted,
  // Optional pre-population for deep links (e.g. "Reply to customer"
  // from the client detail page). When supplied, audience opens
  // pre-locked to "selected" with the customer id checked, the
  // subject + body are seeded, and onSent fires after a
  // successful submit so the caller can chain side effects (mark a
  // pending request resolved, clear URL params, etc.).
  initialCustomerIds,
  initialChannel,
  initialSubject,
  initialBody,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  initialCustomerIds?: string[];
  initialChannel?: "email";
  initialSubject?: string;
  initialBody?: string;
  onSent?: () => void;
}) {
  const { agency } = useTenant();
  const { user } = useAuth();

  const channel = "email" as const;
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [attachments, setAttachments] = useState<CustomMessageAttachment[]>([]);

  const [audience, setAudience] = useState<CustomMessageAudience>(
    initialCustomerIds && initialCustomerIds.length > 0 ? "selected" : "all_clients"
  );
  const [filterAudienceType, setFilterAudienceType] = useState<"clients" | "prospects" | "both">("both");
  const [filterAssetType, setFilterAssetType] = useState<AssetType | "">("");
  const [filterProspectStatus, setFilterProspectStatus] = useState<ProspectStatus | "">("");
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(
    new Set(initialCustomerIds ?? [])
  );
  const [selectedProspects, setSelectedProspects] = useState<Set<string>>(new Set());
  const [pickerQuery, setPickerQuery] = useState("");

  // Re-sync from props when the composer is reopened with a new
  // deep-link target. Without this, a second "Reply to customer"
  // click in the same session would still show the previous
  // selection / draft.
  useEffect(() => {
    if (!open) return;
    setSubject(initialSubject ?? "");
    setBody(initialBody ?? "");
    if (initialCustomerIds && initialCustomerIds.length > 0) {
      setAudience("selected");
      setSelectedCustomers(new Set(initialCustomerIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCustomerIds?.join(","), initialChannel, initialSubject, initialBody]);

  const [scheduleMode, setScheduleMode] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [recurrence, setRecurrence] = useState<CustomMessageRecurrence>("none");

  // Live recipient count preview.
  const recipients = useMemo(() => {
    if (!agency) return { customers: [], prospects: [] };
    return api.customMessages.resolveRecipients({
      tenantId: agency.id,
      audience,
      filter:
        audience === "filter"
          ? {
              audienceType: filterAudienceType,
              assetType: (filterAssetType || undefined) as AssetType | undefined,
              prospectStatus: (filterProspectStatus || undefined) as ProspectStatus | undefined,
            }
          : undefined,
      selectedCustomerIds: Array.from(selectedCustomers),
      selectedProspectIds: Array.from(selectedProspects),
    });
  }, [
    agency,
    audience,
    filterAudienceType,
    filterAssetType,
    filterProspectStatus,
    selectedCustomers,
    selectedProspects,
  ]);
  const recipientCount = recipients.customers.length + recipients.prospects.length;

  if (!agency || !user) return null;

  function handleFiles(files: File[]) {
    if (files.length === 0) return;
    const newOnes: CustomMessageAttachment[] = files.map((f) => ({
      fileName: f.name,
      fileType: f.type || "application/octet-stream",
      sizeBytes: f.size,
    }));
    setAttachments((prev) => [...prev, ...newOnes]);
  }
  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    setSubject("");
    setBody("");
    setAttachments([]);
    setAudience("all_clients");
    setFilterAudienceType("both");
    setFilterAssetType("");
    setFilterProspectStatus("");
    setSelectedCustomers(new Set());
    setSelectedProspects(new Set());
    setPickerQuery("");
    setScheduleMode("now");
    setScheduledFor("");
    setRecurrence("none");
  }

  function submit() {
    if (!body.trim() || recipientCount === 0) return;
    api.customMessages.create({
      tenantId: agency!.id,
      createdById: user!.id,
      channel,
      subject: subject.trim() || undefined,
      body: body.trim(),
      attachments,
      audience,
      filter:
        audience === "filter"
          ? {
              audienceType: filterAudienceType,
              assetType: (filterAssetType || undefined) as AssetType | undefined,
              prospectStatus: (filterProspectStatus || undefined) as ProspectStatus | undefined,
            }
          : undefined,
      selectedCustomerIds: Array.from(selectedCustomers),
      selectedProspectIds: Array.from(selectedProspects),
      scheduledFor: scheduleMode === "scheduled" && scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      recurrence,
    });
    reset();
    onSubmitted();
    onSent?.();
    onClose();
  }

  const isValid = body.trim().length > 0 && recipientCount > 0;

  return (
    <Modal open={open} onClose={onClose} title="Compose custom message" size="lg">
      <div className="space-y-5">
        <Disclaimer>
          Messages send exactly as typed — the AI does not rewrite them. Audience and schedule are
          stored locally in this demo and not delivered to any real recipient.
        </Disclaimer>

        <div>
          <div className="label">Channel</div>
          <div className="inline-flex h-11 items-center gap-2 rounded-md border border-gold-300 bg-gold-50 px-3 text-sm font-semibold text-gold-900">
            <Mail className="h-4 w-4" /> Email
          </div>
        </div>

        <div>
          <label className="label">Subject</label>
          <input
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What's this email about?"
          />
        </div>

        <div>
          <label className="label">Message body (sent verbatim)</label>
          <textarea
            className="input min-h-[140px]"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              channel === "email"
                ? "Hi {first name},\n\nWriting with a quick update on…"
                : "Quick note from the agency — please reply STOP to opt out."
            }
          />
        </div>

        {/* Attachments */}
        <div>
          <div className="label">Attachments</div>
          <FileDropZone
            title="Attach files"
            help="Drop files or paste a copied image/screenshot. Attachments stay metadata-only in demo."
            multiple
            compact
            icon="attachment"
            onFiles={handleFiles}
          />
          {attachments.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {attachments.map((a, i) => (
                <li key={`${a.fileName}-${i}`} className="flex items-center justify-between gap-2 border border-ink-100 rounded px-2 py-1.5">
                  <span className="truncate">{a.fileName}</span>
                  <button
                    type="button"
                    className="text-ink-400 hover:text-rose-600"
                    onClick={() => removeAttachment(i)}
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-ink-400">
            Demo only — filenames are recorded, files are not uploaded. In production these go to
            S3 and ride along with each send.
          </p>
        </div>

        {/* Audience */}
        <div>
          <div className="label">Audience</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {(
              [
                { v: "all_clients", label: "All clients" },
                { v: "all_prospects", label: "All prospects" },
                { v: "filter", label: "Filter by criteria" },
                { v: "selected", label: "Pick individually" },
              ] as { v: CustomMessageAudience; label: string }[]
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setAudience(o.v)}
                className={`text-left px-3 py-2 rounded-md border text-sm ${
                  audience === o.v ? "bg-ink-900 text-white border-ink-900" : "bg-white border-ink-200 hover:bg-ink-50"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {audience === "filter" && (
            <div className="mt-3 rounded-md border border-ink-100 p-3 space-y-3">
              <div>
                <div className="label">Audience type</div>
                <div className="flex gap-2 flex-wrap">
                  {(["both", "clients", "prospects"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFilterAudienceType(t)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                        filterAudienceType === t
                          ? "bg-ink-900 text-white border-ink-900"
                          : "border-ink-200 text-ink-700 bg-white hover:bg-ink-50"
                      }`}
                    >
                      {fmt.titleCase(t)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Asset type (prospects only)</label>
                  <select
                    className="input"
                    value={filterAssetType}
                    onChange={(e) => setFilterAssetType(e.target.value as AssetType | "")}
                  >
                    <option value="">Any</option>
                    {ASSET_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {fmt.titleCase(t.replace(/_/g, " "))}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Prospect status</label>
                  <select
                    className="input"
                    value={filterProspectStatus}
                    onChange={(e) => setFilterProspectStatus(e.target.value as ProspectStatus | "")}
                  >
                    <option value="">Any</option>
                    {PROSPECT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {fmt.titleCase(s.replace(/_/g, " "))}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {audience === "selected" && (
            <SelectedPicker
              tenantId={agency.id}
              selectedCustomers={selectedCustomers}
              setSelectedCustomers={setSelectedCustomers}
              selectedProspects={selectedProspects}
              setSelectedProspects={setSelectedProspects}
              query={pickerQuery}
              setQuery={setPickerQuery}
            />
          )}
        </div>

        {/* Schedule */}
        <div>
          <div className="label">When to send</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="flex gap-2 flex-wrap mb-2">
                {(["now", "scheduled"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setScheduleMode(m)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                      scheduleMode === m
                        ? "bg-ink-900 text-white border-ink-900"
                        : "border-ink-200 text-ink-700 bg-white hover:bg-ink-50"
                    }`}
                  >
                    {m === "now" ? "Send immediately" : "Schedule"}
                  </button>
                ))}
              </div>
              {scheduleMode === "scheduled" && (
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              )}
            </div>
            <div>
              <label className="label">Recurrence</label>
              <select
                className="input"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as CustomMessageRecurrence)}
              >
                <option value="none">One-time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="rounded-md border border-ink-100 bg-ink-50 p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <Users className="inline h-4 w-4 text-gold-600 mr-1" />
            <strong>{recipientCount}</strong> recipient{recipientCount === 1 ? "" : "s"}
            {recipients.customers.length > 0 && (
              <span className="text-ink-500"> · {recipients.customers.length} clients</span>
            )}
            {recipients.prospects.length > 0 && (
              <span className="text-ink-500"> · {recipients.prospects.length} prospects</span>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!isValid}
              onClick={submit}
              title={!isValid ? "Add a message body and select at least one recipient" : undefined}
            >
              {scheduleMode === "scheduled" || recurrence !== "none" ? (
                <>
                  <CalendarClock className="h-4 w-4" />
                  {recurrence !== "none" ? `Save ${recurrence}` : "Schedule"}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Send to {recipientCount}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Individual recipient picker (when audience === "selected")
// ---------------------------------------------------------------------
function SelectedPicker({
  tenantId,
  selectedCustomers,
  setSelectedCustomers,
  selectedProspects,
  setSelectedProspects,
  query,
  setQuery,
}: {
  tenantId: string;
  selectedCustomers: Set<string>;
  setSelectedCustomers: (s: Set<string>) => void;
  selectedProspects: Set<string>;
  setSelectedProspects: (s: Set<string>) => void;
  query: string;
  setQuery: (s: string) => void;
}) {
  const { user } = useAuth();
  const customers = useMemo(
    () =>
      api.customers.listVisible(
        tenantId,
        user ? { id: user.id, role: user.role } : undefined
      ),
    [tenantId, user?.id, user?.role]
  );
  const prospects = useMemo(() => api.prospects.listByTenant(tenantId), [tenantId]);

  const q = query.trim().toLowerCase();
  const match = (n: string, e: string) =>
    !q || n.toLowerCase().includes(q) || e.toLowerCase().includes(q);

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  return (
    <div className="mt-3 rounded-md border border-ink-100 p-3 space-y-3">
      <input
        className="input"
        placeholder="Search clients and prospects"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
            Clients ({selectedCustomers.size} selected)
          </div>
          <ul className="max-h-48 overflow-y-auto divide-y divide-ink-100 border border-ink-100 rounded">
            {customers.filter((c) => match(c.name, c.email)).map((c) => (
              <li key={c.id} className="px-2 py-1.5">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCustomers.has(c.id)}
                    onChange={() => toggle(selectedCustomers, c.id, setSelectedCustomers)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{c.name}</span>
                    <span className="block text-[11px] text-ink-500 truncate">{c.email}</span>
                  </span>
                </label>
              </li>
            ))}
            {customers.length === 0 && <li className="p-3 text-xs text-ink-400">No clients.</li>}
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
            Prospects ({selectedProspects.size} selected)
          </div>
          <ul className="max-h-48 overflow-y-auto divide-y divide-ink-100 border border-ink-100 rounded">
            {prospects.filter((p) => match(p.name, p.email)).map((p) => (
              <li key={p.id} className="px-2 py-1.5">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedProspects.has(p.id)}
                    onChange={() => toggle(selectedProspects, p.id, setSelectedProspects)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    <span className="block text-[11px] text-ink-500 truncate">{p.email}</span>
                  </span>
                </label>
              </li>
            ))}
            {prospects.length === 0 && <li className="p-3 text-xs text-ink-400">No prospects.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Read-only list shown on MarketingActivityPage
// ---------------------------------------------------------------------
export function CustomMessageList({
  onCancel,
  onPause,
  onResume,
  onSendNow,
  onDelete,
  searchQuery,
}: {
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onSendNow: (id: string) => void;
  onDelete: (id: string) => void;
  searchQuery?: string;
}) {
  const { agency } = useTenant();
  if (!agency) return null;
  const all = api.customMessages.listByTenant(agency.id);
  const q = (searchQuery ?? "").trim().toLowerCase();
  const list = q
    ? all.filter(
        (m) =>
          (m.subject ?? "").toLowerCase().includes(q) ||
          m.body.toLowerCase().includes(q)
      )
    : all;

  if (list.length === 0) {
    return (
      <div className="text-sm text-ink-400">
        {q
          ? `No custom messages match "${searchQuery}".`
          : "No custom messages yet. Compose your first staff-authored message above."}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-ink-100">
      {list.map((m) => {
        const audienceLabel =
          m.audience === "all_clients"
            ? "All clients"
            : m.audience === "all_prospects"
            ? "All prospects"
            : m.audience === "filter"
            ? `Filter (${m.filter?.audienceType ?? "both"})`
            : "Selected individuals";
        const scheduleLabel =
          m.recurrence !== "none"
            ? `Recurring · ${fmt.titleCase(m.recurrence)}`
            : m.scheduledFor
            ? `Scheduled · ${fmt.dateTime(m.scheduledFor)}`
            : `Sent · ${fmt.dateTime(m.lastSentAt ?? m.createdAt)}`;
        const isRecurring = m.recurrence !== "none";
        return (
          <li key={m.id} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  <Mail className="inline h-3.5 w-3.5 mr-1 text-ink-400" />
                  {m.subject ?? "Email"}
                </div>
                <div className="text-xs text-ink-500 mt-0.5">
                  {audienceLabel} · {m.recipientCount} recipient{m.recipientCount === 1 ? "" : "s"} · {scheduleLabel}
                  {m.attachments.length > 0 && <> · {m.attachments.length} attachment{m.attachments.length === 1 ? "" : "s"}</>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <StatusPill status={m.status} />
                <div className="flex">
                  {m.status === "scheduled" && (
                    <button className="btn-ghost text-xs" onClick={() => onSendNow(m.id)}>
                      Send now
                    </button>
                  )}
                  {m.status === "scheduled" && (
                    <button className="btn-ghost text-xs" onClick={() => onCancel(m.id)}>
                      Cancel
                    </button>
                  )}
                  {isRecurring && m.status === "recurring_active" && (
                    <button className="btn-ghost text-xs" onClick={() => onPause(m.id)}>
                      Pause
                    </button>
                  )}
                  {isRecurring && m.status === "recurring_paused" && (
                    <button className="btn-ghost text-xs" onClick={() => onResume(m.id)}>
                      Resume
                    </button>
                  )}
                  <button
                    className="btn-ghost text-xs text-rose-600"
                    onClick={() => onDelete(m.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
            <p className="mt-2 text-sm text-ink-700 line-clamp-3 whitespace-pre-wrap">{m.body}</p>
            {m.attachments.length > 0 && (
              <div className="mt-1 text-[11px] text-ink-500">
                Attached: {m.attachments.map((a) => a.fileName).join(", ")}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "sent" || status === "recurring_active"
      ? "bg-emerald-50 text-emerald-700"
      : status === "cancelled"
      ? "bg-ink-100 text-ink-600"
      : status === "scheduled"
      ? "bg-amber-50 text-amber-800"
      : status === "recurring_paused"
      ? "bg-blue-50 text-blue-700"
      : "bg-ink-100 text-ink-700";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${tone}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
