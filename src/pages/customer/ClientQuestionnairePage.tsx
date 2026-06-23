import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardList, Loader2, Send, Sparkles } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import { getAppSurface, toAppRoute, toSurfaceRoute } from "@/lib/appSurface";
import type { QuestionnaireResponseMeta, QuotingQuestion, QuotingSession } from "@/types";

// =====================================================================
// Customer portal — commercial quoting questionnaire. Auth-gated;
// the client signs in to their portal, the questionnaire matches
// against their customerId on the QuotingSession.
//
// Rendered as a quiz-style multi-section form. On submit:
//   • Answers persist back to the QuotingSession
//   • Status flips from gathering_info → quoting (AI runs ranking)
//   • An Activity Center task lands in the agent's queue
// =====================================================================

function visibleQuestionnaireQuestions(session: QuotingSession): QuotingQuestion[] {
  const questions = session.questionnaireQuestions ?? [];
  if (session.lineOfBusiness !== "commercial") return questions;
  if (session.commercialSecondRoundSentAt && !session.commercialSupplementalsCompletedAt) {
    return questions.filter((q) => q.round === "second_round");
  }
  if (!session.commercialApplicationSentAt) {
    return questions.filter((q) => !q.carrierId && q.round !== "second_round");
  }
  return questions.filter((q) => q.round === "second_round");
}

function questionnaireEditorLabel(meta: QuestionnaireResponseMeta): string {
  const role =
    meta.updatedByRole === "customer"
      ? "customer"
      : meta.updatedByRole === "manager"
      ? "manager"
      : meta.updatedByRole === "ai"
      ? "AI"
      : "agent";
  return `${meta.updatedByName} (${role})`;
}

function QuestionEditMeta({ meta }: { meta?: QuestionnaireResponseMeta }) {
  if (!meta) {
    return <div className="mt-1 text-[11px] text-ink-400">Shared field - not edited yet.</div>;
  }
  return (
    <div className="mt-1 text-[11px] text-ink-500">
      Last edited by {questionnaireEditorLabel(meta)} - {fmt.dateTime(meta.updatedAt)}
    </div>
  );
}

export function ClientQuestionnairePage() {
  const { sessionId } = useParams();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const isAppSurface = getAppSurface() === "agencyApp";
  const appRoute = (path: string) =>
    isAppSurface ? toAppRoute(path) : toSurfaceRoute(path, pathname);
  const [, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [incompleteWarningOpen, setIncompleteWarningOpen] = useState(false);
  const [incompleteFieldsRevealed, setIncompleteFieldsRevealed] = useState(false);
  const session = sessionId ? api.quoting.get(sessionId) : undefined;
  const myCustomer =
    session?.customerId && user
      ? api.customers.list(session.tenantId).find((c) => c.userId === user.id)
      : undefined;
  const questions: QuotingQuestion[] = session ? visibleQuestionnaireQuestions(session) : [];
  const sections = useMemo(() => {
    const map = new Map<string, QuotingQuestion[]>();
    for (const q of questions) {
      const bucket = map.get(q.section) ?? [];
      bucket.push(q);
      map.set(q.section, bucket);
    }
    return Array.from(map.entries());
  }, [questions]);
  const actor =
    user && myCustomer
      ? { id: user.id, name: myCustomer.name, role: "customer" as const }
      : undefined;
  const lastEdit = Object.values(session?.questionnaireResponseMeta ?? {}).sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1
  )[0];

  // Pre-seed responses from any prior partial submission so the
  // client can pick back up where they left off. Because the
  // questionnaire is shared with the agency team, this also refreshes
  // when an agent updates answers from their side.
  useEffect(() => {
    if (!session) return;
    setResponses(session.questionnaireResponses ?? {});
  }, [session?.id, session?.updatedAt]);

  useEffect(() => {
    setIncompleteWarningOpen(false);
    setIncompleteFieldsRevealed(false);
  }, [session?.id]);

  if (!sessionId || !user) {
    return <EmptyState title="Questionnaire link is invalid or expired." />;
  }
  // The client portal only ever lets the signed-in customer see
  // sessions tied to their own customerId (defense-in-depth).
  if (!session || !session.customerId) {
    return <EmptyState title="Questionnaire not found." />;
  }
  if (!myCustomer || myCustomer.id !== session.customerId) {
    return (
      <EmptyState title="This questionnaire isn't tied to your account. Reach out to your agent if you got the link in error." />
    );
  }

  if (session.status !== "gathering_info" && session.status !== "awaiting_reply" && !submitted) {
    // Session already past the questionnaire phase — surface a
    // "we got your answers" state.
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Questionnaire already submitted"
            subtitle="Your agent is reviewing the answers and will reach out with carrier options shortly."
          />
          <Link to={appRoute("/customer")} className="btn-outline text-sm inline-flex">
            <ArrowLeft className="h-4 w-4" />
            Back to your portal
          </Link>
        </Card>
      </div>
    );
  }

  const required = questions.filter((q) => q.required);
  const missing = required.filter((q) => !(responses[q.id] ?? "").trim());
  const missingQuestionIds = new Set(missing.map((question) => question.id));
  const isCommercialIncomplete = session.lineOfBusiness === "commercial" && missing.length > 0;
  const showMissingFieldHighlights = missing.length > 0;
  const showIncompleteFieldWarnings = incompleteFieldsRevealed && isCommercialIncomplete;

  function setAnswer(id: string, value: string) {
    setResponses((s) => ({ ...s, [id]: value }));
    if (actor && session) {
      api.quoting.saveQuestionnaireResponses(session.id, { [id]: value }, actor);
    }
  }

  function submitNow() {
    if (!actor || !session) return;
    setSubmitting(true);
    try {
      api.quoting.submitQuestionnaireResponses(session.id, responses, actor);
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  function submit() {
    if (!actor || !session) return;
    if (missing.length > 0) {
      if (session.lineOfBusiness === "commercial") {
        setIncompleteFieldsRevealed(true);
        setIncompleteWarningOpen(true);
      }
      return;
    }
    submitNow();
  }

  if (submitted) {
    return (
      <Card>
        <CardHeader
          title="Thank you — your answers are in."
          subtitle="Your agent will get a notification and reach out with carrier options shortly."
        />
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Submitted — you can close this tab.
        </div>
        <div className="mt-4">
          <Link to={appRoute("/customer")} className="btn-outline text-sm inline-flex">
            <ArrowLeft className="h-4 w-4" />
            Back to your portal
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Quoting questionnaire</h1>
        <p className="text-ink-500 text-sm mt-1">
          A few questions from your agent so they can run firm quotes with our carriers. We've
          pre-filled what we could from public records — please confirm or fill in the rest.
        </p>
      </div>

      <Card>
        <div className="rounded-md border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-900 flex items-start gap-2">
          <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" />
          <span>
            {questions.length} question{questions.length === 1 ? "" : "s"} across{" "}
            {sections.length} section{sections.length === 1 ? "" : "s"}. Required questions are
            marked with an asterisk. This is a shared draft with your agency team, so saved
            answers update for both sides.
          </span>
        </div>
        {lastEdit && (
          <div className="mt-2 text-[11px] text-ink-500">
            Last questionnaire edit by {questionnaireEditorLabel(lastEdit)} -{" "}
            {fmt.dateTime(lastEdit.updatedAt)}.
          </div>
        )}
        {showIncompleteFieldWarnings && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Some required commercial fields are still blank.
            </div>
            <p className="mt-1">
              You can still submit after confirming. Missing fields are highlighted below so you can
              complete them first if you want.
            </p>
          </div>
        )}
      </Card>

      {sections.map(([sectionName, sectionQuestions], idx) => (
        <Card key={sectionName}>
          <CardHeader
            title={sectionName}
            subtitle={
              session.lineOfBusiness === "commercial" && session.commercialSecondRoundSentAt
                ? "Carrier-specific supplemental information requested after carrier review."
                : session.lineOfBusiness === "commercial"
                ? "Shared business intake used once across carrier submissions."
                : idx === 0
                ? "Baseline information our carriers need to evaluate the risk."
                : "Additional information this carrier requires on their supplemental form."
            }
          />
          <div className="space-y-4">
            {sectionQuestions.map((q) => {
              const isMissing = showMissingFieldHighlights && missingQuestionIds.has(q.id);
              const fieldClass = `input text-sm ${
                isMissing ? "border-amber-400 bg-amber-50 focus:border-amber-500 focus:ring-amber-200" : ""
              }`;
              return (
              <div
                key={q.id}
                className={
                  isMissing
                    ? "rounded-md border border-amber-300 bg-amber-50/70 p-3"
                    : undefined
                }
              >
                <label className="label">
                  {q.label}
                  {q.required && <span className="text-rose-600 ml-1">*</span>}
                </label>
                {q.kind === "textarea" ? (
                  <textarea
                    className={`${fieldClass} min-h-[80px]`}
                    value={responses[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                ) : q.kind === "select" ? (
                  <select
                    className={fieldClass}
                    value={responses[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  >
                    <option value="">— Pick one —</option>
                    {(q.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : q.kind === "number" ? (
                  <input
                    type="number"
                    className={fieldClass}
                    value={responses[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                ) : (
                  <input
                    className={fieldClass}
                    value={responses[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                )}
                {isMissing && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-900">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Missing required field. You can still submit after confirming the warning.
                  </div>
                )}
                <QuestionEditMeta meta={session.questionnaireResponseMeta?.[q.id]} />
              </div>
              );
            })}
          </div>
        </Card>
      ))}

      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-ink-500 flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />
            {missing.length === 0 ? (
              <Badge tone="success">All required questions answered</Badge>
            ) : session.lineOfBusiness === "commercial" ? (
              <Badge tone="warn">
                {missing.length} required question{missing.length === 1 ? "" : "s"} still blank
              </Badge>
            ) : (
              <Badge tone="warn">
                {missing.length} required question{missing.length === 1 ? "" : "s"} still need
                an answer
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={() => nav(appRoute("/customer"))}
            >
              Save &amp; finish later
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={submit}
              disabled={submitting || (session.lineOfBusiness !== "commercial" && missing.length > 0)}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {submitting
                ? "Submitting…"
                : "Submit answers"}
            </button>
          </div>
        </div>
      </Card>
      <IncompleteCommercialQuestionnaireModal
        open={incompleteWarningOpen}
        title={
          session.commercialApplicationSentAt
            ? "Submit incomplete supplemental?"
            : "Submit incomplete questionnaire?"
        }
        missingQuestions={missing}
        onBack={() => setIncompleteWarningOpen(false)}
        onProceed={() => {
          setIncompleteWarningOpen(false);
          submitNow();
        }}
      />
    </div>
  );
}

function IncompleteCommercialQuestionnaireModal({
  open,
  title,
  missingQuestions,
  onBack,
  onProceed,
}: {
  open: boolean;
  title: string;
  missingQuestions: QuotingQuestion[];
  onBack: () => void;
  onProceed: () => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, QuotingQuestion[]>();
    missingQuestions.forEach((question) => {
      const bucket = map.get(question.section) ?? [];
      bucket.push(question);
      map.set(question.section, bucket);
    });
    return Array.from(map.entries());
  }, [missingQuestions]);

  return (
    <Modal open={open} onClose={onBack} title={title} size="lg" closeIcon="back">
      <div className="space-y-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-950">
          <div className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Some required fields are still blank. Are you sure you want to proceed?
            </span>
          </div>
          <p className="mt-2 text-xs leading-5">
            Quotex will still move this commercial submission forward, but carriers may come back
            with follow-up questions for the missing information.
          </p>
        </div>

        <div className="max-h-[280px] space-y-3 overflow-y-auto pr-1">
          {grouped.map(([section, questions]) => (
            <div key={section} className="rounded-md border border-ink-100 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                {section}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-800">
                {questions.map((question) => (
                  <li key={question.id}>{question.label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <button type="button" className="btn-outline text-sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Go back and fill fields
          </button>
          <button type="button" className="btn-primary text-sm" onClick={onProceed}>
            <Send className="h-3.5 w-3.5" />
            Proceed anyway
          </button>
        </div>
      </div>
    </Modal>
  );
}
