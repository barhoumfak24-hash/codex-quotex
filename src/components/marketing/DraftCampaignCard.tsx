import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Download,
  Image as ImageIcon,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { api } from "@/lib/api";
import {
  aiDraftCampaign,
  aiDraftPamphlet,
  regeneratePamphletSection,
  type DraftCampaignAudience,
  type DraftedPamphlet,
  type PamphletAccent,
  type PamphletLayout,
  type PamphletSection,
  type PamphletSectionKind,
  type PamphletTone,
} from "@/lib/ai";
import { fmt } from "@/lib/format";
import type { CustomMessageRecurrence } from "@/types";
import { PamphletPreview, openPamphletPrint } from "./PamphletPreview";
import { nextHeroImageSeed } from "@/lib/pamphletImage";
import { aiDraftPamphletLLM } from "@/lib/pamphletCopy";

// =====================================================================
// Manager-only "Draft Campaign" card. A real prompt-driven AI campaign
// configurator:
//   1. Manager types a brief (e.g. "Hurricane prep reminder for coastal
//      home clients").
//   2. AI drafts a complete promotional campaign — name, subject, body,
//      channel(s), audience, recurrence.
//   3. Manager edits anything, sorts/filters the recipient list
//      (predefined audience chips + optional hand-pick), schedules or
//      sends.
//
// Launch goes through api.marketing.composeAiCampaign so the campaign
// + status event land in the existing AI marketing ledger.
// =====================================================================

type AudienceMode = DraftCampaignAudience | "custom";

const AUDIENCE_CHIPS: { mode: AudienceMode; label: string; help: string }[] = [
  { mode: "all_clients", label: "All clients", help: "Every active client in the agency." },
  { mode: "all_prospects", label: "All prospects", help: "Every active prospect." },
  {
    mode: "auto_clients",
    label: "Auto policy clients",
    help: "Clients with at least one luxury-vehicle asset / policy.",
  },
  {
    mode: "coastal_home_clients",
    label: "Coastal home clients",
    help: "Clients with at least one coastal-home asset.",
  },
  {
    mode: "high_value_clients",
    label: "High-value asset clients",
    help: "Clients with at least one asset valued ≥ $1M.",
  },
  {
    mode: "renewal_clients",
    label: "Renewal clients",
    help: "Clients with at least one upcoming renewal.",
  },
  { mode: "custom", label: "Custom hand-pick", help: "Cherry-pick specific clients / prospects." },
];

export function DraftCampaignCard({
  tenantId,
  uploadedById,
  onLaunched,
}: {
  tenantId: string;
  uploadedById: string;
  onLaunched?: (name: string, recipientCount: number, scheduled: boolean) => void;
}) {
  // Phase 1 — prompt.
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  // Phase 2 — generated/editable draft.
  const [hasDraft, setHasDraft] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<Set<"email" | "sms">>(new Set());
  const [recurrence, setRecurrence] = useState<CustomMessageRecurrence>("none");
  const [sendMode, setSendMode] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000)
      .toISOString()
      .slice(0, 16);
  });
  const [audienceModes, setAudienceModes] = useState<Set<AudienceMode>>(new Set());
  const [pickClientIds, setPickClientIds] = useState<Set<string>>(new Set());
  const [pickProspectIds, setPickProspectIds] = useState<Set<string>>(new Set());
  const [aiSummary, setAiSummary] = useState<string>("");
  // Generated digital pamphlet — preview rendered below, available for
  // print / save-as-PDF.
  const [pamphlet, setPamphlet] = useState<DraftedPamphlet | null>(null);
  // Per-section regenerate cycle index (so "Regenerate" walks through
  // the bank of variants for that section).
  const [variantIdx, setVariantIdx] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const customers = useMemo(
    () => api.customers.list(tenantId).filter((c) => !c.archived),
    [tenantId, hasDraft]
  );
  const prospects = useMemo(
    () => api.prospects.listByTenant(tenantId).filter((p) => !p.archived),
    [tenantId, hasDraft]
  );

  // Resolve the union of selected audience modes → customer/prospect ids.
  const resolved = useMemo(() => {
    const customerIds = new Set<string>();
    const prospectIds = new Set<string>();
    const includeAllClients = audienceModes.has("all_clients");
    const includeAllProspects = audienceModes.has("all_prospects");

    if (!includeAllClients) {
      if (audienceModes.has("auto_clients")) {
        customers.forEach((c) => {
          const has = api.policies
            .listByCustomer(c.id)
            .some((p) => api.assets.get(p.assetId)?.type === "luxury_vehicle");
          if (has) customerIds.add(c.id);
        });
      }
      if (audienceModes.has("coastal_home_clients")) {
        customers.forEach((c) => {
          const has = api.assets.listByCustomer(c.id).some((a) => a.type === "coastal_home");
          if (has) customerIds.add(c.id);
        });
      }
      if (audienceModes.has("high_value_clients")) {
        customers.forEach((c) => {
          const has = api.assets
            .listByCustomer(c.id)
            .some((a) => (a.estimatedValue ?? 0) >= 1_000_000);
          if (has) customerIds.add(c.id);
        });
      }
      if (audienceModes.has("renewal_clients")) {
        const upcomingPolicyIds = new Set(
          api.renewals
            .listByTenant(tenantId)
            .filter((r) => r.status === "upcoming")
            .map((r) => r.policyId)
        );
        customers.forEach((c) => {
          const has = api.policies
            .listByCustomer(c.id)
            .some((p) => upcomingPolicyIds.has(p.id));
          if (has) customerIds.add(c.id);
        });
      }
      pickClientIds.forEach((id) => customerIds.add(id));
    }
    if (!includeAllProspects) {
      pickProspectIds.forEach((id) => prospectIds.add(id));
    }

    const clientCount = includeAllClients ? customers.length : customerIds.size;
    const prospectCount = includeAllProspects ? prospects.length : prospectIds.size;
    return {
      includeAllClients,
      includeAllProspects,
      customerIds: Array.from(customerIds),
      prospectIds: Array.from(prospectIds),
      total: clientCount + prospectCount,
    };
  }, [audienceModes, pickClientIds, pickProspectIds, customers, prospects, tenantId]);

  function toggleAudience(mode: AudienceMode) {
    setAudienceModes((s) => {
      const next = new Set(s);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }

  function toggleChannel(c: "email" | "sms") {
    setChannels((s) => {
      const next = new Set(s);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  function togglePickClient(id: string) {
    setPickClientIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePickProspect(id: string) {
    setPickProspectIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    if (!prompt.trim()) {
      setError("Add a prompt — what should the AI write about?");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const agency = api.agencies.get(tenantId);
      const cfg = api.marketing.getConfig(tenantId);
      // Campaign metadata + body still come from the deterministic
      // synthesizer (keeps audience / channel / recurrence inference
      // stable + testable).
      const drafted = aiDraftCampaign({
        prompt: prompt.trim(),
        agencyName: agency?.name,
        senderName: cfg.senderName,
        signOff: cfg.signOff,
      });
      // Pamphlet copy is now LLM-authored. Falls back to the keyword
      // bank automatically if the network call fails.
      const draftedPamphlet = await aiDraftPamphletLLM({
        prompt: prompt.trim(),
        agencyName: agency?.name,
        senderName: cfg.senderName,
      });
      setName(drafted.name);
      setSubject(drafted.subject);
      setBody(drafted.body);
      setChannels(new Set(drafted.channels));
      setRecurrence(drafted.recurrence);
      setAudienceModes(new Set(drafted.audience));
      setAiSummary(drafted.summary);
      setPamphlet(draftedPamphlet);
      setHasDraft(true);
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    if (
      !confirm(
        "Discard this draft? You'll lose the AI suggestions and audience picks."
      )
    )
      return;
    reset();
  }

  function reset() {
    setPrompt("");
    setName("");
    setSubject("");
    setBody("");
    setChannels(new Set());
    setRecurrence("none");
    setAudienceModes(new Set());
    setPickClientIds(new Set());
    setPickProspectIds(new Set());
    setSendMode("now");
    setAiSummary("");
    setPamphlet(null);
    setHasDraft(false);
    setError(null);
    window.setTimeout(() => promptRef.current?.focus(), 50);
  }

  function launch(scheduled: boolean) {
    if (!name.trim()) return setError("Give the campaign a name.");
    if (channels.size === 0) return setError("Pick at least one channel (email and/or SMS).");
    if (!body.trim()) return setError("The body is empty.");
    if (resolved.total === 0) return setError("Audience is empty. Pick at least one recipient.");

    let scheduledIso: string | undefined;
    if (scheduled) {
      if (!scheduledFor) return setError("Pick a send date + time.");
      const ts = new Date(scheduledFor).getTime();
      if (Number.isNaN(ts) || ts <= Date.now())
        return setError("Scheduled send time must be in the future.");
      scheduledIso = new Date(ts).toISOString();
    }
    setError(null);
    setBusy(true);
    try {
      const out = api.marketing.composeAiCampaign({
        tenantId,
        name: name.trim(),
        channels: Array.from(channels),
        brief: body.trim(),
        includeAllClients: resolved.includeAllClients,
        includeAllProspects: resolved.includeAllProspects,
        selectedCustomerIds: resolved.includeAllClients ? [] : resolved.customerIds,
        selectedProspectIds: resolved.includeAllProspects ? [] : resolved.prospectIds,
        scheduledFor: scheduledIso,
        recurrence: recurrence as "none" | "daily" | "weekly" | "monthly",
        actorId: uploadedById,
      });
      setConfirmation(
        `Campaign "${name}" ${scheduled ? "scheduled" : "approved"} for ${
          out.messageCount
        } recipient${out.messageCount === 1 ? "" : "s"}.`
      );
      onLaunched?.(name.trim(), out.messageCount, scheduled);
      reset();
      window.setTimeout(() => setConfirmation(null), 6000);
    } finally {
      setBusy(false);
    }
  }

  // Focus the prompt when there's no draft.
  useEffect(() => {
    if (!hasDraft) promptRef.current?.focus();
  }, [hasDraft]);

  return (
    <Card>
      <CardHeader
        title="Draft Campaign"
        subtitle="Describe the outreach in plain English. AI drafts the full campaign — message, subject, channels, recommended audience. You review, edit, filter exactly who it goes to, and approve, schedule, or send."
        action={
          hasDraft && (
            <button
              type="button"
              className="btn-outline text-xs inline-flex"
              onClick={discard}
              disabled={busy}
              title="Throw away this draft and start over"
            >
              <X className="h-3.5 w-3.5" /> Discard
            </button>
          )
        }
      />

      {confirmation && (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {confirmation}
        </div>
      )}

      {!hasDraft ? (
        <div className="space-y-3">
          <label className="label">Prompt</label>
          <textarea
            ref={promptRef}
            className="input min-h-[120px] text-sm"
            placeholder={
              "e.g., A friendly hurricane prep reminder for coastal-home clients with a wind-mitigation discount nudge.\n\nOr: monthly renewal touch for clients with upcoming auto renewals — short, casual, SMS friendly."
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
          <p className="text-[11px] text-ink-500">
            AI uses your agency's configured voice + sign-off. You'll review every field before
            anything sends.
          </p>
          {error && (
            <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-gold text-sm"
              onClick={generate}
              disabled={busy || !prompt.trim()}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {busy ? "Drafting…" : "Generate campaign"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {aiSummary && (
            <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 flex items-start gap-2">
              <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" />
              <span>{aiSummary}</span>
            </div>
          )}

          {/* Editable basics */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Campaign name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                    className={`text-xs px-3 py-1.5 rounded border inline-flex items-center gap-1 ${
                      channels.has(c)
                        ? "bg-gold-100 border-gold-300 text-gold-800"
                        : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
                    }`}
                  >
                    {c === "email" ? (
                      <Mail className="h-3.5 w-3.5" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" />
                    )}
                    {c.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="label">Subject (used for email sends)</label>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={busy}
            />
          </div>

          <div>
            <label className="label flex items-center gap-1.5">
              <Pencil className="h-3 w-3" /> Message body
            </label>
            <textarea
              className="input min-h-[200px] text-sm font-mono"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy}
            />
            <p className="mt-1 text-[11px] text-ink-500">
              Placeholders like <code>{"{first_name}"}</code> are personalized per recipient in
              production. The AI's draft is yours to edit freely.
            </p>
          </div>

          {/* Digital pamphlet — auto-generated branded flyer the
              campaign sends out alongside the email/SMS body. */}
          {pamphlet && (
            <PamphletEditor
              pamphlet={pamphlet}
              variantIdx={variantIdx}
              setVariantIdx={setVariantIdx}
              prompt={prompt}
              tenantId={tenantId}
              onChange={setPamphlet}
            />
          )}

          {/* Audience filter */}
          <div>
            <label className="label">Audience filter — combine any of these</label>
            <div className="flex flex-wrap gap-1.5">
              {AUDIENCE_CHIPS.map((c) => (
                <button
                  key={c.mode}
                  type="button"
                  onClick={() => toggleAudience(c.mode)}
                  disabled={busy}
                  title={c.help}
                  className={`text-xs px-3 py-1.5 rounded-full border ${
                    audienceModes.has(c.mode)
                      ? "bg-gold-100 border-gold-300 text-gold-800"
                      : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {audienceModes.has("custom") && (
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                <div className="rounded-md border border-ink-100 max-h-[200px] overflow-y-auto">
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-100">
                    Clients ({pickClientIds.size} selected)
                  </div>
                  <ul className="divide-y divide-ink-100">
                    {customers.map((c) => (
                      <li key={c.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-ink-50">
                          <input
                            type="checkbox"
                            checked={pickClientIds.has(c.id)}
                            onChange={() => togglePickClient(c.id)}
                          />
                          <span className="truncate flex-1">{c.name}</span>
                          <span className="text-[11px] text-ink-400">{c.email}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-ink-100 max-h-[200px] overflow-y-auto">
                  <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-100">
                    Prospects ({pickProspectIds.size} selected)
                  </div>
                  <ul className="divide-y divide-ink-100">
                    {prospects.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-ink-50">
                          <input
                            type="checkbox"
                            checked={pickProspectIds.has(p.id)}
                            onChange={() => togglePickProspect(p.id)}
                          />
                          <span className="truncate flex-1">{p.name}</span>
                          <span className="text-[11px] text-ink-400">{p.email}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="text-[11px] text-ink-500 mt-2">
              <Badge tone="gold">{resolved.total}</Badge> recipient{resolved.total === 1 ? "" : "s"}
              {" "}match the current filter.
            </div>
          </div>

          {/* Send timing + recurrence */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label flex items-center gap-1.5">
                <CalendarClock className="h-3 w-3" /> Send timing
              </label>
              <div className="grid grid-cols-2 gap-2">
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
                <input
                  type="datetime-local"
                  className="input mt-2"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  disabled={busy}
                />
              )}
            </div>
            <div>
              <label className="label">Recurrence</label>
              <div className="grid grid-cols-4 gap-2">
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
                    className={`text-xs px-2 py-1.5 rounded border ${
                      recurrence === value
                        ? "bg-gold-100 border-gold-300 text-gold-800"
                        : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-ink-100">
            <div className="text-[11px] text-ink-500">
              Will reach <Badge tone="gold">{resolved.total}</Badge>
              {resolved.total === 1 ? "recipient" : "recipients"} via{" "}
              <Badge tone="info">
                {Array.from(channels).map((c) => c.toUpperCase()).join(" + ") || "—"}
              </Badge>
              {sendMode === "scheduled" && scheduledFor ? (
                <>
                  {" "}
                  — first run{" "}
                  <Badge tone="info">
                    {fmt.dateTime(new Date(scheduledFor).toISOString())}
                  </Badge>
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
              {sendMode === "scheduled" ? (
                <button
                  type="button"
                  className="btn-gold text-sm"
                  onClick={() => launch(true)}
                  disabled={busy}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {busy ? "Scheduling…" : "Schedule campaign"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-gold text-sm"
                  onClick={() => launch(false)}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" /> <Send className="h-3.5 w-3.5" />
                    </>
                  )}
                  {busy ? "Sending…" : "Approve & send"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// =====================================================================
// Pamphlet editor — section list with reorder/remove/regenerate, theme
// + tone + layout selectors, add-section picker, live preview, and a
// Print / Save as PDF button. Each section gets its own inline editor.
// =====================================================================

const ACCENT_OPTIONS: PamphletAccent[] = [
  "winter", "spring", "summer", "fall",
  "storm", "flood", "wildfire", "earthquake",
  "renewal", "newpolicy",
  "home", "newhome", "remodel", "luxury_home",
  "auto", "luxury_auto", "motorcycle", "rv", "boat",
  "jewelry", "valuables", "art", "wine",
  "umbrella", "liability",
  "life", "health", "wedding", "newbaby",
  "business", "cyber",
  "holidays", "newyear",
  "generic",
];
const TONE_OPTIONS: PamphletTone[] = [
  "professional", "friendly", "urgent", "luxury", "educational", "playful",
];
const LAYOUT_OPTIONS: PamphletLayout[] = ["flyer", "postcard", "magazine"];
const SECTION_OPTIONS: { kind: PamphletSectionKind; label: string }[] = [
  { kind: "hero", label: "Hero" },
  { kind: "ribbon", label: "Ribbon" },
  { kind: "stats", label: "Stats" },
  { kind: "highlights", label: "Highlights" },
  { kind: "comparison", label: "Comparison" },
  { kind: "testimonial", label: "Testimonial" },
  { kind: "steps", label: "Steps" },
  { kind: "faq", label: "FAQ" },
  { kind: "cta", label: "Call to action" },
  { kind: "contact", label: "Contact" },
  { kind: "disclaimer", label: "Disclaimer" },
];

function PamphletEditor({
  pamphlet,
  variantIdx,
  setVariantIdx,
  prompt,
  tenantId,
  onChange,
}: {
  pamphlet: DraftedPamphlet;
  variantIdx: Record<number, number>;
  setVariantIdx: (next: Record<number, number>) => void;
  prompt: string;
  tenantId: string;
  onChange: (p: DraftedPamphlet) => void;
}) {
  const agencyName = pamphlet.agency.name;
  const [addKind, setAddKind] = useState<PamphletSectionKind>("highlights");

  function patchSection(idx: number, patch: Partial<PamphletSection>) {
    const next = pamphlet.sections.slice();
    next[idx] = { ...next[idx], ...(patch as object) } as PamphletSection;
    onChange({ ...pamphlet, sections: next });
  }
  function removeSection(idx: number) {
    onChange({ ...pamphlet, sections: pamphlet.sections.filter((_, i) => i !== idx) });
  }
  function moveSection(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= pamphlet.sections.length) return;
    const next = pamphlet.sections.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange({ ...pamphlet, sections: next });
  }
  function regenerateSection(idx: number) {
    const section = pamphlet.sections[idx];
    const nextIdx = (variantIdx[idx] ?? 0) + 1;
    const replacement = regeneratePamphletSection({
      current: section,
      accent: pamphlet.accent,
      tone: pamphlet.tone,
      prompt,
      agencyName,
      variantIndex: nextIdx,
    });
    setVariantIdx({ ...variantIdx, [idx]: nextIdx });
    patchSection(idx, replacement);
  }
  function addSection() {
    const ctx = {
      current: { kind: addKind } as PamphletSection,
      accent: pamphlet.accent,
      tone: pamphlet.tone,
      prompt,
      agencyName,
      variantIndex: 0,
    };
    const added = regeneratePamphletSection(ctx);
    onChange({ ...pamphlet, sections: [...pamphlet.sections, added] });
  }
  async function regenerateAll() {
    const fresh = await aiDraftPamphletLLM({
      prompt,
      agencyName,
      agencyPhone: pamphlet.agency.phone,
      agencyEmail: pamphlet.agency.email,
      agencyWebsite: pamphlet.agency.website,
      agencyAddress: pamphlet.agency.address,
      accent: pamphlet.accent,
      tone: pamphlet.tone,
      layout: pamphlet.layout,
    });
    setVariantIdx({});
    onChange(fresh);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <label className="label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-gold-600" /> Digital pamphlet — branded
            to {agencyName}
          </label>
          <p className="text-[11px] text-ink-500">
            Sectioned model — reorder, remove, regenerate, or add. The preview updates live.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn-outline text-xs inline-flex"
            onClick={regenerateAll}
            title="Regenerate the whole pamphlet from the same prompt + theme + tone"
          >
            <Sparkles className="h-3.5 w-3.5" /> Regenerate all
          </button>
          <button
            type="button"
            className="btn-outline text-xs inline-flex"
            onClick={() =>
              onChange({
                ...pamphlet,
                heroImageSeed: nextHeroImageSeed(pamphlet.heroImageSeed),
              })
            }
            title="Roll a new AI-generated hero image — text stays the same"
          >
            <ImageIcon className="h-3.5 w-3.5" /> Regenerate image
          </button>
          <button
            type="button"
            className="btn-outline text-xs inline-flex"
            onClick={() => openPamphletPrint(pamphlet)}
            title="Open the pamphlet in a print view — use 'Save as PDF' to download"
          >
            <Download className="h-3.5 w-3.5" /> Print / Save as PDF
          </button>
        </div>
      </div>

      {/* Theme / tone / layout */}
      <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3 grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Theme</label>
          <select
            className="input text-sm"
            value={pamphlet.accent}
            onChange={(e) => onChange({ ...pamphlet, accent: e.target.value as PamphletAccent })}
          >
            {ACCENT_OPTIONS.map((a) => (
              <option key={a} value={a}>{prettify(a)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tone</label>
          <select
            className="input text-sm"
            value={pamphlet.tone}
            onChange={(e) => onChange({ ...pamphlet, tone: e.target.value as PamphletTone })}
          >
            {TONE_OPTIONS.map((t) => (
              <option key={t} value={t}>{prettify(t)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Layout</label>
          <select
            className="input text-sm"
            value={pamphlet.layout}
            onChange={(e) => onChange({ ...pamphlet, layout: e.target.value as PamphletLayout })}
          >
            {LAYOUT_OPTIONS.map((l) => (
              <option key={l} value={l}>{prettify(l)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Section list */}
      <div className="rounded-md border border-ink-100 bg-white p-3 space-y-2.5">
        <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
          Sections ({pamphlet.sections.length})
        </div>
        {pamphlet.sections.map((s, i) => (
          <SectionEditor
            key={`${s.kind}-${i}`}
            section={s}
            index={i}
            total={pamphlet.sections.length}
            onPatch={(patch) => patchSection(i, patch)}
            onMove={(dir) => moveSection(i, dir)}
            onRemove={() => removeSection(i)}
            onRegenerate={() => regenerateSection(i)}
          />
        ))}
        <div className="flex items-center gap-2 pt-2 border-t border-ink-100">
          <span className="text-[11px] text-ink-500">Add section:</span>
          <select
            className="input !py-1 text-xs max-w-[200px]"
            value={addKind}
            onChange={(e) => setAddKind(e.target.value as PamphletSectionKind)}
          >
            {SECTION_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind}>{o.label}</option>
            ))}
          </select>
          <button type="button" className="btn-outline text-xs" onClick={addSection}>
            + Add
          </button>
        </div>
      </div>

      {/* Live preview */}
      <PamphletPreview pamphlet={pamphlet} />
    </div>
  );
}

function prettify(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function SectionEditor({
  section,
  index,
  total,
  onPatch,
  onMove,
  onRemove,
  onRegenerate,
}: {
  section: PamphletSection;
  index: number;
  total: number;
  onPatch: (patch: Partial<PamphletSection>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/30 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-semibold text-ink-700 uppercase tracking-wider">
          {SECTION_OPTIONS.find((o) => o.kind === section.kind)?.label ?? section.kind}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-outline !px-1.5 !py-0.5 text-[11px]"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Move up"
          >↑</button>
          <button
            type="button"
            className="btn-outline !px-1.5 !py-0.5 text-[11px]"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Move down"
          >↓</button>
          <button
            type="button"
            className="btn-outline !px-1.5 !py-0.5 text-[11px]"
            onClick={onRegenerate}
            title="Regenerate this section"
          >
            <Sparkles className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="btn-outline !px-1.5 !py-0.5 text-[11px] !text-rose-600 hover:!bg-rose-50"
            onClick={onRemove}
            title="Remove this section"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <SectionFields section={section} onPatch={onPatch} />
    </div>
  );
}

function SectionFields({
  section,
  onPatch,
}: {
  section: PamphletSection;
  onPatch: (patch: Partial<PamphletSection>) => void;
}) {
  switch (section.kind) {
    case "hero":
      return (
        <div className="space-y-1.5">
          <input
            className="input text-sm font-medium"
            placeholder="Headline"
            value={section.headline}
            onChange={(e) => onPatch({ headline: e.target.value })}
          />
          <input
            className="input text-sm"
            placeholder="Subheadline"
            value={section.subheadline}
            onChange={(e) => onPatch({ subheadline: e.target.value })}
          />
          <textarea
            className="input text-sm min-h-[60px]"
            placeholder="Intro paragraph"
            value={section.intro}
            onChange={(e) => onPatch({ intro: e.target.value })}
          />
        </div>
      );
    case "ribbon":
      return (
        <div className="flex gap-2 items-center">
          <input
            className="input !py-1 text-sm flex-1"
            value={section.text}
            onChange={(e) => onPatch({ text: e.target.value })}
          />
          <select
            className="input !py-1 text-xs"
            value={section.tone ?? "info"}
            onChange={(e) =>
              onPatch({ tone: e.target.value as "info" | "warning" | "urgent" | "success" })
            }
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="urgent">Urgent</option>
            <option value="success">Success</option>
          </select>
        </div>
      );
    case "stats":
      return (
        <div className="space-y-2">
          <input
            className="input !py-1 text-sm"
            placeholder="Section title"
            value={section.title ?? ""}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
          <div className="space-y-1.5">
            {section.items.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_2fr_auto] gap-1.5">
                <input
                  className="input !py-1 text-sm"
                  placeholder="Value"
                  value={s.value}
                  onChange={(e) => {
                    const next = section.items.slice();
                    next[i] = { ...next[i], value: e.target.value };
                    onPatch({ items: next });
                  }}
                />
                <input
                  className="input !py-1 text-sm"
                  placeholder="Label"
                  value={s.label}
                  onChange={(e) => {
                    const next = section.items.slice();
                    next[i] = { ...next[i], label: e.target.value };
                    onPatch({ items: next });
                  }}
                />
                <input
                  className="input !py-1 text-sm"
                  placeholder="Sub (optional)"
                  value={s.sub ?? ""}
                  onChange={(e) => {
                    const next = section.items.slice();
                    next[i] = { ...next[i], sub: e.target.value };
                    onPatch({ items: next });
                  }}
                />
                <button
                  type="button"
                  className="text-[11px] text-ink-400 hover:text-rose-600"
                  onClick={() =>
                    onPatch({ items: section.items.filter((_, j) => j !== i) })
                  }
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          {section.items.length < 4 && (
            <button
              type="button"
              className="text-[11px] text-gold-700 hover:text-gold-900"
              onClick={() =>
                onPatch({
                  items: [...section.items, { value: "100%", label: "New stat" }],
                })
              }
            >
              + Add stat
            </button>
          )}
        </div>
      );
    case "highlights":
      return (
        <div className="space-y-1.5">
          <input
            className="input !py-1 text-sm"
            placeholder="Section title"
            value={section.title}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
          {section.items.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input !py-1 text-sm flex-1"
                value={b.label}
                onChange={(e) => {
                  const next = section.items.slice();
                  next[i] = { ...next[i], label: e.target.value };
                  onPatch({ items: next });
                }}
              />
              <button
                type="button"
                className="text-[11px] text-ink-400 hover:text-rose-600"
                onClick={() => onPatch({ items: section.items.filter((_, j) => j !== i) })}
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {section.items.length < 6 && (
            <button
              type="button"
              className="text-[11px] text-gold-700 hover:text-gold-900"
              onClick={() =>
                onPatch({
                  items: [...section.items, { icon: "sparkles", label: "New highlight" }],
                })
              }
            >
              + Add highlight
            </button>
          )}
        </div>
      );
    case "comparison":
      return (
        <div className="space-y-2">
          <input
            className="input !py-1 text-sm"
            placeholder="Section title"
            value={section.title}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
          {section.columns.map((col, ci) => (
            <div key={ci} className="rounded-md border border-ink-100 p-2 space-y-1.5">
              <div className="flex gap-1.5 items-center">
                <input
                  className="input !py-1 text-sm flex-1"
                  placeholder="Column heading"
                  value={col.heading}
                  onChange={(e) => {
                    const next = section.columns.slice();
                    next[ci] = { ...next[ci], heading: e.target.value };
                    onPatch({ columns: next });
                  }}
                />
                <select
                  className="input !py-1 text-xs"
                  value={col.tone}
                  onChange={(e) => {
                    const next = section.columns.slice();
                    next[ci] = { ...next[ci], tone: e.target.value as "positive" | "negative" | "neutral" };
                    onPatch({ columns: next });
                  }}
                >
                  <option value="positive">Positive</option>
                  <option value="negative">Negative</option>
                  <option value="neutral">Neutral</option>
                </select>
              </div>
              {col.items.map((it, ii) => (
                <div key={ii} className="flex gap-1.5 items-center">
                  <input
                    className="input !py-1 text-sm flex-1"
                    value={it}
                    onChange={(e) => {
                      const next = section.columns.slice();
                      const items = next[ci].items.slice();
                      items[ii] = e.target.value;
                      next[ci] = { ...next[ci], items };
                      onPatch({ columns: next });
                    }}
                  />
                  <button
                    type="button"
                    className="text-[11px] text-ink-400 hover:text-rose-600"
                    onClick={() => {
                      const next = section.columns.slice();
                      next[ci] = { ...next[ci], items: next[ci].items.filter((_, j) => j !== ii) };
                      onPatch({ columns: next });
                    }}
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-[11px] text-gold-700 hover:text-gold-900"
                onClick={() => {
                  const next = section.columns.slice();
                  next[ci] = { ...next[ci], items: [...next[ci].items, "New point"] };
                  onPatch({ columns: next });
                }}
              >
                + Add row
              </button>
            </div>
          ))}
        </div>
      );
    case "testimonial":
      return (
        <div className="space-y-1.5">
          <textarea
            className="input text-sm min-h-[60px]"
            placeholder="Quote"
            value={section.quote}
            onChange={(e) => onPatch({ quote: e.target.value })}
          />
          <input
            className="input !py-1 text-sm"
            placeholder="Attribution"
            value={section.attribution}
            onChange={(e) => onPatch({ attribution: e.target.value })}
          />
          <select
            className="input !py-1 text-xs max-w-[140px]"
            value={section.rating ?? 5}
            onChange={(e) => onPatch({ rating: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>
            ))}
          </select>
        </div>
      );
    case "steps":
      return (
        <div className="space-y-1.5">
          <input
            className="input !py-1 text-sm"
            placeholder="Section title"
            value={section.title}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
          {section.items.map((s, i) => (
            <div key={i} className="grid grid-cols-[2fr_3fr_auto] gap-1.5">
              <input
                className="input !py-1 text-sm"
                placeholder="Step label"
                value={s.label}
                onChange={(e) => {
                  const next = section.items.slice();
                  next[i] = { ...next[i], label: e.target.value };
                  onPatch({ items: next });
                }}
              />
              <input
                className="input !py-1 text-sm"
                placeholder="Detail (optional)"
                value={s.detail ?? ""}
                onChange={(e) => {
                  const next = section.items.slice();
                  next[i] = { ...next[i], detail: e.target.value };
                  onPatch({ items: next });
                }}
              />
              <button
                type="button"
                className="text-[11px] text-ink-400 hover:text-rose-600"
                onClick={() => onPatch({ items: section.items.filter((_, j) => j !== i) })}
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-[11px] text-gold-700 hover:text-gold-900"
            onClick={() => onPatch({ items: [...section.items, { label: "New step" }] })}
          >
            + Add step
          </button>
        </div>
      );
    case "faq":
      return (
        <div className="space-y-2">
          <input
            className="input !py-1 text-sm"
            placeholder="Section title"
            value={section.title}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
          {section.items.map((f, i) => (
            <div key={i} className="rounded-md border border-ink-100 p-2 space-y-1.5">
              <input
                className="input !py-1 text-sm font-medium"
                placeholder="Question"
                value={f.q}
                onChange={(e) => {
                  const next = section.items.slice();
                  next[i] = { ...next[i], q: e.target.value };
                  onPatch({ items: next });
                }}
              />
              <textarea
                className="input !py-1 text-sm min-h-[40px]"
                placeholder="Answer"
                value={f.a}
                onChange={(e) => {
                  const next = section.items.slice();
                  next[i] = { ...next[i], a: e.target.value };
                  onPatch({ items: next });
                }}
              />
              <div className="text-right">
                <button
                  type="button"
                  className="text-[11px] text-ink-400 hover:text-rose-600"
                  onClick={() => onPatch({ items: section.items.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="text-[11px] text-gold-700 hover:text-gold-900"
            onClick={() => onPatch({ items: [...section.items, { q: "New question?", a: "Answer." }] })}
          >
            + Add Q&amp;A
          </button>
        </div>
      );
    case "cta":
      return (
        <div className="space-y-1.5">
          <textarea
            className="input text-sm min-h-[60px]"
            placeholder="CTA sentence"
            value={section.title}
            onChange={(e) => onPatch({ title: e.target.value })}
          />
          <input
            className="input !py-1 text-sm"
            placeholder="Button label"
            value={section.button}
            onChange={(e) => onPatch({ button: e.target.value })}
          />
          <input
            className="input !py-1 text-sm"
            placeholder="Subtext (optional)"
            value={section.subtext ?? ""}
            onChange={(e) => onPatch({ subtext: e.target.value })}
          />
        </div>
      );
    case "contact":
      return (
        <div className="grid sm:grid-cols-2 gap-1.5">
          <input
            className="input !py-1 text-sm"
            placeholder="Phone"
            value={section.phone ?? ""}
            onChange={(e) => onPatch({ phone: e.target.value })}
          />
          <input
            className="input !py-1 text-sm"
            placeholder="Email"
            value={section.email ?? ""}
            onChange={(e) => onPatch({ email: e.target.value })}
          />
          <input
            className="input !py-1 text-sm"
            placeholder="Website"
            value={section.website ?? ""}
            onChange={(e) => onPatch({ website: e.target.value })}
          />
          <input
            className="input !py-1 text-sm"
            placeholder="Address"
            value={section.address ?? ""}
            onChange={(e) => onPatch({ address: e.target.value })}
          />
        </div>
      );
    case "disclaimer":
      return (
        <textarea
          className="input text-sm min-h-[60px]"
          value={section.text}
          onChange={(e) => onPatch({ text: e.target.value })}
        />
      );
  }
}