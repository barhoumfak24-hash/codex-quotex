import { useEffect, useState } from "react";
import {
  FileImage,
  FileText,
  Lock,
  Mail,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserCircle,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { subscribeToDbChanges } from "@/lib/db";
import type {
  MarketingAutoMessageApprovalMode,
  MarketingAutoMessageAudience,
  MarketingAutoMessageDelayUnit,
  MarketingAutoMessageRule,
  MarketingAutoMessageSenderMode,
  MarketingAutoMessageTiming,
  MarketingAutoMessageTrigger,
  MarketingAutoMessageType,
  MarketingConfig,
  MessageChannel,
  MessageStyle,
} from "@/types";

// =====================================================================
// Marketing configuration card.
//
// Sits at the top of /employee/marketing. Managers edit the AI's
// voice + signature + attachment manifest + auto-send cadence;
// the configured values are applied every time the AI generates
// outbound prospect outreach, policy-edit acknowledgments, etc.
//
// Agents see the same panel as read-only so they know what their
// AI signature looks like without being able to edit it.
// =====================================================================

const STYLES: { value: MessageStyle; label: string; description: string }[] = [
  { value: "concierge", label: "Concierge", description: "Formal, white-glove. Best for HNW books and private-client agencies." },
  { value: "professional", label: "Professional", description: "Clear, polished, business-tone. The safe default." },
  { value: "friendly", label: "Friendly", description: "Warm, conversational, light. Lower-touch books." },
  { value: "concise", label: "Concise", description: "No fluff. Two-line messages, quick CTAs. Mobile-first." },
];

const AUTO_TRIGGERS: { value: MarketingAutoMessageTrigger; label: string; description: string }[] = [
  { value: "new_prospect", label: "New prospect", description: "Immediately after a quote lead or staff-created prospect enters the agency." },
  { value: "abandoned_quote", label: "Abandoned quote", description: "When a prospect stalls before finishing intake or document upload." },
  { value: "questionnaire_incomplete", label: "Questionnaire incomplete", description: "When a client starts but does not finish a questionnaire." },
  { value: "renewal_due", label: "Renewal due", description: "Before a renewal window needs client confirmation or fresh documents." },
  { value: "policy_bound", label: "Policy bound", description: "Welcome, thank-you, and next-step messages after binding." },
  { value: "document_request", label: "Missing documents", description: "When the system detects required documents are still missing." },
  { value: "claim_opened", label: "Claim opened", description: "Claim check-ins and carrier-path reminders." },
  { value: "birthday", label: "Birthday / relationship", description: "Relationship messages for known dates and touchpoints." },
];

const AUTO_AUDIENCES: { value: MarketingAutoMessageAudience; label: string }[] = [
  { value: "new_prospects", label: "New prospects" },
  { value: "abandoned_prospects", label: "Abandoned prospects" },
  { value: "active_clients", label: "Active clients" },
  { value: "renewal_clients", label: "Renewal clients" },
  { value: "high_value_clients", label: "High-value clients" },
  { value: "assigned_book", label: "Assigned agent book" },
  { value: "custom_filter", label: "Custom AI filter" },
];

const AUTO_TIMINGS: { value: MarketingAutoMessageTiming; label: string }[] = [
  { value: "immediate", label: "Immediately" },
  { value: "delay", label: "After delay" },
  { value: "scheduled_time", label: "At a set time" },
];

const AUTO_SENDERS: { value: MarketingAutoMessageSenderMode; label: string }[] = [
  { value: "assigned_agent", label: "Assigned agent" },
  { value: "assigned_manager", label: "Assigned manager" },
  { value: "agency_team", label: "Agency team" },
];

const AUTO_APPROVALS: { value: MarketingAutoMessageApprovalMode; label: string; description: string }[] = [
  { value: "auto_send", label: "Auto-send", description: "AI sends when the trigger and timing match." },
  { value: "draft_for_review", label: "Draft for review", description: "AI creates a draft and waits for staff approval." },
];

const AUTO_RULE_DEFAULTS: Record<MarketingAutoMessageTrigger, Partial<MarketingAutoMessageRule>> = {
  new_prospect: {
    name: "Welcome new prospects",
    messageType: "quote_intake",
    channels: ["email"],
    audience: "new_prospects",
    timing: "immediate",
    senderMode: "assigned_agent",
    approvalMode: "auto_send",
    prompt:
      "Welcome the new prospect, reference the quote they started, and give one clear next step to finish intake.",
  },
  abandoned_quote: {
    name: "Recover abandoned quotes",
    messageType: "follow_up",
    channels: ["email"],
    audience: "abandoned_prospects",
    timing: "delay",
    delayAmount: 1,
    delayUnit: "days",
    senderMode: "assigned_agent",
    approvalMode: "draft_for_review",
    prompt:
      "Send a polished follow-up that helps the prospect resume without sounding pushy or automated.",
  },
  questionnaire_incomplete: {
    name: "Finish questionnaires",
    messageType: "follow_up",
    channels: ["email"],
    audience: "active_clients",
    timing: "delay",
    delayAmount: 1,
    delayUnit: "days",
    senderMode: "assigned_agent",
    approvalMode: "draft_for_review",
    prompt:
      "Remind the client which questionnaire needs attention and explain why finishing it helps the agency move faster.",
  },
  renewal_due: {
    name: "Renewal reminders",
    messageType: "retention",
    channels: ["email"],
    audience: "renewal_clients",
    timing: "delay",
    delayAmount: 7,
    delayUnit: "days",
    senderMode: "assigned_agent",
    approvalMode: "draft_for_review",
    prompt:
      "Give the client a calm renewal reminder with what the agency is reviewing and what the client should confirm.",
  },
  policy_bound: {
    name: "Policy bound thank-you",
    messageType: "welcome",
    channels: ["email"],
    audience: "active_clients",
    timing: "immediate",
    senderMode: "assigned_agent",
    approvalMode: "auto_send",
    prompt:
      "Thank the client, confirm the policy is bound, and point them to the next useful client portal step.",
  },
  document_request: {
    name: "Missing document reminders",
    messageType: "missing_documents",
    channels: ["email"],
    audience: "active_clients",
    timing: "delay",
    delayAmount: 2,
    delayUnit: "days",
    senderMode: "assigned_agent",
    approvalMode: "draft_for_review",
    prompt:
      "Ask for missing documents in plain language, include what is still needed, and avoid legal or threatening wording.",
  },
  claim_opened: {
    name: "Claim check-ins",
    messageType: "claim_check_in",
    channels: ["email"],
    audience: "active_clients",
    timing: "delay",
    delayAmount: 3,
    delayUnit: "days",
    senderMode: "assigned_agent",
    approvalMode: "draft_for_review",
    prompt:
      "Check in on the open claim, remind the client where the carrier process stands, and offer help with next steps.",
  },
  birthday: {
    name: "Relationship touchpoints",
    messageType: "custom",
    channels: ["email"],
    audience: "assigned_book",
    timing: "scheduled_time",
    sendTime: "09:00",
    senderMode: "agency_team",
    approvalMode: "draft_for_review",
    prompt:
      "Write a short relationship message that feels personal, warm, and professional without sounding like a mass email.",
  },
};

const AUTO_MESSAGE_PRESETS: {
  trigger: MarketingAutoMessageTrigger;
  label: string;
  description: string;
}[] = [
  {
    trigger: "new_prospect",
    label: "New lead welcome",
    description: "Greet new prospects and move them to the next intake step.",
  },
  {
    trigger: "abandoned_quote",
    label: "Abandoned quote",
    description: "Follow up when someone stalls before finishing a quote.",
  },
  {
    trigger: "renewal_due",
    label: "Renewal reminder",
    description: "Prompt clients before renewals need review or documents.",
  },
  {
    trigger: "document_request",
    label: "Missing docs",
    description: "Ask for required files without sounding robotic.",
  },
];

function createAutoMessageRule(trigger: MarketingAutoMessageTrigger = "abandoned_quote"): MarketingAutoMessageRule {
  const defaults = AUTO_RULE_DEFAULTS[trigger];
  return {
    id: `mar_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: defaults.name ?? "Custom AI auto-message",
    enabled: true,
    trigger,
    messageType: (defaults.messageType as MarketingAutoMessageType) ?? "follow_up",
    channels: (defaults.channels as MessageChannel[] | undefined) ?? ["email"],
    audience: (defaults.audience as MarketingAutoMessageAudience) ?? "abandoned_prospects",
    timing: (defaults.timing as MarketingAutoMessageTiming) ?? "delay",
    delayAmount: defaults.delayAmount ?? 1,
    delayUnit: (defaults.delayUnit as MarketingAutoMessageDelayUnit | undefined) ?? "days",
    sendTime: defaults.sendTime ?? "09:00",
    senderMode: (defaults.senderMode as MarketingAutoMessageSenderMode) ?? "assigned_agent",
    approvalMode: (defaults.approvalMode as MarketingAutoMessageApprovalMode) ?? "draft_for_review",
    quietHoursStart: "20:00",
    quietHoursEnd: "08:00",
    maxPerContactPer30Days: 2,
    stopOnReply: true,
    includeAttachments: false,
    prompt:
      defaults.prompt ??
      "Write a polished, specific message that references the client or prospect context, gives one clear next step, and avoids sounding automated.",
    updatedAt: new Date().toISOString(),
  };
}

function emailOnlyAutoMessageRules(rules: MarketingAutoMessageRule[] = []): MarketingAutoMessageRule[] {
  return rules.map((rule) => ({
    ...rule,
    channels: ["email"],
  }));
}

function emailOnlyMarketingConfig(config: MarketingConfig): MarketingConfig {
  return {
    ...config,
    attachments: (config.attachments ?? []).map((attachment) => ({
      ...attachment,
      channels: ["email"],
    })),
    autoMessageRules: emailOnlyAutoMessageRules(config.autoMessageRules ?? []),
  };
}

export function MarketingConfigCard() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [rev, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);

  // Local controlled state — populated from the persisted config,
  // dirtied as the manager types. Save persists + re-locks; Cancel
  // reverts + re-locks. Same locking pattern as the agency Email
  // signature card: card opens locked showing a clean preview of
  // the saved config; "Edit configuration" unlocks the form;
  // Save / Cancel re-lock.
  const persistedRaw = agency ? api.marketing.getConfig(agency.id) : null;
  const persisted = persistedRaw ? emailOnlyMarketingConfig(persistedRaw) : null;
  const [locked, setLocked] = useState(true);
  const [draft, setDraft] = useState<MarketingConfig | null>(persisted);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [autoSetupOpen, setAutoSetupOpen] = useState(false);

  useEffect(() => {
    if (locked) setDraft(persisted ?? null);
  }, [persisted?.id, persisted?.updatedAt, rev, locked]);

  if (!agency || !user || !persisted || !draft) return null;
  const isManager = user.role === "manager";
  // Per spec, Marketing configuration is manager-only — agents
  // never see this card.
  if (!isManager) return null;

  const liveStyle = STYLES.find((s) => s.value === persisted.messageStyle);

  function startEdit() {
    setDraft(persisted);
    setSavedAt(null);
    setAutoSetupOpen(false);
    setLocked(false);
  }

  function startAutoSetup() {
    setDraft(persisted);
    setSavedAt(null);
    setAutoSetupOpen(true);
    setLocked(false);
  }

  function save() {
    if (!agency || !user || !draft) return;
    const autoRules = emailOnlyAutoMessageRules(draft.autoMessageRules ?? []);
    const newProspectAutoOn = autoRules.some(
      (rule) => rule.enabled && rule.trigger === "new_prospect"
    );
    api.marketing.updateConfig(
      agency.id,
      {
        messageStyle: draft.messageStyle,
        senderName: draft.senderName,
        signOff: draft.signOff,
        customBlurb: draft.customBlurb || undefined,
        autoSendOnNewProspect: newProspectAutoOn,
        followUpCadenceDays: draft.followUpCadenceDays,
        autoMessageRules: autoRules,
      },
      user.id
    );
    setSavedAt(new Date().toISOString());
    setLocked(true);
    setAutoSetupOpen(false);
  }

  function cancel() {
    setDraft(persisted);
    setLocked(true);
    setSavedAt(null);
    setAutoSetupOpen(false);
  }

  function setField<K extends keyof MarketingConfig>(key: K, value: MarketingConfig[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  return (
    <Card>
      <CardHeader
        title="Marketing configuration"
        subtitle={
          locked
            ? "Locked. Tap Edit configuration below to make changes. The AI applies this voice, signature, attachments, and auto-message rules to outbound messages."
            : "Editing. Save your changes to re-lock the form. The AI applies this voice, signature, attachments, and auto-message rules to outbound messages."
        }
        action={
          locked ? (
            <button type="button" className="btn-gold text-xs" onClick={startAutoSetup}>
              <Sparkles className="h-3.5 w-3.5" /> Setup AI auto-message
            </button>
          ) : (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => setAutoSetupOpen((open) => !open)}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {autoSetupOpen ? "Hide AI setup" : "Setup AI auto-message"}
            </button>
          )
        }
      />

      {locked ? (
        <LockedPreview
          config={persisted}
          agencyName={agency.name}
          styleLabel={liveStyle?.label ?? persisted.messageStyle}
        />
      ) : (
        <EditingForm
          draft={draft}
          agencyName={agency.name}
          setField={setField}
          autoSetupOpen={autoSetupOpen}
          setAutoSetupOpen={setAutoSetupOpen}
        />
      )}

      {/* Attachments — same locking applies. When the form is locked
          the manifest renders read-only (no add / remove). */}
      <div className="mt-5">
        <AttachmentManager
          attachments={persisted.attachments}
          locked={locked}
          tenantId={agency.id}
          userId={user.id}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-4 mt-4 border-t border-ink-100 flex-wrap">
        <div className="text-[11px] text-ink-500 inline-flex items-center gap-1.5">
          {savedAt ? (
            <>
              <Lock className="h-3 w-3 text-emerald-600" /> Saved — locked again. Last updated{" "}
              {fmt.relative(persisted.updatedAt)}.
            </>
          ) : locked ? (
            <>
              <Lock className="h-3 w-3" /> Locked. Last updated {fmt.relative(persisted.updatedAt)}.
            </>
          ) : (
            <>Editing — unsaved changes.</>
          )}
        </div>
        <div className="flex items-center gap-2">
          {locked ? (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={startEdit}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit configuration
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={cancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={save}
              >
                <Save className="h-3.5 w-3.5" /> Save configuration
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Locked preview — clean read-only rendering of the saved marketing
// config so a manager can see exactly what's currently in force
// without unlocking the form. Mirrors the rendered preview at the
// foot of an outbound email.
// ---------------------------------------------------------------------

function LockedPreview({
  config,
  agencyName,
  styleLabel,
}: {
  config: MarketingConfig;
  agencyName: string;
  styleLabel: string;
}) {
  const rules = config.autoMessageRules ?? [];
  const activeRules = rules.filter((rule) => rule.enabled);
  return (
    <div className="rounded-md border border-ink-200 bg-ink-50/40 p-4 space-y-4">
      <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold">
        Currently in force
      </div>
      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Voice
          </div>
          <div className="font-medium text-ink-900">{styleLabel}</div>
        </div>
        <div>
          <div className="label flex items-center gap-1.5">
            <UserCircle className="h-3 w-3" /> Sender name
          </div>
          <div className="font-medium text-ink-900">
            {config.senderName || (
              <span className="text-ink-400 italic">Not set — defaults to "{agencyName} Team".</span>
            )}
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="label flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> Sign-off
          </div>
          {config.signOff?.trim() ? (
            <div className="text-ink-800 whitespace-pre-wrap leading-snug">{config.signOff}</div>
          ) : (
            <div className="text-ink-400 italic">No sign-off set.</div>
          )}
        </div>
        {config.customBlurb?.trim() && (
          <div className="sm:col-span-2">
            <div className="label">Custom blurb (appended to every AI email)</div>
            <div className="text-ink-700 leading-snug whitespace-pre-wrap text-[13px]">
              {config.customBlurb}
            </div>
          </div>
        )}
        <div>
          <div className="label">AI auto-message rules</div>
          <div className="font-medium text-ink-900">
            {activeRules.length > 0 ? (
              <Badge tone="success">
                {activeRules.length} active
              </Badge>
            ) : (
              <Badge tone="neutral">Off</Badge>
            )}
          </div>
        </div>
        <div>
          <div className="label">Primary automation</div>
          <div className="font-medium text-ink-900">
            {activeRules[0]?.name ?? "No active automation"}
          </div>
        </div>
        {activeRules.length > 0 && (
          <div className="sm:col-span-2">
            <div className="label">Active auto-message coverage</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {activeRules.slice(0, 4).map((rule) => (
                <div key={rule.id} className="rounded-md border border-ink-100 bg-white px-3 py-2">
                  <div className="text-sm font-medium text-ink-900">{rule.name}</div>
                  <div className="mt-0.5 text-[11px] text-ink-500">
                    {labelFor(AUTO_TRIGGERS, rule.trigger)} - {rule.channels.map((c) => c.toUpperCase()).join(" + ")} - {labelFor(AUTO_APPROVALS, rule.approvalMode)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Editing form — the full set of controls, only visible while
// `locked` is false. Save re-locks; Cancel discards and re-locks.
// ---------------------------------------------------------------------

function EditingForm({
  draft,
  agencyName,
  setField,
  autoSetupOpen,
  setAutoSetupOpen,
}: {
  draft: MarketingConfig;
  agencyName: string;
  setField: <K extends keyof MarketingConfig>(key: K, value: MarketingConfig[K]) => void;
  autoSetupOpen: boolean;
  setAutoSetupOpen: (value: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Voice */}
      <section>
        <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
          <Sparkles className="h-3 w-3 inline mr-1" /> Voice
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {STYLES.map((s) => {
            const active = draft.messageStyle === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setField("messageStyle", s.value)}
                className={`text-left rounded-md border px-3 py-2 ${
                  active
                    ? "border-gold-400 bg-gold-50"
                    : "border-ink-200 bg-white hover:border-ink-300"
                }`}
              >
                <div className="text-sm font-medium flex items-center gap-2">
                  {s.label}
                  {active && <Badge tone="gold">Selected</Badge>}
                </div>
                <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{s.description}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Signature */}
      <section className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Sender name</label>
          <input
            className="input"
            value={draft.senderName}
            onChange={(e) => setField("senderName", e.target.value)}
            placeholder={`e.g., The ${agencyName} Concierge Team`}
          />
        </div>
        <div>
          <label className="label">Sign-off</label>
          <textarea
            className="input min-h-[60px]"
            value={draft.signOff}
            onChange={(e) => setField("signOff", e.target.value)}
            placeholder={"Best,\nThe Whitford Team"}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Custom blurb (optional)</label>
          <textarea
            className="input min-h-[60px]"
            value={draft.customBlurb ?? ""}
            onChange={(e) => setField("customBlurb", e.target.value)}
            placeholder="Optional paragraph appended to every AI-drafted email. Great for a regulatory disclosure or a seasonal nudge."
          />
        </div>
      </section>

      <section>
        {!autoSetupOpen ? (
          <button
            type="button"
            className="btn-outline text-sm"
            onClick={() => setAutoSetupOpen(true)}
          >
            <Sparkles className="h-4 w-4" /> Setup AI auto-message
          </button>
        ) : (
          <AutoMessageSetup
            rules={draft.autoMessageRules ?? []}
            followUpCadenceDays={draft.followUpCadenceDays}
            setFollowUpCadenceDays={(value) => setField("followUpCadenceDays", value)}
            onChange={(rules) => setField("autoMessageRules", rules)}
          />
        )}
      </section>
    </div>
  );
}

// =====================================================================
// Attachment manager — manager can add file metadata (no real
// file-storage backend in the demo) and pick which channels it
// rides on. The selected attachments are appended to every AI
// auto-sent message via the marketing API.
// =====================================================================

function AutoMessageSetup({
  rules,
  followUpCadenceDays,
  setFollowUpCadenceDays,
  onChange,
}: {
  rules: MarketingAutoMessageRule[];
  followUpCadenceDays: number;
  setFollowUpCadenceDays: (value: number) => void;
  onChange: (rules: MarketingAutoMessageRule[]) => void;
}) {
  const activeCount = rules.filter((rule) => rule.enabled).length;

  function updateRule(id: string, patch: Partial<MarketingAutoMessageRule>) {
    onChange(
      rules.map((rule) =>
        rule.id === id ? { ...rule, ...patch, updatedAt: new Date().toISOString() } : rule
      )
    );
  }

  function addRule() {
    onChange([...rules, createAutoMessageRule()]);
  }

  function addPreset(trigger: MarketingAutoMessageTrigger) {
    onChange([...rules, createAutoMessageRule(trigger)]);
  }

  function removeRule(id: string) {
    onChange(rules.filter((rule) => rule.id !== id));
  }

  function changeTrigger(rule: MarketingAutoMessageRule, trigger: MarketingAutoMessageTrigger) {
    const defaults = createAutoMessageRule(trigger);
    updateRule(rule.id, {
      name: defaults.name,
      trigger,
      messageType: defaults.messageType,
      audience: defaults.audience,
      timing: defaults.timing,
      delayAmount: defaults.delayAmount,
      delayUnit: defaults.delayUnit,
      sendTime: defaults.sendTime,
      senderMode: defaults.senderMode,
      approvalMode: defaults.approvalMode,
      prompt: defaults.prompt,
      channels: defaults.channels,
    });
  }

  function toggleChannel(rule: MarketingAutoMessageRule, channel: MessageChannel) {
    const has = rule.channels.includes(channel);
    const next = has
      ? rule.channels.filter((value) => value !== channel)
      : [...rule.channels, channel];
    updateRule(rule.id, { channels: next.length > 0 ? next : [channel] });
  }

  return (
    <div className="rounded-lg border border-gold-200 bg-gold-50/30 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-gold-800">
            <Sparkles className="mr-1 inline h-3 w-3" /> AI auto-message
          </div>
          <div className="mt-1 text-lg font-semibold text-ink-900">
            Tell the AI when to message people.
          </div>
          <div className="mt-1 max-w-2xl text-sm leading-6 text-ink-600">
            Pick a starter, adjust the basics, and save. Safety settings stay on automatically.
          </div>
        </div>
        <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-700 shadow-sm">
          {activeCount} active
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {AUTO_MESSAGE_PRESETS.map((preset) => (
          <button
            key={preset.trigger}
            type="button"
            className="rounded-md border border-ink-200 bg-white p-3 text-left shadow-sm transition hover:border-gold-400 hover:bg-white"
            onClick={() => addPreset(preset.trigger)}
          >
            <div className="text-sm font-semibold text-ink-900">{preset.label}</div>
            <div className="mt-1 text-xs leading-5 text-ink-500">{preset.description}</div>
          </button>
        ))}
      </div>

      <div className="rounded-md border border-ink-200 bg-white p-3">
        <label className="label">Default follow-up gap</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            max={30}
            className="input max-w-[90px]"
            value={followUpCadenceDays}
            onChange={(event) => setFollowUpCadenceDays(Number(event.target.value) || 3)}
          />
          <span className="text-sm text-ink-600">days between AI follow-ups when a rule uses a follow-up sequence.</span>
        </div>
      </div>

      <div className="space-y-3">
        {rules.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 bg-white p-4 text-sm text-ink-500">
            No AI auto-messages are configured. Choose one of the starter buttons above.
          </div>
        ) : (
          rules.map((rule, index) => (
            <div key={rule.id} className="rounded-md border border-ink-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-3">
                <div className="min-w-[16rem] flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Auto-message {index + 1}
                  </div>
                  <input
                    className="mt-1 w-full rounded-md border border-transparent bg-ink-50 px-3 py-2 text-base font-semibold text-ink-900 outline-none focus:border-gold-400 focus:bg-white"
                    value={rule.name}
                    onChange={(event) => updateRule(rule.id, { name: event.target.value })}
                  />
                  <div className="mt-1 text-xs text-ink-500">
                    {labelFor(AUTO_TRIGGERS, rule.trigger)} - {labelFor(AUTO_APPROVALS, rule.approvalMode)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 rounded-md border border-ink-200 px-3 py-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                  <button
                    type="button"
                    className="btn-ghost text-xs text-rose-600"
                    onClick={() => removeRule(rule.id)}
                    title="Delete this AI auto-message rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-4 sm:grid-cols-2">
                <SelectField
                  label="When this happens"
                  value={rule.trigger}
                  options={AUTO_TRIGGERS}
                  onChange={(value) => changeTrigger(rule, value as MarketingAutoMessageTrigger)}
                />
                <SelectField
                  label="Send to"
                  value={rule.audience}
                  options={AUTO_AUDIENCES}
                  onChange={(value) =>
                    updateRule(rule.id, { audience: value as MarketingAutoMessageAudience })
                  }
                />
                <SelectField
                  label="From"
                  value={rule.senderMode}
                  options={AUTO_SENDERS}
                  onChange={(value) =>
                    updateRule(rule.id, { senderMode: value as MarketingAutoMessageSenderMode })
                  }
                />
                <div>
                  <div className="label">Method</div>
                  <div className="flex gap-2">
                    {(["email"] as MessageChannel[]).map((channel) => {
                      const active = rule.channels.includes(channel);
                      return (
                        <button
                          key={channel}
                          type="button"
                          className={`h-11 flex-1 rounded-md border px-3 text-sm font-semibold ${
                            active
                              ? "border-gold-500 bg-gold-50 text-gold-900"
                              : "border-ink-200 bg-white text-ink-700"
                          }`}
                          onClick={() => toggleChannel(rule, channel)}
                          aria-pressed={active}
                        >
                          {channel.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-3 sm:grid-cols-2">
                <SelectField
                  label="Send"
                  value={rule.timing}
                  options={AUTO_TIMINGS}
                  onChange={(value) =>
                    updateRule(rule.id, { timing: value as MarketingAutoMessageTiming })
                  }
                />
                {rule.timing === "delay" ? (
                  <div className="grid grid-cols-[1fr_1fr] gap-2">
                    <div>
                      <label className="label">Wait</label>
                      <input
                        type="number"
                        min={0}
                        max={90}
                        className="input"
                        value={rule.delayAmount ?? 0}
                        onChange={(event) =>
                          updateRule(rule.id, { delayAmount: Number(event.target.value) || 0 })
                        }
                      />
                    </div>
                    <SelectField
                      label="Unit"
                      value={rule.delayUnit ?? "days"}
                      options={[
                        { value: "minutes", label: "Minutes" },
                        { value: "hours", label: "Hours" },
                        { value: "days", label: "Days" },
                      ]}
                      onChange={(value) =>
                        updateRule(rule.id, { delayUnit: value as MarketingAutoMessageDelayUnit })
                      }
                    />
                  </div>
                ) : rule.timing === "scheduled_time" ? (
                  <div>
                    <label className="label">Time</label>
                    <input
                      type="time"
                      className="input"
                      value={rule.sendTime ?? "09:00"}
                      onChange={(event) => updateRule(rule.id, { sendTime: event.target.value })}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="label">Timing</label>
                    <div className="flex h-11 items-center rounded-md border border-ink-200 bg-ink-50 px-3 text-sm text-ink-600">
                      Sends as soon as it happens
                    </div>
                  </div>
                )}
                <SelectField
                  label="Before it sends"
                  value={rule.approvalMode}
                  options={AUTO_APPROVALS}
                  onChange={(value) =>
                    updateRule(rule.id, { approvalMode: value as MarketingAutoMessageApprovalMode })
                  }
                />
              </div>

              <div className="mt-3">
                <label className="label">What should the AI say?</label>
                <textarea
                  className="input min-h-[88px]"
                  value={rule.prompt}
                  onChange={(event) => updateRule(rule.id, { prompt: event.target.value })}
                  placeholder="Tell the AI exactly what this message should accomplish, what tone to use, what to avoid, and what the next step should be."
                />
              </div>

              <details className="mt-3 rounded-md border border-ink-100 bg-ink-50/60 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-ink-600">
                  Advanced safeguards
                </summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-4 sm:grid-cols-2">
                  <div>
                    <label className="label">Quiet start</label>
                    <input
                      type="time"
                      className="input bg-white"
                      value={rule.quietHoursStart ?? "20:00"}
                      onChange={(event) =>
                        updateRule(rule.id, { quietHoursStart: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Quiet end</label>
                    <input
                      type="time"
                      className="input bg-white"
                      value={rule.quietHoursEnd ?? "08:00"}
                      onChange={(event) =>
                        updateRule(rule.id, { quietHoursEnd: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Max per contact / 30d</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      className="input bg-white"
                      value={rule.maxPerContactPer30Days}
                      onChange={(event) =>
                        updateRule(rule.id, {
                          maxPerContactPer30Days: Number(event.target.value) || 1,
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col justify-end gap-2 pb-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={rule.stopOnReply}
                        onChange={(event) => updateRule(rule.id, { stopOnReply: event.target.checked })}
                      />
                      Stop if they reply
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={rule.includeAttachments}
                        onChange={(event) =>
                          updateRule(rule.id, { includeAttachments: event.target.checked })
                        }
                      />
                      Include attachments
                    </label>
                  </div>
                </div>
              </details>
            </div>
          ))
        )}
      </div>

      <button type="button" className="btn-outline bg-white text-sm" onClick={addRule}>
        <Plus className="h-4 w-4" /> Add custom auto-message
      </button>
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function labelFor<T extends string>(options: { value: T; label: string }[], value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function AttachmentManager({
  attachments,
  locked,
  tenantId,
  userId,
}: {
  attachments: { id: string; fileName: string; fileType?: string; description?: string; channels: MessageChannel[]; addedAt: string }[];
  locked: boolean;
  tenantId: string;
  userId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [fileType, setFileType] = useState<string>("application/pdf");
  const [description, setDescription] = useState("");

  function reset() {
    setName("");
    setFileType("application/pdf");
    setDescription("");
    setAdding(false);
  }

  function add() {
    if (!name.trim()) return;
    api.marketing.addAttachment(
      tenantId,
      {
        fileName: name.trim(),
        fileType,
        description: description.trim() || undefined,
        channels: ["email"],
      },
      userId
    );
    reset();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-ink-500">
          <Paperclip className="h-3 w-3 inline mr-1" /> Attachments
        </div>
        {!locked && !adding && (
          <button className="btn-outline text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add attachment
          </button>
        )}
      </div>

      {attachments.length === 0 && !adding && (
        <div className="text-xs text-ink-500">
          No attachments configured. Add a one-pager, a policy summary PDF, or a brand image so
          every AI-sent email goes out with it.
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="divide-y divide-ink-100">
          {attachments.map((a) => (
            <li key={a.id} className="py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {a.fileType?.startsWith("image/") ? (
                  <FileImage className="h-4 w-4 text-ink-400 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-ink-400 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.fileName}</div>
                  <div className="text-[11px] text-ink-500 truncate">
                    {a.description ? `${a.description} · ` : ""}
                    Attached to: {a.channels.map((c) => c.toUpperCase()).join(", ")}
                  </div>
                </div>
              </div>
              {!locked && (
                <button
                  type="button"
                  className="btn-ghost text-xs text-rose-600"
                  onClick={() => api.marketing.removeAttachment(tenantId, a.id, userId)}
                  title="Remove from the AI's manifest"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-3 rounded-md border border-ink-200 bg-ink-50/40 p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="label">File name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="WhitfordInsurance-Welcome.pdf"
                autoFocus
              />
            </div>
            <div>
              <label className="label">File type</label>
              <select
                className="input"
                value={fileType}
                onChange={(e) => setFileType(e.target.value)}
              >
                <option value="application/pdf">PDF</option>
                <option value="image/png">PNG image</option>
                <option value="image/jpeg">JPEG image</option>
                <option value="application/msword">Word document</option>
                <option value="application/vnd.ms-excel">Spreadsheet</option>
                <option value="text/html">HTML</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description (shown to recipients in the attachment line)</label>
              <input
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Welcome packet outlining what to expect from us."
              />
            </div>
          </div>
          <div className="text-xs text-ink-500">Attached to email messages.</div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={add}
              disabled={!name.trim()}
            >
              Add to AI manifest
            </button>
            <button type="button" className="btn-outline text-xs" onClick={reset}>
              Cancel
            </button>
            <div className="text-[11px] text-ink-500 ml-auto">
              Demo only — we record metadata; in production the file uploads to the doc service.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
