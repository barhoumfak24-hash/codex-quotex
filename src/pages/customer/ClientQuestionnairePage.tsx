import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, ClipboardList, Loader2, Send, Sparkles } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import type { QuotingQuestion } from "@/types";

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

export function ClientQuestionnairePage() {
  const { sessionId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!sessionId || !user) {
    return <EmptyState title="Questionnaire link is invalid or expired." />;
  }
  const session = api.quoting.get(sessionId);
  // The client portal only ever lets the signed-in customer see
  // sessions tied to their own customerId (defense-in-depth).
  if (!session || !session.customerId) {
    return <EmptyState title="Questionnaire not found." />;
  }
  const myCustomer = api.customers.list(session.tenantId).find((c) => c.userId === user.id);
  if (!myCustomer || myCustomer.id !== session.customerId) {
    return (
      <EmptyState title="This questionnaire isn't tied to your account. Reach out to your agent if you got the link in error." />
    );
  }

  const questions: QuotingQuestion[] = session.questionnaireQuestions ?? [];
  const sections = useMemo(() => {
    const map = new Map<string, QuotingQuestion[]>();
    for (const q of questions) {
      const bucket = map.get(q.section) ?? [];
      bucket.push(q);
      map.set(q.section, bucket);
    }
    return Array.from(map.entries());
  }, [questions]);

  // Pre-seed responses from any prior partial submission so the
  // client can pick back up where they left off.
  useEffect(() => {
    if (session.questionnaireResponses) {
      setResponses(session.questionnaireResponses);
    }
  }, [session.id]);

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
          <Link to="/customer" className="btn-outline text-sm inline-flex">
            Back to your portal
          </Link>
        </Card>
      </div>
    );
  }

  const required = questions.filter((q) => q.required);
  const missing = required.filter((q) => !(responses[q.id] ?? "").trim());

  function setAnswer(id: string, value: string) {
    setResponses((s) => ({ ...s, [id]: value }));
  }

  function submit() {
    if (missing.length > 0) return;
    setSubmitting(true);
    try {
      api.quoting.submitQuestionnaireResponses(session!.id, responses);
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
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
          <Link to="/customer" className="btn-outline text-sm inline-flex">
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
            marked with an asterisk.
          </span>
        </div>
      </Card>

      {sections.map(([sectionName, sectionQuestions], idx) => (
        <Card key={sectionName}>
          <CardHeader
            title={sectionName}
            subtitle={
              idx === 0
                ? "Baseline information our carriers need to evaluate the risk."
                : "Additional information this carrier requires on their supplemental form."
            }
          />
          <div className="space-y-4">
            {sectionQuestions.map((q) => (
              <div key={q.id}>
                <label className="label">
                  {q.label}
                  {q.required && <span className="text-rose-600 ml-1">*</span>}
                </label>
                {q.kind === "textarea" ? (
                  <textarea
                    className="input text-sm min-h-[80px]"
                    value={responses[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                ) : q.kind === "select" ? (
                  <select
                    className="input text-sm"
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
                    className="input text-sm"
                    value={responses[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                ) : (
                  <input
                    className="input text-sm"
                    value={responses[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-ink-500 flex items-center gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />
            {missing.length === 0 ? (
              <Badge tone="success">All required questions answered</Badge>
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
              onClick={() => nav("/customer")}
            >
              Save &amp; finish later
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={submit}
              disabled={submitting || missing.length > 0}
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {submitting ? "Submitting…" : "Submit answers"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}