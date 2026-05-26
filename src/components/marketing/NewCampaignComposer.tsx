import { useMemo, useState } from "react";
import {
  CalendarClock,
  FileImage,
  FileText,
  Paperclip,
  Plus,
  Repeat,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { CustomMessageRecurrence } from "@/types";

// =====================================================================
// Manager-only composer for a brand-new AI campaign.
//
// Lets the manager describe the outreach in plain language
// (campaign name + brief), pick the audience (all clients / all
// prospects / a hand-picked subset), attach reference files the
// AI should reference (PDFs, images, one-pagers), and send. The
// AI personalizes the brief into each recipient's voice using the
// agency's marketing configuration (style + sign-off).
//
// In production the file picker uploads to the document service
// and the LLM extracts content + drafts each personalized
// message. The demo records filename + type metadata so the
// audit trail is realistic; the brief feeds the body verbatim
// per recipient with style-specific opening + sign-off applied.
// =====================================================================

export function NewCampaignComposer({
  open,
  onClose,
  tenantId,
  uploadedById,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  uploadedById: string;
  onCreated?: (campaignName: string, messageCount: number) => void;
}) {
  const [name, setName] = useState("");
  // Channels are multi-select — a campaign can go out on email + SMS
  // at the same time.
  const [channels, setChannels] = useState<Set<"email" | "sms">>(
    () => new Set<"email" | "sms">(["email", "sms"])
  );
  const [brief, setBrief] = useState("");
  // Audience is additive: all clients and/or all prospects can both be
  // on, plus an optional hand-picked subset.
  const [allClients, setAllClients] = useState(true);
  const [allProspects, setAllProspects] = useState(false);
  const [handPick, setHandPick] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [selectedProspectIds, setSelectedProspectIds] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<
    { fileName: string; fileType?: string; description?: string }[]
  >([]);
  const [sendMode, setSendMode] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState<string>(() => {
    // Default to 1 hour from now, rounded down to the minute.
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000)
      .toISOString()
      .slice(0, 16);
  });
  const [recurrence, setRecurrence] = useState<CustomMessageRecurrence>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cfg = useMemo(() => api.marketing.getConfig(tenantId), [tenantId, open]);
  const customers = useMemo(
    () => (open ? api.customers.list(tenantId) : []),
    [tenantId, open]
  );
  const prospects = useMemo(
    () => (open ? api.prospects.listByTenant(tenantId) : []),
    [tenantId, open]
  );

  const clientReach = allClients ? customers.length : selectedCustomerIds.size;
  const prospectReach = allProspects ? prospects.length : selectedProspectIds.size;
  const audienceSize = clientReach + prospectReach;

  function toggleChannel(c: "email" | "sms") {
    setChannels((s) => {
      const next = new Set(s);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function reset() {
    setName("");
    setBrief("");
    setChannels(new Set(["email", "sms"]));
    setAllClients(true);
    setAllProspects(false);
    setHandPick(false);
    setSelectedCustomerIds(new Set());
    setSelectedProspectIds(new Set());
    setFiles([]);
    setSendMode("now");
    setRecurrence("none");
    setError(null);
    setBusy(false);
  }

  function closeAndReset() {
    reset();
    onClose();
  }

  function addFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    const next = Array.from(fl).map((f) => ({
      fileName: f.name,
      fileType: f.type || "application/octet-stream",
    }));
    setFiles((s) => [...s, ...next]);
  }

  function setDescription(idx: number, value: string) {
    setFiles((s) => s.map((f, i) => (i === idx ? { ...f, description: value } : f)));
  }

  function toggleCustomer(id: string) {
    setSelectedCustomerIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleProspect(id: string) {
    setSelectedProspectIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function launch() {
    setError(null);
    if (!name.trim()) {
      setError("Pick a campaign name.");
      return;
    }
    if (channels.size === 0) {
      setError("Pick at least one channel (email and/or SMS).");
      return;
    }
    if (!brief.trim()) {
      setError("Add a brief — this is what the AI personalizes for each recipient.");
      return;
    }
    if (audienceSize === 0) {
      setError("No audience selected. Pick at least one recipient.");
      return;
    }
    let scheduledIso: string | undefined;
    if (sendMode === "scheduled") {
      if (!scheduledFor) {
        setError("Pick a send date + time.");
        return;
      }
      const ts = new Date(scheduledFor).getTime();
      if (Number.isNaN(ts)) {
        setError("That date/time looks invalid.");
        return;
      }
      if (ts <= Date.now()) {
        setError("Scheduled send time must be in the future.");
        return;
      }
      scheduledIso = new Date(ts).toISOString();
    }
    setBusy(true);
    try {
      // Faux AI latency so the busy state is visible. Production
      // is a real LLM round-trip per recipient.
      await new Promise((r) => setTimeout(r, 600));
      const { messageCount } = api.marketing.composeAiCampaign({
        tenantId,
        name: name.trim(),
        channels: Array.from(channels),
        brief: brief.trim(),
        includeAllClients: allClients,
        includeAllProspects: allProspects,
        selectedCustomerIds: allClients ? [] : Array.from(selectedCustomerIds),
        selectedProspectIds: allProspects ? [] : Array.from(selectedProspectIds),
        attachments: files,
        scheduledFor: scheduledIso,
        recurrence,
        actorId: uploadedById,
      });
      onCreated?.(name.trim(), messageCount);
      closeAndReset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={closeAndReset} title="Compose new AI campaign" size="xl">
      <div className="space-y-5">
        <p className="text-sm text-ink-600">
          Describe the outreach in your own words. The AI personalizes the brief into each
          recipient's voice using your agency's configured style{" "}
          <span className="font-medium">({fmt.titleCase(cfg.messageStyle)})</span> and sign-off.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Campaign name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Spring portfolio review"
              disabled={busy}
            />
          </div>
          <div>
            <label className="label">Channel (pick one or both)</label>
            <div className="flex gap-2">
              {(["email", "sms"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleChannel(c)}
                  disabled={busy}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    channels.has(c)
                      ? "bg-gold-100 border-gold-300 text-gold-800"
                      : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
                  }`}
                >
                  {c.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="label">Brief — what should the AI tell recipients?</label>
          <textarea
            className="input min-h-[120px]"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={"e.g., Reminder that our annual portfolio review window opens next month. Offer a 30-minute call to review coverage, walk through any life changes, and refresh appraisals where needed. Mention the wind-mitigation re-inspection deadline for Florida coastal homeowners."}
            disabled={busy}
          />
          <p className="mt-1 text-[11px] text-ink-500">
            The AI personalizes each message with the recipient's name, then wraps the brief in
            your agency's configured opening + sign-off.
          </p>
        </div>

        <div>
          <label className="label">Audience (combine any of these)</label>
          <div className="grid sm:grid-cols-3 gap-2 mb-3">
            <button
              type="button"
              onClick={() => setAllClients((v) => !v)}
              disabled={busy}
              className={`text-left rounded-md border px-3 py-2 text-sm ${
                allClients
                  ? "border-gold-400 bg-gold-50"
                  : "border-ink-200 bg-white hover:border-ink-300"
              }`}
            >
              All clients ({customers.length})
            </button>
            <button
              type="button"
              onClick={() => setAllProspects((v) => !v)}
              disabled={busy}
              className={`text-left rounded-md border px-3 py-2 text-sm ${
                allProspects
                  ? "border-gold-400 bg-gold-50"
                  : "border-ink-200 bg-white hover:border-ink-300"
              }`}
            >
              All prospects ({prospects.length})
            </button>
            <button
              type="button"
              onClick={() => setHandPick((v) => !v)}
              disabled={busy}
              className={`text-left rounded-md border px-3 py-2 text-sm ${
                handPick
                  ? "border-gold-400 bg-gold-50"
                  : "border-ink-200 bg-white hover:border-ink-300"
              }`}
            >
              Hand-pick recipients
            </button>
          </div>

          {handPick && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-md border border-ink-100 max-h-[180px] overflow-y-auto">
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-100">
                  Clients ({allClients ? "all included" : `${selectedCustomerIds.size} selected`})
                </div>
                {allClients ? (
                  <div className="px-3 py-3 text-[11px] text-ink-400">
                    "All clients" is on — every client is already included.
                  </div>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {customers.map((c) => (
                      <li key={c.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-ink-50">
                          <input
                            type="checkbox"
                            checked={selectedCustomerIds.has(c.id)}
                            onChange={() => toggleCustomer(c.id)}
                          />
                          <span className="truncate flex-1">{c.name}</span>
                          <span className="text-[11px] text-ink-400">{c.email}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-md border border-ink-100 max-h-[180px] overflow-y-auto">
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-100">
                  Prospects ({allProspects ? "all included" : `${selectedProspectIds.size} selected`})
                </div>
                {allProspects ? (
                  <div className="px-3 py-3 text-[11px] text-ink-400">
                    "All prospects" is on — every prospect is already included.
                  </div>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {prospects.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-ink-50">
                          <input
                            type="checkbox"
                            checked={selectedProspectIds.has(p.id)}
                            onChange={() => toggleProspect(p.id)}
                          />
                          <span className="truncate flex-1">{p.name}</span>
                          <span className="text-[11px] text-ink-400">{p.email}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Scheduling + recurrence */}
        <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3 space-y-3">
          <div>
            <label className="label flex items-center gap-1.5">
              <CalendarClock className="h-3 w-3" /> Send timing
            </label>
            <div className="grid sm:grid-cols-2 gap-2">
              {(
                [
                  ["now", "Send now"],
                  ["scheduled", "Schedule for later"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSendMode(value)}
                  disabled={busy}
                  className={`text-left rounded-md border px-3 py-2 text-sm ${
                    sendMode === value
                      ? "border-gold-400 bg-gold-50"
                      : "border-ink-200 bg-white hover:border-ink-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {sendMode === "scheduled" && (
              <div className="mt-2">
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  disabled={busy}
                />
                <p className="mt-1 text-[11px] text-ink-500">
                  Messages will queue and dispatch at this time. Times are in your local
                  timezone.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <Repeat className="h-3 w-3" /> Recurrence
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  ["none", "One-shot"],
                  ["daily", "Daily"],
                  ["weekly", "Weekly"],
                  ["monthly", "Monthly"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRecurrence(value)}
                  disabled={busy}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    recurrence === value
                      ? "bg-gold-100 border-gold-300 text-gold-800"
                      : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {recurrence !== "none" && (
              <p className="mt-1 text-[11px] text-ink-500">
                The AI will re-fan the same brief to the same audience on this cadence
                until you pause the campaign.
              </p>
            )}
          </div>
        </div>

        {/* Attachments */}
        <div>
          <label className="label flex items-center gap-1.5">
            <Paperclip className="h-3 w-3" /> Attachments (optional)
          </label>
          <label className="block rounded-md border border-dashed border-ink-200 px-4 py-3 text-sm text-center cursor-pointer hover:bg-ink-50">
            <input
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
              onChange={(e) => {
                addFiles(e.target.files);
                e.currentTarget.value = "";
              }}
              disabled={busy}
            />
            <div className="flex items-center justify-center gap-2 text-ink-700">
              <Plus className="h-4 w-4" />
              {files.length === 0
                ? "Attach reference files for the AI / recipients"
                : "Add more files"}
            </div>
            <div className="text-[11px] text-ink-400 mt-1">
              Demo only — filenames + types are recorded; production uploads to the documents
              service and the LLM reads them as context.
            </div>
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {files.map((f, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-ink-50 border border-ink-100"
                >
                  {f.fileType?.startsWith("image/") ? (
                    <FileImage className="h-3.5 w-3.5 text-ink-400" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-ink-400" />
                  )}
                  <span className="font-medium truncate flex-1">{f.fileName}</span>
                  <input
                    className="input !py-0.5 !px-2 !text-[11px] max-w-[200px]"
                    placeholder="Description (shown in attachment line)"
                    value={f.description ?? ""}
                    onChange={(e) => setDescription(i, e.target.value)}
                  />
                  <button
                    type="button"
                    className="text-ink-400 hover:text-rose-600 text-[11px]"
                    onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
          <div className="text-[11px] text-ink-500 flex items-center gap-2 flex-wrap">
            <Sparkles className="h-3 w-3 text-violet-500" />
            Will send to <Badge tone="gold">{audienceSize}</Badge>
            {audienceSize === 1 ? "recipient" : "recipients"} via{" "}
            <Badge tone="info">
              {Array.from(channels).map((c) => c.toUpperCase()).join(" + ") || "—"}
            </Badge>
            using your <Badge tone="neutral">{fmt.titleCase(cfg.messageStyle)}</Badge> voice
            {sendMode === "scheduled" && scheduledFor ? (
              <>
                {" "}
                — first run{" "}
                <Badge tone="info">{fmt.dateTime(new Date(scheduledFor).toISOString())}</Badge>
              </>
            ) : (
              <> — sending now</>
            )}
            {recurrence !== "none" && (
              <>
                ,{" "}
                <Badge tone="info">repeating {recurrence}</Badge>
              </>
            )}
            .
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-outline text-sm" onClick={closeAndReset} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={launch}
              disabled={busy || audienceSize === 0}
            >
              <Send className="h-3.5 w-3.5" />
              {busy
                ? sendMode === "scheduled"
                  ? "Scheduling…"
                  : "Launching…"
                : sendMode === "scheduled"
                ? "Schedule campaign"
                : "Launch campaign"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}