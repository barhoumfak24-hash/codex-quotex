import { useMemo, useState, type ReactNode } from "react";
import {
  CalendarClock,
  FileImage,
  FileText,
  Paperclip,
  Repeat,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { CustomMessageRecurrence } from "@/types";

type CampaignAttachmentDraft = {
  fileName: string;
  fileType?: string;
  description?: string;
};

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
  const [brief, setBrief] = useState("");
  const [allClients, setAllClients] = useState(true);
  const [allProspects, setAllProspects] = useState(false);
  const [handPick, setHandPick] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [selectedProspectIds, setSelectedProspectIds] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<CampaignAttachmentDraft[]>([]);
  const [sendMode, setSendMode] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState<string>(() => {
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
  const customers = useMemo(() => (open ? api.customers.list(tenantId) : []), [tenantId, open]);
  const prospects = useMemo(
    () => (open ? api.prospects.listByTenant(tenantId) : []),
    [tenantId, open]
  );

  const clientReach = allClients ? customers.length : selectedCustomerIds.size;
  const prospectReach = allProspects ? prospects.length : selectedProspectIds.size;
  const audienceSize = clientReach + prospectReach;

  function reset() {
    setName("");
    setBrief("");
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

  function addFiles(nextFiles: File[]) {
    if (nextFiles.length === 0) return;
    setFiles((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
      })),
    ]);
  }

  function setDescription(index: number, value: string) {
    setFiles((current) =>
      current.map((file, idx) => (idx === index ? { ...file, description: value } : file))
    );
  }

  function toggleCustomer(id: string) {
    setSelectedCustomerIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProspect(id: string) {
    setSelectedProspectIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function launch() {
    setError(null);
    if (!name.trim()) return setError("Pick a campaign name.");
    if (!brief.trim()) return setError("Add a brief for the AI to personalize.");
    if (audienceSize === 0) return setError("No audience selected. Pick at least one recipient.");

    let scheduledIso: string | undefined;
    if (sendMode === "scheduled") {
      if (!scheduledFor) return setError("Pick a send date and time.");
      const ts = new Date(scheduledFor).getTime();
      if (Number.isNaN(ts)) return setError("That date/time looks invalid.");
      if (ts <= Date.now()) return setError("Scheduled send time must be in the future.");
      scheduledIso = new Date(ts).toISOString();
    }

    setBusy(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const { messageCount } = api.marketing.composeAiCampaign({
        tenantId,
        name: name.trim(),
        channels: ["email"],
        brief: brief.trim(),
        emailSubject: name.trim(),
        emailBody: brief.trim(),
        appOrigin: window.location.origin,
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Campaign name</label>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g., Spring portfolio review"
              disabled={busy}
            />
          </div>
          <div>
            <label className="label">Channel</label>
            <div className="inline-flex items-center rounded-md border border-gold-300 bg-gold-50 px-3 py-2 text-xs font-semibold text-gold-800">
              EMAIL
            </div>
          </div>
        </div>

        <div>
          <label className="label">Brief - what should the AI tell recipients?</label>
          <textarea
            className="input min-h-[120px]"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Example: Invite clients to schedule an annual portfolio review. Mention coverage changes, life updates, and appraisal refreshes where needed."
            disabled={busy}
          />
          <p className="mt-1 text-[11px] text-ink-500">
            The AI personalizes each email with the recipient's name, then wraps the brief in
            your agency's configured opening and sign-off.
          </p>
        </div>

        <div>
          <label className="label">Audience</label>
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <AudienceButton
              active={allClients}
              disabled={busy}
              onClick={() => setAllClients((value) => !value)}
            >
              All clients ({customers.length})
            </AudienceButton>
            <AudienceButton
              active={allProspects}
              disabled={busy}
              onClick={() => setAllProspects((value) => !value)}
            >
              All prospects ({prospects.length})
            </AudienceButton>
            <AudienceButton
              active={handPick}
              disabled={busy}
              onClick={() => setHandPick((value) => !value)}
            >
              Hand-pick recipients
            </AudienceButton>
          </div>

          {handPick && (
            <div className="grid gap-3 sm:grid-cols-2">
              <RecipientPicker
                title={`Clients (${allClients ? "all included" : `${selectedCustomerIds.size} selected`})`}
                allIncluded={allClients}
                allIncludedText="All clients is on, so every client is already included."
                rows={customers.map((customer) => ({
                  id: customer.id,
                  name: customer.name,
                  email: customer.email,
                }))}
                selectedIds={selectedCustomerIds}
                onToggle={toggleCustomer}
              />
              <RecipientPicker
                title={`Prospects (${allProspects ? "all included" : `${selectedProspectIds.size} selected`})`}
                allIncluded={allProspects}
                allIncludedText="All prospects is on, so every prospect is already included."
                rows={prospects.map((prospect) => ({
                  id: prospect.id,
                  name: prospect.name,
                  email: prospect.email,
                }))}
                selectedIds={selectedProspectIds}
                onToggle={toggleProspect}
              />
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-md border border-ink-100 bg-ink-50/40 p-3">
          <div>
            <label className="label flex items-center gap-1.5">
              <CalendarClock className="h-3 w-3" /> Send timing
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["now", "Send now"],
                ["scheduled", "Schedule for later"],
              ] as const).map(([value, label]) => (
                <AudienceButton
                  key={value}
                  active={sendMode === value}
                  disabled={busy}
                  onClick={() => setSendMode(value)}
                >
                  {label}
                </AudienceButton>
              ))}
            </div>
            {sendMode === "scheduled" && (
              <div className="mt-2">
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduledFor}
                  onChange={(event) => setScheduledFor(event.target.value)}
                  disabled={busy}
                />
                <p className="mt-1 text-[11px] text-ink-500">
                  Emails will queue and dispatch at this time. Times are in your local timezone.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <Repeat className="h-3 w-3" /> Recurrence
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["none", "One-shot"],
                ["daily", "Daily"],
                ["weekly", "Weekly"],
                ["monthly", "Monthly"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRecurrence(value)}
                  disabled={busy}
                  className={`rounded border px-3 py-1.5 text-xs ${
                    recurrence === value
                      ? "border-gold-300 bg-gold-100 text-gold-800"
                      : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="label flex items-center gap-1.5">
            <Paperclip className="h-3 w-3" /> Attachments
          </label>
          <FileDropZone
            title={files.length === 0 ? "Attach reference files for the AI / recipients" : "Add more files"}
            help="Drop PDFs, images, documents, or paste a copied screenshot."
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
            multiple
            compact
            disabled={busy}
            icon="attachment"
            onFiles={addFiles}
          />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {files.map((file, index) => (
                <li
                  key={`${file.fileName}-${index}`}
                  className="flex items-center gap-2 rounded border border-ink-100 bg-ink-50 px-2 py-1.5 text-xs"
                >
                  {file.fileType?.startsWith("image/") ? (
                    <FileImage className="h-3.5 w-3.5 text-ink-400" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-ink-400" />
                  )}
                  <span className="flex-1 truncate font-medium">{file.fileName}</span>
                  <input
                    className="input max-w-[200px] !px-2 !py-0.5 !text-[11px]"
                    placeholder="Description"
                    value={file.description ?? ""}
                    onChange={(event) => setDescription(index, event.target.value)}
                  />
                  <button
                    type="button"
                    className="text-ink-400 hover:text-rose-600"
                    onClick={() => setFiles((current) => current.filter((_, idx) => idx !== index))}
                    aria-label="Remove attachment"
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
            <Sparkles className="h-3 w-3 text-violet-500" />
            Will send to <Badge tone="gold">{audienceSize}</Badge>
            {audienceSize === 1 ? "recipient" : "recipients"} via <Badge tone="info">EMAIL</Badge>
            using your <Badge tone="neutral">{fmt.titleCase(cfg.messageStyle)}</Badge> voice.
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
              {busy ? (sendMode === "scheduled" ? "Scheduling..." : "Launching...") : sendMode === "scheduled" ? "Schedule campaign" : "Launch campaign"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AudienceButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3 py-2 text-left text-sm ${
        active ? "border-gold-400 bg-gold-50" : "border-ink-200 bg-white hover:border-ink-300"
      }`}
    >
      {children}
    </button>
  );
}

function RecipientPicker({
  title,
  allIncluded,
  allIncludedText,
  rows,
  selectedIds,
  onToggle,
}: {
  title: string;
  allIncluded: boolean;
  allIncludedText: string;
  rows: { id: string; name: string; email: string }[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="max-h-[180px] overflow-y-auto rounded-md border border-ink-100">
      <div className="border-b border-ink-100 px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-500">
        {title}
      </div>
      {allIncluded ? (
        <div className="px-3 py-3 text-[11px] text-ink-400">{allIncludedText}</div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.map((row) => (
            <li key={row.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-ink-50">
                <input
                  type="checkbox"
                  checked={selectedIds.has(row.id)}
                  onChange={() => onToggle(row.id)}
                />
                <span className="flex-1 truncate">{row.name}</span>
                <span className="text-[11px] text-ink-400">{row.email}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
