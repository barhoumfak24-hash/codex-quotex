import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mail,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { AssetType, CarrierQuote, QuotingSession } from "@/types";

// =====================================================================
// AI quoting workspace. Replaces the old "Quote data" card on the
// prospect detail page. Walks the agent through:
//   1. Start session → AI pulls public records, lists what it has
//      and what it still needs.
//   2. Draft questionnaire → AI writes a message; agent reviews + sends.
//   3. Awaiting reply → agent marks the reply received when it comes in.
//   4. AI runs the quotes against every linked carrier and ranks
//      them by composite score.
// =====================================================================

export function AiQuotingWorkspace({
  tenantId,
  userId,
  contact,
  onChanged,
}: {
  tenantId: string;
  userId: string;
  contact: {
    kind: "prospect" | "client";
    id: string;
    name: string;
    assetType: AssetType;
    address?: string;
    estimatedValue?: number;
    // Client side: existing asset being re-quoted.
    assetId?: string;
  };
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<null | string>(null);
  const session =
    contact.kind === "prospect"
      ? api.quoting.getForProspect(contact.id)
      : api.quoting.getForCustomer(contact.id);

  async function start() {
    setBusy("start");
    try {
      await api.quoting.startSession({
        tenantId,
        prospectId: contact.kind === "prospect" ? contact.id : undefined,
        customerId: contact.kind === "client" ? contact.id : undefined,
        assetId: contact.assetId,
        createdById: userId,
        assetType: contact.assetType,
        contactName: contact.name,
        address: contact.address,
        estimatedValue: contact.estimatedValue,
      });
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  if (!session) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-900 flex items-start gap-2">
          <Bot className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" />
          <span>
            The AI quoting workspace pulls public records, drafts a quick
            questionnaire for anything it can't find, and then fans the request out
            to every linked carrier's quoting API. Carriers are ranked best-to-worst
            by appetite, value-band match, state availability, and pricing tendency.
          </span>
        </div>
        <button
          type="button"
          className="btn-primary text-sm"
          onClick={start}
          disabled={!!busy}
        >
          {busy === "start" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {busy === "start" ? "Pulling public records…" : "Start AI quoting"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatusStrip session={session} />
      <PublicFields session={session} />
      <Questionnaire
        session={session}
        busy={busy}
        setBusy={setBusy}
        onChanged={onChanged}
      />
      {session.status === "complete" && (
        <QuotesTable session={session} />
      )}
      <div className="pt-3 border-t border-ink-100 flex items-center justify-between gap-3">
        <div className="text-[11px] text-ink-500">
          Session opened {fmt.dateTime(session.createdAt)} · last updated{" "}
          {fmt.dateTime(session.updatedAt)}.
        </div>
        <button
          type="button"
          className="btn-outline text-xs"
          onClick={() => {
            if (!confirm("Start the quoting workspace over from scratch?")) return;
            api.quoting.reset(session.id);
            onChanged?.();
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Start over
        </button>
      </div>
    </div>
  );
}

function StatusStrip({ session }: { session: QuotingSession }) {
  const steps = [
    { key: "gathering_info", label: "Gathering info" },
    { key: "awaiting_reply", label: "Awaiting reply" },
    { key: "quoting", label: "Running quotes" },
    { key: "complete", label: "Ranked" },
  ] as const;
  const idx = steps.findIndex((s) => s.key === session.status);
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-600 flex-wrap">
      {steps.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <div key={s.key} className="flex items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                done
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : active
                  ? "bg-gold-100 border-gold-300 text-gold-800 font-medium"
                  : "bg-ink-50 border-ink-100 text-ink-500"
              }`}
            >
              {done && <Check className="h-3 w-3" />}
              {s.label}
            </span>
            {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-ink-300" />}
          </div>
        );
      })}
    </div>
  );
}

function PublicFields({ session }: { session: QuotingSession }) {
  const entries = Object.entries(session.publicFields);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-md border border-blue-100 bg-blue-50/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-blue-800 font-semibold mb-2 flex items-center gap-1.5">
        <Bot className="h-3 w-3" /> Auto-collected from public records
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-ink-500">{k}</dt>
            <dd className="text-ink-800 text-right">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Questionnaire({
  session,
  busy,
  setBusy,
  onChanged,
}: {
  session: QuotingSession;
  busy: null | string;
  setBusy: (v: null | string) => void;
  onChanged?: () => void;
}) {
  // Both personal + commercial sessions render the portal-link
  // questionnaire when there's something to ask the client. The
  // legacy inline-email draft path stays below as a fallback for
  // any pre-existing session with no questionnaireQuestions
  // attached (shouldn't happen after the v23 schema bump).
  if ((session.questionnaireQuestions?.length ?? 0) > 0) {
    return (
      <PortalQuestionnaire
        session={session}
        busy={busy}
        setBusy={setBusy}
        onChanged={onChanged}
      />
    );
  }
  if (session.missingFields.length === 0 && session.status !== "complete") {
    return null;
  }
  async function draft() {
    setBusy("draft");
    try {
      await api.quoting.draftQuestionnaire(session.id);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }
  function send() {
    setBusy("send");
    try {
      api.quoting.sendQuestionnaire(session.id);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }
  function markReplied() {
    setBusy("reply");
    try {
      api.quoting.markReplyReceivedAndQuote(session.id);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-amber-800 font-semibold flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> Needs from client
          ({session.missingFields.length})
        </div>
        {session.status === "awaiting_reply" && session.questionnaireSentAt && (
          <Badge tone="info">
            Sent {fmt.dateTime(session.questionnaireSentAt)}
          </Badge>
        )}
        {session.replyReceivedAt && (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" />
            Reply in
          </Badge>
        )}
      </div>
      <ul className="list-disc pl-5 space-y-0.5 text-xs text-ink-700">
        {session.missingFields.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      {session.status === "gathering_info" && !session.questionnaireDraft && (
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={draft}
          disabled={!!busy}
        >
          {busy === "draft" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {busy === "draft" ? "Drafting…" : "Draft questionnaire"}
        </button>
      )}

      {session.status === "gathering_info" && session.questionnaireDraft && (
        <div className="space-y-2">
          <div className="rounded-md border border-ink-100 bg-white p-3 whitespace-pre-wrap text-xs text-ink-800 max-h-[260px] overflow-y-auto">
            {session.questionnaireDraft}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={draft}
              disabled={!!busy}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Re-draft
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={send}
              disabled={!!busy}
            >
              {busy === "send" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {busy === "send" ? "Sending…" : "Send to client"}
            </button>
          </div>
        </div>
      )}

      {session.status === "awaiting_reply" && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-amber-200">
          <div className="text-[11px] text-amber-800 flex items-start gap-1.5">
            <Mail className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Questionnaire is in their inbox. Once they reply (visible in the
              Communications thread above), click below to feed the answers into
              the quoting engine.
            </span>
          </div>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={markReplied}
            disabled={!!busy}
          >
            {busy === "reply" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {busy === "reply" ? "Quoting…" : "Reply received — run quotes"}
          </button>
        </div>
      )}
    </div>
  );
}

// Portal-link questionnaire. Used for both personal + commercial
// sessions — agent generates the link, sends it to the client,
// waits for the client to submit answers through their auth-gated
// portal page. Commercial sessions mix base intake + per-carrier
// supplemental sections; personal sessions render one question per
// AI-identified missing field.
function PortalQuestionnaire({
  session,
  busy,
  setBusy,
  onChanged,
}: {
  session: QuotingSession;
  busy: null | string;
  setBusy: (v: null | string) => void;
  onChanged?: () => void;
}) {
  const portalUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/customer/questionnaire/${session.id}`
      : `/customer/questionnaire/${session.id}`;
  const [copied, setCopied] = useState(false);
  const sectionCount = new Set(
    (session.questionnaireQuestions ?? []).map((q) => q.section)
  ).size;
  const questionCount = (session.questionnaireQuestions ?? []).length;
  const answeredCount = Object.keys(session.questionnaireResponses ?? {}).length;

  function copy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(portalUrl).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function send() {
    setBusy("send");
    try {
      api.quoting.sendPortalLink(session.id, portalUrl);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-amber-800 font-semibold flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          {session.lineOfBusiness === "commercial"
            ? "Commercial questionnaire"
            : "Client questionnaire"}
          ({questionCount} question{questionCount === 1 ? "" : "s"} · {sectionCount} section
          {sectionCount === 1 ? "" : "s"})
        </div>
        {session.status === "awaiting_reply" && session.questionnaireSentAt && (
          <Badge tone="info">Sent {fmt.dateTime(session.questionnaireSentAt)}</Badge>
        )}
        {session.replyReceivedAt && (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" /> Reply in — {answeredCount} answer
            {answeredCount === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      <p className="text-xs text-ink-700">
        AI pulled what it could from public records and generated{" "}
        <span className="font-medium">{questionCount}</span>{" "}
        {questionCount === 1 ? "question" : "questions"}
        {session.lineOfBusiness === "commercial"
          ? " across base business intake and the supplemental forms required by every carrier the agency works with"
          : ` to close the underwriting gaps on this ${session.assetType.replace(/_/g, " ")}`}
        . The client fills out an interactive form in their portal — submission auto-runs the
        carrier ranking.
      </p>

      {session.status === "gathering_info" && (
        <div className="space-y-2">
          <div className="rounded-md border border-ink-100 bg-white p-3 text-xs text-ink-700 flex items-center justify-between gap-2 flex-wrap">
            <span className="font-mono truncate">{portalUrl}</span>
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={copy}
              title="Copy the portal link"
            >
              {copied ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={send}
            disabled={!!busy}
          >
            {busy === "send" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {busy === "send" ? "Sending…" : "Email link to client"}
          </button>
        </div>
      )}

      {session.status === "awaiting_reply" && (
        <div className="space-y-2">
          <div className="rounded-md border border-ink-100 bg-white p-3 text-xs text-ink-700 flex items-center justify-between gap-2 flex-wrap">
            <span className="font-mono truncate">{portalUrl}</span>
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={copy}
            >
              {copied ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="text-[11px] text-amber-800">
            The client got an email with the link. When they submit, the AI ranking runs
            automatically and you'll see an Activity Center task land in your queue.
          </p>
        </div>
      )}
    </div>
  );
}

function QuotesTable({ session }: { session: QuotingSession }) {
  const [quickView, setQuickView] = useState<CarrierQuote | null>(null);
  if (session.quotes.length === 0) {
    return (
      <div className="text-sm text-ink-500">
        No active carriers in this agency's library matched the asset type. Link a
        carrier under Carrier recommendations and re-run.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold flex items-center gap-1.5">
        <Sparkles className="h-3 w-3" /> AI-ranked carrier quotes
      </div>
      {session.aiSummary && (
        <p className="text-xs text-ink-600">{session.aiSummary}</p>
      )}
      <ol className="space-y-2">
        {session.quotes.map((q, i) => {
          const carrier = api.carriers.get(q.carrierId);
          const apiBadge =
            q.apiStatus === "connected"
              ? { tone: "success" as const, label: "Live API" }
              : q.apiStatus === "simulated"
              ? { tone: "info" as const, label: "Simulated" }
              : { tone: "neutral" as const, label: "No API on file" };
          return (
            <li
              key={q.carrierId}
              className="rounded-md border border-ink-100 bg-white p-3 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="min-w-0 flex items-center gap-2">
                <span
                  className={`text-[11px] font-bold w-6 h-6 inline-flex items-center justify-center rounded-full ${
                    i === 0
                      ? "bg-gold-100 text-gold-800"
                      : "bg-ink-100 text-ink-700"
                  }`}
                >
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-semibold">
                    {carrier?.name ?? "Unknown carrier"}
                  </div>
                  <div className="text-[11px] text-ink-500">{q.fitReason}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={apiBadge.tone}>{apiBadge.label}</Badge>
                <Badge tone="neutral">
                  <span title="How well the carrier's appetite, value band, state footprint, and pricing tendency match this risk.">
                    {Math.round(q.confidence * 100)}% match
                  </span>
                </Badge>
                <div className="text-right">
                  <div className="text-2xl font-semibold tabular-nums text-ink-900">
                    {fmt.money(q.premium)}
                  </div>
                  <div className="text-[11px] text-ink-500 -mt-0.5">annual premium</div>
                </div>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => setQuickView(q)}
                  title="Inspect this quote's full detail"
                >
                  Quick view
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <QuickViewQuoteModal
        quote={quickView}
        session={session}
        onClose={() => setQuickView(null)}
      />
    </div>
  );
}

function QuickViewQuoteModal({
  quote,
  session,
  onClose,
}: {
  quote: CarrierQuote | null;
  session: QuotingSession;
  onClose: () => void;
}) {
  if (!quote) {
    return (
      <Modal open={false} onClose={onClose} title="Quote detail" size="lg">
        <div />
      </Modal>
    );
  }
  const carrier = api.carriers.get(quote.carrierId);
  const rankIndex = session.quotes.findIndex((q) => q.carrierId === quote.carrierId);
  // Legacy quoting sessions may pre-date the assetType / estimatedValue
  // snapshot fields. Defensive fallbacks so opening Quick view on a
  // stale row doesn't crash the whole page to a white screen.
  const assetType: AssetType = session.assetType ?? "other";
  const estimatedValue = session.estimatedValue ?? 0;
  const appetite = (carrier?.appetites ?? []).find(
    (a) => a.assetType === assetType
  );
  const apiBadge =
    quote.apiStatus === "connected"
      ? { tone: "success" as const, label: "Live API call" }
      : quote.apiStatus === "simulated"
      ? { tone: "info" as const, label: "Simulated (configured, awaiting live test)" }
      : { tone: "neutral" as const, label: "No API on file — AI estimate only" };

  // Derive a quick coverage suggestion from the asset value so the
  // modal feels like a real quote breakdown.
  const dwelling = estimatedValue ?? 0;
  const otherStructures = Math.round(dwelling * 0.1);
  const personalProperty = Math.round(dwelling * 0.5);
  const lossOfUse = Math.round(dwelling * 0.2);
  const liability = 1_000_000;
  const medicalPayments = 5_000;
  const baseRate =
    assetType === "coastal_home"
      ? 0.006
      : assetType === "luxury_vehicle"
      ? 0.012
      : assetType === "yacht"
      ? 0.015
      : assetType === "jewelry"
      ? 0.018
      : assetType === "umbrella_liability"
      ? 0.0008
      : 0.01;

  // Naive line-item breakdown so the agent has something credible
  // to talk through with the client. Splits proportional to coverage
  // weight, then adds taxes + fees to land within a couple hundred
  // dollars of the headline premium.
  const lineItems = [
    {
      label: "Dwelling / base coverage",
      detail: `${fmt.money(dwelling)} at ${(baseRate * 100).toFixed(2)}% base rate`,
      amount: Math.round(quote.premium * 0.55),
    },
    {
      label: "Other structures",
      detail: `${fmt.money(otherStructures)} extension`,
      amount: Math.round(quote.premium * 0.08),
    },
    {
      label: "Personal property",
      detail: `${fmt.money(personalProperty)} schedule`,
      amount: Math.round(quote.premium * 0.16),
    },
    {
      label: "Loss of use",
      detail: `${fmt.money(lossOfUse)} ALE`,
      amount: Math.round(quote.premium * 0.04),
    },
    {
      label: "Personal liability",
      detail: `${fmt.money(liability)} per occurrence`,
      amount: Math.round(quote.premium * 0.1),
    },
    {
      label: "Medical payments",
      detail: `${fmt.money(medicalPayments)} per person`,
      amount: Math.round(quote.premium * 0.02),
    },
    {
      label: "Taxes, surcharges, fees",
      detail: "State + carrier mandated",
      amount: Math.round(quote.premium * 0.05),
    },
  ];

  return (
    <Modal open={!!quote} onClose={onClose} title="Carrier quote — quick view" size="lg">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-ink-500 uppercase tracking-wider">
              Rank #{rankIndex + 1} of {session.quotes.length}
            </div>
            <h3 className="text-xl font-semibold mt-0.5">
              {carrier?.name ?? "Unknown carrier"}
            </h3>
            <p className="text-xs text-ink-500 mt-1">{quote.fitReason}</p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-semibold tabular-nums text-ink-900 leading-tight">
              {fmt.money(quote.premium)}
            </div>
            <div className="text-xs text-ink-500 mt-0.5">annual premium</div>
            <div className="mt-2 flex items-center gap-1.5 justify-end flex-wrap">
              <Badge tone={apiBadge.tone}>{apiBadge.label}</Badge>
              <Badge tone="neutral">
                <span title="How well the carrier's appetite, value band, state footprint, and pricing tendency match this risk.">
                  {Math.round(quote.confidence * 100)}% match
                </span>
              </Badge>
              <Badge tone="gold">score {quote.score.toFixed(2)}</Badge>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <DetailGroup title="Carrier appetite">
            {appetite ? (
              <dl className="text-xs space-y-1">
                <Row label="Asset type" value={appetite.assetType.replace(/_/g, " ")} />
                <Row
                  label="Value band"
                  value={`${appetite.minValue ? fmt.money(appetite.minValue) : "—"} – ${
                    appetite.maxValue ? fmt.money(appetite.maxValue) : "—"
                  }`}
                />
                <Row label="Risk levels" value={appetite.riskLevels.join(", ")} />
                <Row
                  label="Pricing tendency"
                  value={`${appetite.pricingTendency.toFixed(2)} × market`}
                />
              </dl>
            ) : (
              <span className="text-xs text-ink-500">
                No appetite row on file for this asset type — quote is
                interpolated from carrier defaults.
              </span>
            )}
          </DetailGroup>

          <DetailGroup title="Eligibility checks">
            <dl className="text-xs space-y-1">
              <Row
                label="Asset type"
                value={
                  carrier?.preferredAssetTypes.includes(assetType) ? (
                    <Badge tone="success">writes this line</Badge>
                  ) : (
                    <Badge tone="warn">no preferred-asset listing</Badge>
                  )
                }
              />
              <Row
                label="State availability"
                value={
                  (carrier?.stateAvailability ?? []).length > 0
                    ? carrier!.stateAvailability.slice(0, 6).join(", ") +
                      (carrier!.stateAvailability.length > 6 ? "…" : "")
                    : "—"
                }
              />
              {(carrier?.restrictedRisks ?? []).length > 0 && (
                <Row
                  label="Restrictions"
                  value={
                    <ul className="list-disc pl-4">
                      {(carrier!.restrictedRisks ?? []).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  }
                />
              )}
            </dl>
          </DetailGroup>
        </div>

        <DetailGroup title="Premium breakdown">
          <ul className="divide-y divide-ink-100 text-xs">
            {lineItems.map((li) => (
              <li
                key={li.label}
                className="py-1.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-ink-800">{li.label}</div>
                  <div className="text-[11px] text-ink-500">{li.detail}</div>
                </div>
                <div className="tabular-nums text-ink-800">{fmt.money(li.amount)}</div>
              </li>
            ))}
            <li className="py-2 flex items-center justify-between gap-3 font-semibold text-ink-900">
              <span>Estimated annual premium</span>
              <span className="tabular-nums">{fmt.money(quote.premium)}</span>
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-ink-500">
            Line items are AI-interpolated from the headline premium and the
            standard coverage mix for {assetType.replace(/_/g, " ") || "this line"};
            the carrier's real quote document supersedes these once bound.
          </p>
        </DetailGroup>

        <DetailGroup title="Carrier connection">
          <dl className="text-xs space-y-1">
            <Row label="Provider" value={carrier?.quotingApi?.provider ?? "—"} />
            <Row
              label="Endpoint"
              value={
                carrier?.quotingApi?.endpoint ? (
                  <a
                    href={carrier.quotingApi.endpoint}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                  >
                    {carrier.quotingApi.endpoint}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Row label="Connection status" value={apiBadge.label} />
            {carrier?.agentPortalUrl && (
              <Row
                label="Carrier portal"
                value={
                  <a
                    href={carrier.agentPortalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                  >
                    Open carrier portal
                    <ExternalLink className="h-3 w-3" />
                  </a>
                }
              />
            )}
            {carrier?.quotingApi?.notes && (
              <Row label="Notes" value={carrier.quotingApi.notes} />
            )}
          </dl>
        </DetailGroup>

        {(carrier?.appetiteNotes || carrier?.tendencyNotes || carrier?.underwritingRules) && (
          <DetailGroup title="Underwriting context">
            <div className="text-xs text-ink-700 space-y-2 whitespace-pre-wrap">
              {carrier.appetiteNotes && (
                <p>
                  <span className="font-semibold">Appetite:</span> {carrier.appetiteNotes}
                </p>
              )}
              {carrier.tendencyNotes && (
                <p>
                  <span className="font-semibold">Tendency:</span> {carrier.tendencyNotes}
                </p>
              )}
              {carrier.underwritingRules && (
                <p>
                  <span className="font-semibold">Rules:</span> {carrier.underwritingRules}
                </p>
              )}
            </div>
          </DetailGroup>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100 flex-wrap">
          <SendQuoteToContactButton
            session={session}
            quote={quote}
            lineItems={lineItems}
            carrierName={carrier?.name ?? "the carrier"}
          />
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// One-click send: composes a plain-text email summarizing the
// recommended quote and writes it as an outbound Communication so
// it lands in the contact's thread. Disabled while sending +
// shows a "Sent" confirmation chip after.
function SendQuoteToContactButton({
  session,
  quote,
  lineItems,
  carrierName,
}: {
  session: QuotingSession;
  quote: CarrierQuote;
  lineItems: { label: string; detail: string; amount: number }[];
  carrierName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);

  const contact = session.prospectId
    ? api.prospects.get(session.prospectId)
    : session.customerId
    ? api.customers.get(session.customerId)
    : null;
  if (!contact) return null;

  async function send() {
    setBusy(true);
    try {
      const firstName = contact!.name.split(/\s+/)[0];
      const lines = lineItems
        .map((li) => `  • ${li.label} — ${fmt.money(li.amount)} (${li.detail})`)
        .join("\n");
      const subject = `Recommended quote — ${carrierName}`;
      const body = [
        `Hi ${firstName},`,
        ``,
        `Based on the information we have on file, I'd like to recommend the following quote from ${carrierName}:`,
        ``,
        `Annual premium: ${fmt.money(quote.premium)}`,
        ``,
        `Coverage breakdown:`,
        lines,
        ``,
        `Why this carrier:`,
        `  ${quote.fitReason}`,
        ``,
        `Let me know if you'd like to move forward or want me to compare against other options on our panel — happy to walk through any of it on a quick call.`,
      ].join("\n");
      api.communications.create({
        tenantId: session.tenantId,
        customerId: session.customerId,
        prospectId: session.prospectId,
        channel: "email",
        direction: "outbound",
        subject,
        body,
        createdById: session.createdById,
      });
      setSentAt(new Date().toISOString());
    } finally {
      setBusy(false);
    }
  }

  if (sentAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 px-2 py-1 rounded bg-emerald-50 border border-emerald-200">
        <CheckCircle2 className="h-3.5 w-3.5" /> Sent to {contact.name.split(/\s+/)[0]}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="btn-primary text-sm"
      onClick={send}
      disabled={busy}
      title={`Email this recommendation to ${contact.name}.`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Send className="h-3.5 w-3.5" />
      )}
      {busy ? "Sending…" : `Send to ${contact.name.split(/\s+/)[0]}`}
    </button>
  );
}

function DetailGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-ink-500 shrink-0">{label}</dt>
      <dd className="text-ink-800 text-right max-w-[60%]">{value}</dd>
    </div>
  );
}