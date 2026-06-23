import { useEffect, useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  CalendarClock,
  Check,
  Image as ImageIcon,
  Loader2,
  Mail,
  RefreshCcw,
  Search,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { aiAssetTypeAliases, matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import {
  draftMarketingStudioCampaign,
  MARKETING_STUDIO_CTA_BUTTON,
  marketingStudioImageUrl,
  type MarketingStudioAudience,
  type MarketingStudioChannel,
  type MarketingStudioDraft,
  type MarketingStudioRecurrence,
} from "@/lib/marketingCampaignStudio";
import { marketingSmartContactUrl, normalizeMarketingHref } from "@/lib/marketingSmartLinks";
import type { Agency, AssetType, CustomerProfile, Prospect } from "@/types";

type AudienceMode = MarketingStudioAudience;
type PamphletThemeId = "executive" | "coastal" | "ivory" | "midnight";
type EditablePamphletField = Exclude<keyof MarketingStudioDraft["pamphlet"], "highlights">;

const AUDIENCE_OPTIONS: { mode: AudienceMode; label: string }[] = [
  { mode: "all_clients", label: "All clients" },
  { mode: "all_prospects", label: "All prospects" },
  { mode: "auto_clients", label: "Auto clients" },
  { mode: "coastal_home_clients", label: "Coastal home" },
  { mode: "high_value_clients", label: "High-value" },
  { mode: "renewal_clients", label: "Renewals" },
];

const PROMPT_EXAMPLES = [
  "Create a premium digital pamphlet for commercial umbrella policy clients who added locations and company vehicles.",
  "Write a polished coastal home hurricane prep campaign with a strong image and a useful client checklist.",
  "Create a private-client renewal review campaign that feels like a concierge advisor wrote it.",
];

const PAMPHLET_THEMES: Record<
  PamphletThemeId,
  {
    label: string;
    heroPanel: string;
    heroAccent: string;
    eyebrow: string;
    labelText: string;
    bodyBg: string;
    sideBg: string;
    checkBg: string;
    checkText: string;
    ctaBg: string;
    ctaButton: string;
    print: {
      pageBg: string;
      paperBg: string;
      panelBg: string;
      accent: string;
      label: string;
      sideBg: string;
      checkBg: string;
      checkText: string;
      ctaBg: string;
      ctaButton: string;
    };
  }
> = {
  executive: {
    label: "Executive gold",
    heroPanel: "border-gold-400 bg-ink-950/72",
    heroAccent: "border-gold-400",
    eyebrow: "border-white/35 bg-white/12 text-white",
    labelText: "text-gold-700",
    bodyBg: "bg-white",
    sideBg: "bg-[#f8f5ee]",
    checkBg: "bg-gold-100",
    checkText: "text-gold-800",
    ctaBg: "bg-ink-950",
    ctaButton: "bg-gold-500 text-white",
    print: {
      pageBg: "#ebe6dc",
      paperBg: "#fffaf2",
      panelBg: "rgba(23,19,15,.74)",
      accent: "#b28d3f",
      label: "#a8843b",
      sideBg: "#f6f1e8",
      checkBg: "#efe1be",
      checkText: "#7b5a19",
      ctaBg: "#17130f",
      ctaButton: "#b28d3f",
    },
  },
  coastal: {
    label: "Coastal slate",
    heroPanel: "border-cyan-200 bg-slate-950/74",
    heroAccent: "border-cyan-200",
    eyebrow: "border-cyan-100/45 bg-cyan-50/12 text-white",
    labelText: "text-cyan-800",
    bodyBg: "bg-white",
    sideBg: "bg-cyan-50",
    checkBg: "bg-cyan-100",
    checkText: "text-cyan-900",
    ctaBg: "bg-slate-950",
    ctaButton: "bg-cyan-700 text-white",
    print: {
      pageBg: "#e7f0f1",
      paperBg: "#fbfeff",
      panelBg: "rgba(15,23,42,.76)",
      accent: "#67e8f9",
      label: "#0e7490",
      sideBg: "#ecfeff",
      checkBg: "#cffafe",
      checkText: "#164e63",
      ctaBg: "#020617",
      ctaButton: "#0e7490",
    },
  },
  ivory: {
    label: "Ivory private client",
    heroPanel: "border-stone-200 bg-stone-950/70",
    heroAccent: "border-stone-200",
    eyebrow: "border-stone-100/45 bg-stone-50/12 text-white",
    labelText: "text-stone-700",
    bodyBg: "bg-[#fffdf8]",
    sideBg: "bg-stone-50",
    checkBg: "bg-stone-200",
    checkText: "text-stone-900",
    ctaBg: "bg-stone-950",
    ctaButton: "bg-stone-700 text-white",
    print: {
      pageBg: "#eee9dd",
      paperBg: "#fffdf8",
      panelBg: "rgba(28,25,23,.72)",
      accent: "#e7e5e4",
      label: "#57534e",
      sideBg: "#fafaf9",
      checkBg: "#e7e5e4",
      checkText: "#292524",
      ctaBg: "#1c1917",
      ctaButton: "#57534e",
    },
  },
  midnight: {
    label: "Midnight blue",
    heroPanel: "border-blue-300 bg-blue-950/76",
    heroAccent: "border-blue-300",
    eyebrow: "border-blue-100/45 bg-blue-50/12 text-white",
    labelText: "text-blue-800",
    bodyBg: "bg-white",
    sideBg: "bg-blue-50",
    checkBg: "bg-blue-100",
    checkText: "text-blue-900",
    ctaBg: "bg-blue-950",
    ctaButton: "bg-blue-700 text-white",
    print: {
      pageBg: "#e8edf5",
      paperBg: "#ffffff",
      panelBg: "rgba(23,37,84,.76)",
      accent: "#93c5fd",
      label: "#1d4ed8",
      sideBg: "#eff6ff",
      checkBg: "#dbeafe",
      checkText: "#1e3a8a",
      ctaBg: "#172554",
      ctaButton: "#1d4ed8",
    },
  },
};

const THEME_OPTIONS = Object.entries(PAMPHLET_THEMES) as [PamphletThemeId, (typeof PAMPHLET_THEMES)[PamphletThemeId]][];

export function DraftCampaignCard({
  tenantId,
  uploadedById,
  onLaunched,
}: {
  tenantId: string;
  uploadedById: string;
  onLaunched?: (name: string, recipientCount: number, scheduled: boolean) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<MarketingStudioDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [imageSeed, setImageSeed] = useState(() => Date.now());
  const [imageBroken, setImageBroken] = useState(false);
  const [pamphletTheme, setPamphletTheme] = useState<PamphletThemeId>("executive");

  const [campaignName, setCampaignName] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [strategy, setStrategy] = useState("");
  const [channels, setChannels] = useState<Set<MarketingStudioChannel>>(new Set(["email"]));
  const [audienceModes, setAudienceModes] = useState<Set<AudienceMode>>(new Set());
  const [customAudienceFilter, setCustomAudienceFilter] = useState("");
  const [selectedAudienceCustomerIds, setSelectedAudienceCustomerIds] = useState<Set<string>>(new Set());
  const [recurrence, setRecurrence] = useState<MarketingStudioRecurrence>("none");
  const [scheduleMode, setScheduleMode] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState(() => defaultScheduledFor());

  const [brandRev, setBrandRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setBrandRev((rev) => rev + 1)), []);
  const agency = useMemo(() => api.agencies.get(tenantId), [tenantId, brandRev]);
  const marketingConfig = useMemo(() => api.marketing.getConfig(tenantId), [tenantId, brandRev]);
  const agencyLogoUrl = agency?.logoUrl || "";

  const customers = useMemo(
    () => api.customers.list(tenantId).filter((customer) => !customer.archived),
    [tenantId, draft]
  );
  const prospects = useMemo(
    () => api.prospects.listByTenant(tenantId).filter((prospect) => !prospect.archived),
    [tenantId, draft]
  );

  const resolved = useMemo(() => {
    const selected = Array.from(audienceModes);
    const customFilter = customAudienceFilter.trim();
    const customerIds = new Set<string>();
    const prospectIds = new Set<string>();
    const includeAllClients = audienceModes.has("all_clients");
    const includeAllProspects = audienceModes.has("all_prospects");

    if (!includeAllClients) {
      selectedAudienceCustomerIds.forEach((id) => customerIds.add(id));
      customers.forEach((customer) => {
        if (selected.some((mode) => customerMatchesAudience(tenantId, customer, mode))) {
          customerIds.add(customer.id);
        }
      });
    }
    if (!includeAllProspects) {
      prospects.forEach((prospect) => {
        if (selected.some((mode) => prospectMatchesAudience(prospect, mode))) {
          prospectIds.add(prospect.id);
        }
      });
    }
    if (customFilter) {
      customers.forEach((customer) => {
        if (!includeAllClients && customerMatchesCustomAudience(tenantId, customer, customFilter)) {
          customerIds.add(customer.id);
        }
      });
      prospects.forEach((prospect) => {
        if (!includeAllProspects && prospectMatchesCustomAudience(prospect, customFilter)) {
          prospectIds.add(prospect.id);
        }
      });
    }

    return {
      includeAllClients,
      includeAllProspects,
      hasAudience: audienceModes.size > 0 || !!customFilter || selectedAudienceCustomerIds.size > 0,
      customerIds: Array.from(customerIds),
      prospectIds: Array.from(prospectIds),
      total: (includeAllClients ? customers.length : customerIds.size) +
        (includeAllProspects ? prospects.length : prospectIds.size),
    };
  }, [audienceModes, customAudienceFilter, customers, prospects, selectedAudienceCustomerIds, tenantId]);

  const imageUrl = draft ? marketingStudioImageUrl(draft, imageSeed) : "";
  const theme = PAMPHLET_THEMES[pamphletTheme];

  async function generateCampaign(nextPrompt = prompt) {
    const cleanPrompt = nextPrompt.trim();
    if (!cleanPrompt) {
      setError("Type the marketing brief first.");
      return;
    }
    setPrompt(cleanPrompt);
    setBusy(true);
    setError(null);
    setConfirmation(null);
    setImageBroken(false);
    try {
      const next = await draftMarketingStudioCampaign({
        prompt: cleanPrompt,
        agencyName: agency?.name,
        agencyAddress: agency?.address,
        senderName: marketingConfig.senderName,
        signOff: marketingConfig.signOff,
      });
      setDraft(next);
      setCampaignName(next.campaignName);
      setEmailSubject(next.emailSubject);
      setEmailBody(next.emailBody);
      setStrategy(next.strategy);
      setChannels(new Set(["email"]));
      setAudienceModes(new Set(next.audience));
      setSelectedAudienceCustomerIds(new Set());
      setCustomAudienceFilter("");
      setRecurrence(next.recurrence);
      setImageSeed(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The AI campaign studio failed to generate.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPrompt("");
    setDraft(null);
    setCampaignName("");
    setEmailSubject("");
    setEmailBody("");
    setStrategy("");
    setChannels(new Set(["email"]));
    setAudienceModes(new Set());
    setSelectedAudienceCustomerIds(new Set());
    setCustomAudienceFilter("");
    setRecurrence("none");
    setScheduleMode("now");
    setScheduledFor(defaultScheduledFor());
    setPamphletTheme("executive");
    setImageBroken(false);
    setError(null);
  }

  function toggleChannel(channel: MarketingStudioChannel) {
    setChannels(new Set([channel]));
  }

  function toggleAudience(mode: AudienceMode) {
    if (mode === "all_clients") {
      setSelectedAudienceCustomerIds(new Set());
    }
    setAudienceModes((current) => {
      const next = new Set(current);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }

  function toggleSelectedAudienceCustomer(customerId: string) {
    setAudienceModes((current) => {
      if (!current.has("all_clients")) return current;
      const next = new Set(current);
      next.delete("all_clients");
      return next;
    });
    setSelectedAudienceCustomerIds((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  function updatePamphletField(field: EditablePamphletField, value: string) {
    setDraft((current) => {
      if (!current) return current;
      const fallback = current.pamphlet[field];
      return {
        ...current,
        pamphlet: {
          ...current.pamphlet,
          [field]: cleanEditableText(value, fallback),
        },
      };
    });
  }

  function updatePamphletHighlight(index: number, value: string) {
    setDraft((current) => {
      if (!current) return current;
      const highlights = [...current.pamphlet.highlights];
      highlights[index] = cleanEditableText(value, highlights[index]);
      return {
        ...current,
        pamphlet: {
          ...current.pamphlet,
          highlights,
        },
      };
    });
  }

  function launchCampaign() {
    if (!draft) return;
    if (!campaignName.trim()) return setError("Give the campaign a name.");
    if (channels.size === 0) return setError("Email must be selected.");
    if (!resolved.hasAudience || resolved.total === 0) {
      return setError("Choose an audience with at least one recipient.");
    }
    if (channels.has("email") && (!emailSubject.trim() || !emailBody.trim())) {
      return setError("Email subject and body are required.");
    }

    let scheduledIso: string | undefined;
    if (scheduleMode === "scheduled") {
      const scheduledMs = Date.parse(scheduledFor);
      if (!Number.isFinite(scheduledMs) || scheduledMs <= Date.now()) {
        return setError("Scheduled send time must be in the future.");
      }
      scheduledIso = new Date(scheduledMs).toISOString();
    }

    setBusy(true);
    setError(null);
    try {
      const out = api.marketing.composeAiCampaign({
        tenantId,
        name: campaignName.trim(),
        channels: ["email"],
        brief: launchBrief({
          strategy,
          emailSubject,
          emailBody,
          draft,
        }),
        emailSubject: emailSubject.trim(),
        emailBody: emailBody.trim(),
        heroImageUrl: imageUrl,
        heroImageAlt: draft.pamphlet.headline,
        pamphlet: draft.pamphlet,
        pamphletTheme,
        ctaLabel: MARKETING_STUDIO_CTA_BUTTON,
        appOrigin: window.location.origin,
        includeAllClients: resolved.includeAllClients,
        includeAllProspects: resolved.includeAllProspects,
        selectedCustomerIds: resolved.includeAllClients ? [] : resolved.customerIds,
        selectedProspectIds: resolved.includeAllProspects ? [] : resolved.prospectIds,
        scheduledFor: scheduledIso,
        recurrence,
        actorId: uploadedById,
      });
      const scheduled = scheduleMode === "scheduled";
      setConfirmation(
        `Campaign "${campaignName.trim()}" ${scheduled ? "scheduled" : "approved"} for ${out.messageCount} recipient${
          out.messageCount === 1 ? "" : "s"
        }.`
      );
      onLaunched?.(campaignName.trim(), out.messageCount, scheduled);
      reset();
      window.setTimeout(() => setConfirmation(null), 6000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Draft Campaign"
        subtitle="AI marketing studio"
        action={
          draft ? (
            <button type="button" className="btn-outline text-xs" onClick={reset} disabled={busy}>
              <X className="h-3.5 w-3.5" />
              New prompt
            </button>
          ) : null
        }
      />

      {confirmation && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {confirmation}
        </div>
      )}

      <div className="rounded-md border border-ink-100 bg-white p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
          <Wand2 className="h-4 w-4 text-gold-600" />
          Marketing prompt
        </div>
        <textarea
          className="input min-h-[130px] text-sm"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={busy}
          placeholder="Tell the AI exactly what you want this campaign and digital pamphlet to accomplish. Example: create a premium digital pamphlet for commercial umbrella policy clients who added new locations and company vehicles. Make it feel high-ticket, explain the risk clearly, and use an image of a business owner protecting the whole operation."
        />
        {!draft && (
          <div className="mt-3 flex flex-wrap gap-2">
            {PROMPT_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="max-w-[360px] rounded-md border border-ink-200 bg-white px-3 py-2 text-left text-xs leading-5 text-ink-700 hover:border-gold-400 hover:text-gold-800"
                onClick={() => setPrompt(example)}
                disabled={busy}
              >
                {example}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="btn-gold text-sm"
            onClick={() => generateCampaign()}
            disabled={busy || !prompt.trim()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {draft ? "Regenerate from prompt" : "Generate campaign"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
          {error}
        </div>
      )}

      {draft && (
        <div className="mt-5 space-y-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Digital pamphlet
                </div>
                <div className="text-sm text-ink-500">
                  Click directly into the pamphlet text to edit it.
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="inline-flex items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 shadow-sm">
                  Scheme
                  <select
                    className="bg-transparent text-xs font-semibold text-ink-900 outline-none"
                    value={pamphletTheme}
                    onChange={(event) => setPamphletTheme(event.target.value as PamphletThemeId)}
                  >
                    {THEME_OPTIONS.map(([id, option]) => (
                      <option key={id} value={id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => {
                    setImageBroken(false);
                    setImageSeed(Date.now());
                  }}
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Regenerate image
                </button>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => openPamphlet(draft, imageUrl, pamphletTheme, agency, agencyLogoUrl)}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  View
                </button>
              </div>
            </div>
            <PamphletConcept
              draft={draft}
              imageUrl={imageUrl}
              imageBroken={imageBroken}
              onImageError={() => setImageBroken(true)}
              theme={theme}
              agency={agency}
              logoUrl={agencyLogoUrl}
              onFieldChange={updatePamphletField}
              onHighlightChange={updatePamphletHighlight}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
              <ReviewPanel
                campaignName={campaignName}
                setCampaignName={setCampaignName}
                emailSubject={emailSubject}
                setEmailSubject={setEmailSubject}
                emailBody={emailBody}
                setEmailBody={setEmailBody}
                channels={channels}
                toggleChannel={toggleChannel}
                recurrence={recurrence}
              setRecurrence={setRecurrence}
            />

            <div className="space-y-4">
              <AudiencePanel
                audienceModes={audienceModes}
                toggleAudience={toggleAudience}
                customAudienceFilter={customAudienceFilter}
                setCustomAudienceFilter={setCustomAudienceFilter}
                customers={customers}
                selectedCustomerIds={selectedAudienceCustomerIds}
                toggleSelectedCustomer={toggleSelectedAudienceCustomer}
                recipientCount={resolved.total}
              />

              <LaunchPanel
                scheduleMode={scheduleMode}
                setScheduleMode={setScheduleMode}
                scheduledFor={scheduledFor}
                setScheduledFor={setScheduledFor}
                busy={busy}
                onLaunch={launchCampaign}
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function ReviewPanel({
  campaignName,
  setCampaignName,
  emailSubject,
  setEmailSubject,
  emailBody,
  setEmailBody,
  channels,
  toggleChannel,
  recurrence,
  setRecurrence,
}: {
  campaignName: string;
  setCampaignName: (value: string) => void;
  emailSubject: string;
  setEmailSubject: (value: string) => void;
  emailBody: string;
  setEmailBody: (value: string) => void;
  channels: Set<MarketingStudioChannel>;
  toggleChannel: (channel: MarketingStudioChannel) => void;
  recurrence: MarketingStudioRecurrence;
  setRecurrence: (value: MarketingStudioRecurrence) => void;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-4">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
        <Check className="h-4 w-4 text-gold-600" />
        Review campaign
      </div>
      <div className="space-y-3">
        <div>
          <label className="label">Campaign name</label>
          <input className="input" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} />
        </div>
        <div>
          <label className="label">Channels</label>
          <div className="flex flex-wrap gap-2">
            <ChannelButton channel="email" selected={channels.has("email")} onClick={() => toggleChannel("email")} />
          </div>
        </div>
        <div>
          <label className="label">Email subject</label>
          <input className="input" value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} />
        </div>
        <div>
          <label className="label">Email body</label>
          <textarea
            className="input min-h-[220px] text-sm"
            value={emailBody}
            onChange={(event) => setEmailBody(event.target.value)}
          />
        </div>
        <div>
          <label className="label">Recurrence</label>
          <select
            className="input max-w-[220px]"
            value={recurrence}
            onChange={(event) => setRecurrence(event.target.value as MarketingStudioRecurrence)}
          >
            <option value="none">One time</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function ChannelButton({
  channel,
  selected,
  onClick,
}: {
  channel: MarketingStudioChannel;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = Mail;
  return (
    <button
      type="button"
      className={`rounded-md border px-3 py-2 text-sm font-semibold inline-flex items-center gap-2 ${
        selected ? "border-gold-500 bg-gold-100 text-gold-900" : "border-ink-200 bg-white text-ink-700"
      }`}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      {channel.toUpperCase()}
    </button>
  );
}

function AudiencePanel({
  audienceModes,
  toggleAudience,
  customAudienceFilter,
  setCustomAudienceFilter,
  customers,
  selectedCustomerIds,
  toggleSelectedCustomer,
  recipientCount,
}: {
  audienceModes: Set<AudienceMode>;
  toggleAudience: (mode: AudienceMode) => void;
  customAudienceFilter: string;
  setCustomAudienceFilter: (value: string) => void;
  customers: CustomerProfile[];
  selectedCustomerIds: Set<string>;
  toggleSelectedCustomer: (customerId: string) => void;
  recipientCount: number;
}) {
  const [clientSearch, setClientSearch] = useState("");
  const searchText = normalizeAudienceText(clientSearch);
  const selectedCustomers = customers.filter((customer) => selectedCustomerIds.has(customer.id));
  const matchingCustomers = searchText
    ? customers
        .filter((customer) => customerMatchesClientSearch(customer, searchText))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 6)
    : [];

  return (
    <div className="rounded-md border border-ink-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Audience</div>
        <div className="rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold text-white">
          {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
        </div>
      </div>
      <div>
        <span className="label">Sort</span>
        <div className="rounded-md border border-ink-100 bg-ink-50 p-1">
          <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {AUDIENCE_OPTIONS.map((option) => {
              const selected = audienceModes.has(option.mode);
              return (
                <button
                  key={option.mode}
                  type="button"
                  className={`inline-flex min-h-10 items-center justify-between gap-2 rounded-[6px] px-3 py-2 text-sm font-semibold transition ${
                    selected
                      ? "bg-white text-ink-950 shadow-sm ring-1 ring-gold-300"
                      : "text-ink-600 hover:bg-white hover:text-ink-950"
                  }`}
                  onClick={() => toggleAudience(option.mode)}
                >
                  <span className="truncate">{option.label}</span>
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-gold-500 bg-gold-500 text-white" : "border-ink-200 bg-white text-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    <Check className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="label">Select clients</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input pl-9"
              value={clientSearch}
              onChange={(event) => setClientSearch(event.target.value)}
              placeholder="Search clients"
            />
          </div>
        </label>

        {searchText && (
          <div className="rounded-md border border-ink-100 bg-ink-50/70 p-2">
            {matchingCustomers.length > 0 ? (
              <div className="grid gap-1.5">
                {matchingCustomers.map((customer) => {
                  const selected = selectedCustomerIds.has(customer.id);
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition ${
                        selected
                          ? "border-gold-400 bg-gold-50 text-ink-950"
                          : "border-transparent bg-white text-ink-800 hover:border-ink-200"
                      }`}
                      onClick={() => toggleSelectedCustomer(customer.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{customer.businessName || customer.name}</span>
                        <span className="block truncate text-xs text-ink-500">{customer.email}</span>
                      </span>
                      <span
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                          selected ? "border-gold-500 bg-gold-500 text-white" : "border-ink-200 bg-white text-transparent"
                        }`}
                        aria-hidden="true"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-ink-500">No matching clients</div>
            )}
          </div>
        )}

        {selectedCustomers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-gold-200 bg-gold-50 px-3 py-1.5 text-xs font-semibold text-gold-900 transition hover:border-gold-400"
                onClick={() => toggleSelectedCustomer(customer.id)}
              >
                {customer.businessName || customer.name}
                <X className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        )}

        <label className="block">
          <span className="label">AI sort</span>
          <div className="relative">
            <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-600" />
            <input
              className="input pl-9"
              value={customAudienceFilter}
              onChange={(event) => setCustomAudienceFilter(event.target.value)}
              placeholder="High-value clients with renewals due"
            />
          </div>
        </label>
      </div>

      {customAudienceFilter.trim() && (
        <div className="mt-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs leading-5 text-gold-900">
          AI sort: {customAudienceFilter.trim()}
        </div>
      )}
    </div>
  );
}

function LaunchPanel({
  scheduleMode,
  setScheduleMode,
  scheduledFor,
  setScheduledFor,
  busy,
  onLaunch,
}: {
  scheduleMode: "now" | "scheduled";
  setScheduleMode: (value: "now" | "scheduled") => void;
  scheduledFor: string;
  setScheduledFor: (value: string) => void;
  busy: boolean;
  onLaunch: () => void;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">Approval</div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
            scheduleMode === "now" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700"
          }`}
          onClick={() => setScheduleMode("now")}
        >
          <Send className="h-4 w-4" />
          Send now
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
            scheduleMode === "scheduled" ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white text-ink-700"
          }`}
          onClick={() => setScheduleMode("scheduled")}
        >
          <CalendarClock className="h-4 w-4" />
          Schedule
        </button>
      </div>
      {scheduleMode === "scheduled" && (
        <input
          className="input mt-3 max-w-[280px]"
          type="datetime-local"
          value={scheduledFor}
          onChange={(event) => setScheduledFor(event.target.value)}
        />
      )}
      <button type="button" className="btn-gold mt-4 w-full justify-center text-sm" onClick={onLaunch} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Approve campaign
      </button>
    </div>
  );
}

function PamphletConcept({
  draft,
  imageUrl,
  imageBroken,
  onImageError,
  theme,
  agency,
  logoUrl,
  onFieldChange,
  onHighlightChange,
}: {
  draft: MarketingStudioDraft;
  imageUrl: string;
  imageBroken: boolean;
  onImageError: () => void;
  theme: (typeof PAMPHLET_THEMES)[PamphletThemeId];
  agency?: Agency;
  logoUrl?: string;
  onFieldChange: (field: EditablePamphletField, value: string) => void;
  onHighlightChange: (index: number, value: string) => void;
}) {
  const contactUrls = agencyContactUrls(agency);
  const contactUrl = contactUrls.desktop;
  const agencyName = agency?.name ?? "Your agency";

  return (
    <div className={`overflow-hidden rounded-md border border-ink-100 ${theme.bodyBg} shadow-[0_22px_55px_rgba(23,19,15,0.12)]`}>
      <div className="relative min-h-[360px] bg-ink-950">
        {!imageBroken ? (
          <img
            src={imageUrl}
            alt={draft.pamphlet.headline}
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
            decoding="async"
            onError={onImageError}
          />
        ) : (
          <PremiumFallbackArt draft={draft} />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(23,19,15,0.28)_0%,rgba(23,19,15,0.34)_32%,rgba(23,19,15,0.92)_100%)]" />
        <div className="relative flex min-h-[360px] flex-col justify-end p-7 text-white">
          <div className="mb-5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/82">
            {logoUrl && (
              <img
                src={logoUrl}
                alt={`${agencyName} logo`}
                className="mr-1 max-h-11 max-w-[11rem] object-contain drop-shadow-[0_8px_22px_rgba(0,0,0,0.58)]"
              />
            )}
            <span className="rounded-md border border-white/25 bg-white/12 px-3 py-1 text-white/95 shadow-sm backdrop-blur-sm">
              {agencyName}
            </span>
            <span>Private client insurance</span>
          </div>
          <div className={`max-w-[820px] border-l-4 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.38)] backdrop-blur-[2px] ${theme.heroPanel}`}>
            <EditableText
              tag="div"
              value={draft.pamphlet.eyebrow}
              className={`mb-4 w-fit border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] shadow-sm ${theme.eyebrow}`}
              ariaLabel="Pamphlet eyebrow"
              singleLine
              onChange={(value) => onFieldChange("eyebrow", value)}
            />
            <EditableText
              tag="h3"
              value={draft.pamphlet.headline}
              className="font-display text-[clamp(2rem,4vw,3.8rem)] leading-[0.96] text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.7)]"
              ariaLabel="Pamphlet headline"
              onChange={(value) => onFieldChange("headline", value)}
            />
            <EditableText
              tag="p"
              value={draft.pamphlet.subheadline}
              className="mt-4 max-w-2xl text-base font-medium leading-7 text-white/95 [text-shadow:0_1px_12px_rgba(0,0,0,0.72)]"
              ariaLabel="Pamphlet subheadline"
              onChange={(value) => onFieldChange("subheadline", value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="p-7 lg:p-8">
          <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.labelText}`}>
            Advisor briefing
          </div>
          <EditableText
            tag="p"
            value={draft.pamphlet.intro}
            className="mt-4 text-[15px] leading-8 text-ink-700"
            ariaLabel="Pamphlet intro"
            onChange={(value) => onFieldChange("intro", value)}
          />
        </div>
        <div className={`border-t border-ink-100 p-7 lg:border-l lg:border-t-0 lg:p-8 ${theme.sideBg}`}>
          <EditableText
            tag="div"
            value={draft.pamphlet.highlightsTitle}
            className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500"
            ariaLabel="Pamphlet highlights title"
            singleLine
            onChange={(value) => onFieldChange("highlightsTitle", value)}
          />
          <div className="mt-4 grid gap-3">
            {draft.pamphlet.highlights.map((item, index) => (
              <div key={`${index}-${item}`} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 text-sm leading-6 text-ink-800">
                <span className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${theme.checkBg} ${theme.checkText}`}>
                  <Check className="h-3.5 w-3.5" />
                </span>
                <EditableText
                  tag="span"
                  value={item}
                  className="min-w-0"
                  ariaLabel={`Pamphlet highlight ${index + 1}`}
                  onChange={(value) => onHighlightChange(index, value)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`border-t border-ink-100 p-6 text-white ${theme.ctaBg}`}>
        <div className="flex justify-end">
          <a
            href={contactUrl}
            data-mobile-href={contactUrls.mobile}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the agency contact page"
            aria-label="Get in touch with the agency"
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold shadow-sm ring-2 ring-white/35 transition hover:-translate-y-0.5 hover:ring-white/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 ${theme.ctaButton}`}
          >
            {MARKETING_STUDIO_CTA_BUTTON}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
        <PamphletContact agency={agency} />
      </div>
    </div>
  );
}

function PremiumFallbackArt({ draft }: { draft: MarketingStudioDraft }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-950">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#17130f_0%,#33291c_44%,#9a7837_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(23,19,15,0.76)_100%)]" />
      <div className="absolute left-8 top-8 h-28 w-44 border border-white/20 bg-white/10 backdrop-blur-sm" />
      <div className="absolute right-10 top-12 h-40 w-64 border border-gold-200/30 bg-ink-900/35" />
      <div className="absolute bottom-16 left-8 right-8 grid gap-3 sm:grid-cols-[1fr_0.75fr]">
        <div className="border border-white/20 bg-white/12 p-5 text-white backdrop-blur-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-100">
            Visual direction
          </div>
          <div className="mt-3 font-display text-3xl leading-tight">{draft.pamphlet.eyebrow}</div>
          <p className="mt-3 text-sm leading-6 text-white/78">{draft.pamphlet.imagePrompt}</p>
        </div>
        <div className="hidden border border-white/15 bg-white/8 p-5 text-sm leading-6 text-white/72 sm:block">
          {draft.pamphlet.subheadline}
        </div>
      </div>
    </div>
  );
}

function EditableText({
  tag = "div",
  value,
  className,
  ariaLabel,
  singleLine = false,
  onChange,
}: {
  tag?: "div" | "p" | "h3" | "span";
  value: string;
  className?: string;
  ariaLabel: string;
  singleLine?: boolean;
  onChange: (value: string) => void;
}) {
  const Tag = tag;

  function handleBlur(event: FocusEvent<HTMLElement>) {
    onChange(event.currentTarget.innerText);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (singleLine && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  return (
    <Tag
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      tabIndex={0}
      spellCheck
      className={`rounded-sm outline-none transition focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${className ?? ""}`}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {value}
    </Tag>
  );
}

type PamphletContactDetail = {
  label: string;
  href?: string;
};

function PamphletContact({ agency }: { agency?: Agency }) {
  const details = contactDetails(agency);
  if (!details.length) return null;
  return (
    <div className="mt-5 border-t border-white/15 pt-4 text-xs leading-5 text-white/78">
      <div className="font-semibold uppercase tracking-[0.14em] text-white/92">
        {agency?.name ?? "Agency contact"}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {details.map((detail) => (
          detail.href ? (
            <a key={detail.label} href={detail.href} target="_blank" rel="noopener noreferrer" className="text-white/86 underline-offset-4 hover:underline">
              {detail.label}
            </a>
          ) : (
            <span key={detail.label}>{detail.label}</span>
          )
        ))}
      </div>
    </div>
  );
}

function contactDetails(agency?: Agency): PamphletContactDetail[] {
  const details: PamphletContactDetail[] = [];
  if (agency?.contactEmail?.trim()) {
    details.push({
      label: agency.contactEmail.trim(),
      href: `mailto:${agency.contactEmail.trim()}`,
    });
  }
  if (agency?.phone?.trim()) {
    details.push({
      label: agency.phone.trim(),
      href: `tel:${agency.phone.replace(/[^\d+]/g, "")}`,
    });
  }
  if (agency?.website?.trim()) {
    const href = normalizeMarketingHref(agency.website);
    details.push(href ? { label: displayWebsite(agency.website), href } : { label: displayWebsite(agency.website) });
  }
  if (agency?.address?.trim()) {
    details.push({ label: agency.address.trim() });
  }
  return details.length ? details : [{ label: "Contact your agency team for a review." }];
}

function agencyContactUrls(agency?: Agency): { desktop: string; mobile: string } {
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  const href = marketingSmartContactUrl({ origin, tenantId: agency?.id });
  return { desktop: href, mobile: href };
}

function displayWebsite(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function cleanEditableText(value: string, fallback: string): string {
  const cleaned = value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || fallback;
}

function customerMatchesAudience(tenantId: string, customer: CustomerProfile, mode: AudienceMode): boolean {
  if (mode === "all_clients") return true;
  if (mode === "all_prospects") return false;
  const assets = api.assets.listByCustomer(customer.id);
  const policies = api.policies.listByCustomer(customer.id);
  if (mode === "auto_clients") {
    return policies.some((policy) => api.assets.get(policy.assetId)?.type === "luxury_vehicle");
  }
  if (mode === "coastal_home_clients") return assets.some((asset) => asset.type === "coastal_home");
  if (mode === "high_value_clients") {
    return assets.some((asset) => (asset.estimatedValue ?? 0) >= 1_000_000);
  }
  if (mode === "renewal_clients") {
    const upcomingPolicyIds = new Set(
      api.renewals
        .listByTenant(tenantId)
        .filter((renewal) => renewal.status === "upcoming")
        .map((renewal) => renewal.policyId)
    );
    return policies.some((policy) => upcomingPolicyIds.has(policy.id));
  }
  return false;
}

function customerMatchesCustomAudience(tenantId: string, customer: CustomerProfile, filter: string): boolean {
  const text = normalizeAudienceText(filter);
  if (wantsProspectsOnly(text)) return false;

  const assets = api.assets.listByCustomer(customer.id);
  const policies = api.policies.listByCustomer(customer.id);
  const renewals = api.renewals.listByTenant(tenantId).filter((renewal) =>
    policies.some((policy) => policy.id === renewal.policyId)
  );
  const claims = api.claims.listByCustomer(customer.id);
  return matchesAiCustomFilter(filter, {
    text: [
      customer.name,
      customer.businessName,
      customer.clientCode,
      customer.email,
      customer.phone,
      customer.mailingAddress,
      customer.garagingAddress,
      customer.lineOfBusiness,
      ...assets.flatMap((asset) => [
        asset.label,
        asset.type,
        api.helpers.assetTypeLabel(asset.type),
        asset.status,
        ...aiAssetTypeAliases(asset.type),
      ]),
      ...policies.flatMap((policy) => [
        fmt.policyRef(policy),
        policy.policyNumber,
        policy.status,
        policy.renewalStatus,
        api.helpers.departmentLabel(policy),
        api.carriers.get(policy.carrierId)?.name,
      ]),
      ...renewals.map((renewal) => renewal.status),
      ...claims.map((claim) => claim.status),
    ],
    flags: {
      active: !customer.archived,
      assigned: Boolean(customer.assignedAgentId || (customer.additionalAgentIds ?? []).length || customer.assignedCsrId || (customer.additionalCsrIds ?? []).length),
      unassigned: !customer.assignedAgentId && !(customer.additionalAgentIds ?? []).length && !customer.assignedCsrId && !(customer.additionalCsrIds ?? []).length,
      emailOptIn: Boolean(customer.marketingOptInEmail),
      smsOptIn: Boolean(customer.marketingOptInSms),
      optedOut: !customer.marketingOptInEmail && !customer.marketingOptInSms,
      bound: policies.some((policy) => policy.status === "bound"),
      renewal: renewals.some((renewal) => renewal.status === "upcoming"),
      personal: policies.some((policy) => !policy.department || policy.department === "personal"),
      commercial: policies.some((policy) => policy.department === "commercial"),
      claim: claims.length > 0,
      openClaim: claims.some((claim) => claim.status !== "closed"),
      closedClaim: claims.some((claim) => claim.status === "closed"),
      noPolicies: policies.length === 0,
    },
    numbers: [
      ...assets.map((asset) => asset.estimatedValue),
      ...policies.flatMap((policy) => [policy.finalPremium, policy.premiumEstimate]),
    ],
  });
}

function customerMatchesClientSearch(customer: CustomerProfile, searchText: string): boolean {
  if (!searchText) return true;
  const corpus = normalizeAudienceText(
    [
      customer.name,
      customer.businessName,
      customer.clientCode,
      customer.email,
      customer.phone,
      customer.mailingAddress,
      customer.lineOfBusiness,
    ]
      .filter(Boolean)
      .join(" ")
  );
  return searchText.split(/\s+/).filter(Boolean).every((word) => corpus.includes(word));
}

function prospectMatchesAudience(prospect: Prospect, mode: AudienceMode): boolean {
  if (mode === "all_prospects") return true;
  if (mode === "all_clients") return false;
  if (mode === "auto_clients") return prospect.assetType === "luxury_vehicle";
  if (mode === "coastal_home_clients") return prospect.assetType === "coastal_home";
  if (mode === "high_value_clients") return (prospect.estimatedValue ?? 0) >= 1_000_000;
  if (mode === "renewal_clients") return false;
  return false;
}

function prospectMatchesCustomAudience(prospect: Prospect, filter: string): boolean {
  const text = normalizeAudienceText(filter);
  if (wantsClientsOnly(text)) return false;
  return matchesAiCustomFilter(filter, {
    text: [
      prospect.name,
      prospect.email,
      prospect.phone,
      prospect.assetType,
      api.helpers.assetTypeLabel(prospect.assetType),
      ...aiAssetTypeAliases(prospect.assetType),
      prospect.status,
      prospect.marketingStatus,
      prospect.aiSummary,
      prospect.lastAction,
      prospect.recommendedFollowUp,
    ],
    flags: {
      active: prospect.marketingStatus === "active" || prospect.status !== "lost",
      assigned: Boolean(prospect.assignedAgentId || (prospect.additionalAgentIds ?? []).length || prospect.assignedCsrId || (prospect.additionalCsrIds ?? []).length),
      unassigned: !prospect.assignedAgentId && !(prospect.additionalAgentIds ?? []).length && !prospect.assignedCsrId && !(prospect.additionalCsrIds ?? []).length,
      optedOut: prospect.marketingStatus === "opted_out",
      paused: prospect.marketingStatus === "paused",
      new: prospect.status === "new",
      contacted: prospect.status === "contacted",
      quote: prospect.status === "quote_in_progress",
      abandoned: prospect.status === "abandoned",
      nurturing: prospect.status === "nurturing",
      converted: prospect.status === "converted",
      lost: prospect.status === "lost",
    },
    numbers: [prospect.estimatedValue],
  });
}

function normalizeAudienceText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function wantsProspectsOnly(text: string): boolean {
  return /\b(prospect|prospects|lead|leads|quote starts?)\b/.test(text) && !/\b(client|clients|customer|customers)\b/.test(text);
}

function wantsClientsOnly(text: string): boolean {
  return /\b(client|clients|customer|customers|policyholder|policyholders)\b/.test(text) && !/\b(prospect|prospects|lead|leads)\b/.test(text);
}

function matchesNameEmailPhone(text: string, name: string, email?: string, phone?: string): boolean {
  const explicit = text.match(/\b(?:named?|name|email|phone|contact)\s+([a-z0-9@.+\-\s]{3,})$/i)?.[1]?.trim();
  if (!explicit) return true;
  const haystack = [name, email, phone].filter(Boolean).join(" ").toLowerCase();
  return explicit.split(/\s+/).filter(Boolean).every((part) => haystack.includes(part));
}

function requestedAssetType(text: string): AssetType | undefined {
  if (/\b(coastal home|coastal homes|home|homes|house|houses|dwelling|property)\b/.test(text)) return "coastal_home";
  if (/\b(auto|autos|vehicle|vehicles|car|cars|luxury vehicle|garage|driver)\b/.test(text)) return "luxury_vehicle";
  if (/\b(jewelry|jewel|watch|watches|ring|rings|valuables|appraisal|appraisals)\b/.test(text)) return "jewelry";
  if (/\b(yacht|boat|watercraft|marine)\b/.test(text)) return "yacht";
  if (/\b(umbrella|liability|excess)\b/.test(text)) return "umbrella_liability";
  if (/\b(full portfolio|whole portfolio|entire portfolio)\b/.test(text)) return "full_portfolio";
  if (/\b(art|fine art|collection|collections)\b/.test(text)) return "other";
  return undefined;
}

function requestedValueThreshold(text: string): number | undefined {
  const match = text.match(/\b(?:over|above|greater than|more than|at least|\+)\s*\$?\s*(\d+(?:\.\d+)?)\s*(m|mm|million|k|thousand)?\b/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const suffix = match[2];
  if (suffix === "m" || suffix === "mm" || suffix === "million") return value * 1_000_000;
  if (suffix === "k" || suffix === "thousand") return value * 1_000;
  return value;
}

function mentionsHighValue(text: string): boolean {
  return /\b(high value|high-value|hnw|private client|luxury|millionaire|estate)\b/.test(text);
}

function mentionsRenewal(text: string): boolean {
  return /\b(renewal|renewals|renew|expir|upcoming)\b/.test(text);
}

function mentionsBoundPolicy(text: string): boolean {
  return /\b(bound|active polic|policyholders?|insured)\b/.test(text);
}

function mentionsCommercial(text: string): boolean {
  return /\b(commercial|business|company|bop|workers comp|general liability|professional liability)\b/.test(text);
}

function mentionsPersonal(text: string): boolean {
  return /\b(personal|private client|home|auto|jewelry|yacht|art)\b/.test(text);
}

function mentionsAssigned(text: string): boolean {
  return /\b(assigned|managed by|owner|owned)\b/.test(text) && !mentionsUnassigned(text);
}

function mentionsUnassigned(text: string): boolean {
  return /\b(unassigned|not assigned|awaiting agent|no owner|unmanaged)\b/.test(text);
}

function mentionsEmail(text: string): boolean {
  return /\b(email|emails|newsletter)\b/.test(text);
}

function mentionsOptedOut(text: string): boolean {
  return /\b(opted out|opt out|do not market|no marketing|unsubscribed)\b/.test(text);
}

function mentionsActiveMarketing(text: string): boolean {
  return /\b(active marketing|marketing active|nurture|nurturing)\b/.test(text);
}

function mentionsStatus(text: string, status: Prospect["status"]): boolean {
  const label = status.replace(/_/g, " ");
  return new RegExp(`\\b${label}\\b`).test(text);
}

function launchBrief(input: {
  strategy: string;
  emailSubject: string;
  emailBody: string;
  draft: MarketingStudioDraft;
}): string {
  return [
    `AI strategy:\n${input.strategy}`,
    `Email subject:\n${input.emailSubject}`,
    `Email body:\n${input.emailBody}`,
    `Pamphlet headline:\n${input.draft.pamphlet.headline}`,
    `Pamphlet image prompt:\n${input.draft.pamphlet.imagePrompt}`,
  ].join("\n\n");
}

function defaultScheduledFor(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 16);
}

function openPamphlet(
  draft: MarketingStudioDraft,
  imageUrl: string,
  themeId: PamphletThemeId,
  agency: Agency | undefined,
  logoUrl: string
) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=980,height=900");
  if (!popup) {
    alert("Pop-up blocked. Allow pop-ups to view the pamphlet.");
    return;
  }
  popup.document.write(pamphletHtml(draft, imageUrl, themeId, agency, logoUrl));
  popup.document.close();
}

function pamphletHtml(
  draft: MarketingStudioDraft,
  imageUrl: string,
  themeId: PamphletThemeId,
  agency: Agency | undefined,
  logoUrl: string
): string {
  const theme = PAMPHLET_THEMES[themeId];
  const contactHtml = pamphletContactHtml(agency);
  const contactUrls = agencyContactUrls(agency);
  const contactUrl = contactUrls.desktop;
  const agencyName = agency?.name ?? "Your agency";
  const logoHtml = logoUrl
    ? `<img class="agency-logo" src="${escAttr(logoUrl)}" alt="${escAttr(`${agencyName} logo`)}" />`
    : "";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(draft.pamphlet.headline)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: ${theme.print.pageBg}; color: #17130f; font-family: Arial, Helvetica, sans-serif; }
    main { max-width: 1040px; margin: 0 auto; background: ${theme.print.paperBg}; min-height: 100vh; box-shadow: 0 34px 90px rgba(23,19,15,.22); }
    .hero { position: relative; min-height: 560px; overflow: hidden; background: #17130f; }
    img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
    img.agency-logo { position: static; width: auto; height: auto; max-height: 46px; max-width: 170px; object-fit: contain; filter: drop-shadow(0 8px 22px rgba(0,0,0,.58)); }
    .local-art { position: absolute; inset: 0; overflow: hidden; background: linear-gradient(135deg, #17130f 0%, #33291c 44%, ${theme.print.accent} 100%); }
    .local-art:before { content: ""; position: absolute; left: 7%; top: 8%; width: 220px; height: 138px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.10); }
    .local-art:after { content: ""; position: absolute; right: 8%; top: 12%; width: 330px; height: 210px; border: 1px solid rgba(239,225,190,.30); background: rgba(23,19,15,.32); }
    .local-copy { position: absolute; left: 7%; right: 7%; bottom: 9%; max-width: 620px; border: 1px solid rgba(255,255,255,.20); background: rgba(255,255,255,.12); color: white; padding: 28px; backdrop-filter: blur(10px); }
    .local-copy strong { display: block; color: #efe1be; text-transform: uppercase; letter-spacing: .18em; font: 700 12px Arial, sans-serif; }
    .local-copy span { display: block; margin-top: 12px; font: 34px/1.1 Georgia, "Times New Roman", serif; }
    .veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(23,19,15,.28), rgba(23,19,15,.34) 32%, rgba(23,19,15,.92)); }
    .hero-content { position: relative; min-height: 560px; display: flex; flex-direction: column; justify-content: flex-end; padding: 64px; color: white; }
    .agency-brand { margin-bottom: 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: rgba(255,255,255,.84); text-transform: uppercase; letter-spacing: .16em; font: 700 12px Arial, sans-serif; }
    .agency-brand strong { display: inline-flex; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.12); color: rgba(255,255,255,.96); padding: 7px 12px; border-radius: 6px; box-shadow: 0 10px 28px rgba(0,0,0,.18); }
    .hero-panel { max-width: 860px; border-left: 5px solid ${theme.print.accent}; background: ${theme.print.panelBg}; padding: 30px; box-shadow: 0 24px 60px rgba(0,0,0,.42); backdrop-filter: blur(2px); }
    .eyebrow { width: fit-content; border: 1px solid rgba(255,255,255,.42); background: rgba(255,255,255,.14); padding: 8px 12px; color: white; text-transform: uppercase; letter-spacing: .18em; font: 700 12px Arial, sans-serif; }
    h1 { margin: 22px 0 0; max-width: 820px; font-family: Georgia, "Times New Roman", serif; font-size: clamp(46px, 7vw, 82px); line-height: .94; font-weight: 400; letter-spacing: 0; text-shadow: 0 2px 20px rgba(0,0,0,.78); }
    .sub { margin-top: 22px; max-width: 740px; color: rgba(255,255,255,.95); font: 600 22px/1.45 Arial, sans-serif; text-shadow: 0 1px 14px rgba(0,0,0,.78); }
    .content { display: grid; grid-template-columns: 1.08fr .92fr; border-top: 1px solid #e7dfd1; }
    .intro-panel { padding: 56px 64px; background: ${theme.print.paperBg}; }
    .label { color: ${theme.print.label}; text-transform: uppercase; letter-spacing: .16em; font: 700 12px Arial, sans-serif; }
    .intro { margin-top: 20px; font: 18px/1.85 Arial, sans-serif; color: #453d34; }
    .highlights { padding: 56px 56px; border-left: 1px solid #e7dfd1; background: ${theme.print.sideBg}; }
    .items { margin-top: 22px; display: grid; gap: 16px; }
    .item { display: grid; grid-template-columns: 28px 1fr; gap: 13px; color: #2e2923; font: 16px/1.55 Arial, sans-serif; }
    .check { width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: ${theme.print.checkBg}; color: ${theme.print.checkText}; font-weight: 800; }
    .cta { background: ${theme.print.ctaBg}; color: white; padding: 42px 64px; }
    .cta-row { display: flex; align-items: center; justify-content: flex-end; gap: 28px; font: 24px/1.35 Arial, sans-serif; }
    .btn { display: inline-flex; align-items: center; gap: 9px; white-space: nowrap; background: ${theme.print.ctaButton}; color: white; padding: 15px 22px; border-radius: 6px; font: 800 14px Arial, sans-serif; text-decoration: none; border: 2px solid rgba(255,255,255,.42); box-shadow: 0 12px 24px rgba(0,0,0,.22); text-transform: uppercase; letter-spacing: .05em; }
    .btn:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.82); }
    .contact { margin-top: 28px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.18); color: rgba(255,255,255,.78); font: 13px/1.55 Arial, sans-serif; }
    .contact strong { display: block; color: rgba(255,255,255,.94); text-transform: uppercase; letter-spacing: .14em; font-size: 12px; }
    .contact span, .contact a { display: inline-block; margin: 8px 18px 0 0; color: rgba(255,255,255,.84); text-decoration: none; }
    .contact a:hover { text-decoration: underline; text-underline-offset: 4px; }
    @media (max-width: 760px) {
      main { box-shadow: none; }
      .hero, .hero-content { min-height: 520px; }
      .hero-content, .intro-panel, .highlights, .cta { padding: 34px; }
      .content { grid-template-columns: 1fr; }
      .highlights { border-left: 0; border-top: 1px solid #e7dfd1; }
      .cta-row { justify-content: flex-start; }
    }
    @media print { body { background: white; } main { max-width: none; box-shadow: none; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="local-art"><div class="local-copy"><strong>${esc(draft.pamphlet.eyebrow)}</strong><span>${esc(draft.pamphlet.subheadline)}</span></div></div>
      <img src="${escAttr(imageUrl)}" alt="" onerror="this.style.display='none'" />
      <div class="veil"></div>
      <div class="hero-content">
        <div class="agency-brand">${logoHtml}<strong>${esc(agencyName)}</strong><span>Private client insurance</span></div>
        <div class="hero-panel">
          <div class="eyebrow">${esc(draft.pamphlet.eyebrow)}</div>
          <h1>${esc(draft.pamphlet.headline)}</h1>
          <div class="sub">${esc(draft.pamphlet.subheadline)}</div>
        </div>
      </div>
    </section>
    <section class="content">
      <div class="intro-panel">
        <div class="label">Advisor briefing</div>
        <div class="intro">${esc(draft.pamphlet.intro)}</div>
      </div>
      <div class="highlights">
        <div class="label">${esc(draft.pamphlet.highlightsTitle)}</div>
        <div class="items">
          ${draft.pamphlet.highlights.map((item) => `<div class="item"><span class="check">&#10003;</span><span>${esc(item)}</span></div>`).join("")}
        </div>
      </div>
    </section>
    <section class="cta">
      <div class="cta-row">
        <a class="btn" href="${escAttr(contactUrl)}" data-mobile-href="${escAttr(contactUrls.mobile)}" target="_blank" rel="noopener noreferrer" aria-label="Get in touch with the agency">${esc(MARKETING_STUDIO_CTA_BUTTON)} <span aria-hidden="true">↗</span></a>
      </div>
      ${contactHtml}
    </section>
  </main>
  <script>
    (function () {
      var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || "");
      if (!isMobile) return;
      document.querySelectorAll("[data-mobile-href]").forEach(function (link) {
        var mobileHref = link.getAttribute("data-mobile-href");
        if (mobileHref) link.setAttribute("href", mobileHref);
      });
    })();
  </script>
</body>
</html>`;
}

function pamphletContactHtml(agency?: Agency): string {
  const details = contactDetails(agency);
  return `<div class="contact"><strong>${esc(agency?.name ?? "Agency contact")}</strong>${details
    .map((detail) =>
      detail.href
        ? `<a href="${escAttr(detail.href)}" target="_blank" rel="noopener noreferrer">${esc(detail.label)}</a>`
        : `<span>${esc(detail.label)}</span>`
    )
    .join("")}</div>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(value: string): string {
  return esc(value).replace(/`/g, "&#96;");
}
