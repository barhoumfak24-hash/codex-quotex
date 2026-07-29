import type { QuotingSession } from "@/types";

type CommercialCarrierSubmission = NonNullable<
  QuotingSession["commercialCarrierSubmissions"]
>[number];

const COMMERCIAL_REPLY_STATUSES = new Set<CommercialCarrierSubmission["status"]>([
  "accepted",
  "declined",
  "needs_supplemental",
  "supplemental_sent",
  "needs_client_info",
  "agent_review",
]);

export function commercialCarrierSubmissionHasReply(
  submission: CommercialCarrierSubmission
): boolean {
  return (
    Boolean(submission.responseAt) ||
    (submission.replyCommunicationIds?.length ?? 0) > 0 ||
    COMMERCIAL_REPLY_STATUSES.has(submission.status)
  );
}

export function allCommercialCarrierSubmissionsHaveReplies(
  session: Pick<QuotingSession, "commercialCarrierSubmissions">
): boolean {
  const submissions = session.commercialCarrierSubmissions ?? [];
  return submissions.length > 0 && submissions.every(commercialCarrierSubmissionHasReply);
}

export type QuotingWorkflowTone = "neutral" | "info" | "success" | "warn" | "error" | "gold";

export interface QuotingWorkflowSummary {
  stage: string;
  tone: QuotingWorkflowTone;
  detail: string;
  blocker: string;
  progress: number;
  currentStep?: number;
  totalSteps?: number;
  acceptedCount: number;
  waitingCount: number;
  quoteCount: number;
  implemented: boolean;
  isClosed: boolean;
  sortPriority: number;
}

function workflowStepProgress(currentStep: number, totalSteps: number): number {
  return Math.round((currentStep / totalSteps) * 100);
}

function workflowActiveStepProgress(currentStep: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  const completedSteps = Math.max(0, Math.min(totalSteps, currentStep - 1));
  return workflowStepProgress(completedSteps, totalSteps);
}

export function quotingWorkflowContactKey(
  session: Pick<QuotingSession, "id" | "customerId" | "prospectId">
): string {
  if (session.customerId) return `customer:${session.customerId}`;
  if (session.prospectId) return `prospect:${session.prospectId}`;
  return `session:${session.id}`;
}

export function isQuotingWorkflowOpen(session: QuotingSession): boolean {
  if (session.status === "voided") return false;
  return !session.quotes.some((quote) => !!quote.implementation?.policyId);
}

export function isDocumentOnlyAcordSession(session: QuotingSession): boolean {
  return (
    session.lineOfBusiness === "commercial" &&
    session.aiSummary === "ACORD documents initialized from the client Documents card."
  );
}

export function newestOpenQuotingSessionsPerContact(
  sessions: QuotingSession[]
): QuotingSession[] {
  const seen = new Set<string>();
  return [...sessions]
    .filter((session) => !isDocumentOnlyAcordSession(session) && isQuotingWorkflowOpen(session))
    .sort((a, b) => {
      const aStamp = a.updatedAt || a.createdAt;
      const bStamp = b.updatedAt || b.createdAt;
      return aStamp < bStamp ? 1 : aStamp > bStamp ? -1 : 0;
    })
    .filter((session) => {
      const key = quotingWorkflowContactKey(session);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function summarizeQuotingWorkflow(session: QuotingSession): QuotingWorkflowSummary {
  const submissions = session.commercialCarrierSubmissions ?? [];
  const acceptedCount = submissions.filter(
    (submission) => submission.status === "accepted" || submission.status === "supplemental_sent"
  ).length;
  const repliedCount = submissions.filter(commercialCarrierSubmissionHasReply).length;
  const allCarrierRepliesReceived = allCommercialCarrierSubmissionsHaveReplies(session);
  const waitingCount = submissions.filter(
    (submission) => submission.status === "needs_client_info"
  ).length;
  const quoteCount = session.quotes.length;
  const implemented = session.quotes.some((quote) => !!quote.implementation?.policyId);
  const line = session.lineOfBusiness === "commercial" ? "commercial" : "personal";
  const totalSteps = session.lineOfBusiness === "commercial" ? 6 : 4;

  if (implemented) {
    return {
      stage: "Policy implemented",
      tone: "success",
      detail: "Quote workflow finished and policy/billing records were created.",
      blocker: "No blocker",
      progress: workflowStepProgress(totalSteps, totalSteps),
      currentStep: totalSteps,
      totalSteps,
      acceptedCount,
      waitingCount,
      quoteCount,
      implemented,
      isClosed: true,
      sortPriority: 90,
    };
  }

  if (
    session.lineOfBusiness === "commercial" &&
    session.status === "awaiting_reply" &&
    session.commercialSecondRoundSentAt
  ) {
    return {
      stage: acceptedCount > 0 ? "Accepted ranking live" : "Missing-info round",
      tone: acceptedCount > 0 ? "gold" : "warn",
      detail:
        acceptedCount > 0
          ? `${acceptedCount} accepted market${acceptedCount === 1 ? "" : "s"} ranked while supplementals continue.`
          : "Second-round carrier supplemental questions are waiting on the client.",
      blocker:
        waitingCount > 0
          ? `${waitingCount} carrier${waitingCount === 1 ? "" : "s"} waiting on supplemental info.`
          : "Waiting on second-round client answers.",
      progress: workflowActiveStepProgress(5, totalSteps),
      currentStep: 5,
      totalSteps,
      acceptedCount,
      waitingCount,
      quoteCount,
      implemented,
      isClosed: false,
      sortPriority: 10,
    };
  }

  if (session.status === "complete") {
    if (session.lineOfBusiness === "commercial" && !allCarrierRepliesReceived) {
      const remainingCount = Math.max(0, submissions.length - repliedCount);

      return {
        stage: "Awaiting carrier replies",
        tone: "info",
        detail:
          submissions.length > 0
            ? `${repliedCount} of ${submissions.length} carrier repl${
                submissions.length === 1 ? "y" : "ies"
              } received.`
            : "Carrier submissions have not been recorded yet.",
        blocker:
          remainingCount > 0
            ? `${remainingCount} carrier repl${remainingCount === 1 ? "y" : "ies"} still outstanding.`
            : "Waiting for carrier submission records.",
        progress: workflowActiveStepProgress(4, totalSteps),
        currentStep: 4,
        totalSteps,
        acceptedCount,
        waitingCount,
        quoteCount,
        implemented,
        isClosed: false,
        sortPriority: 25,
      };
    }

    return {
      stage: "Ranking ready",
      tone: "success",
      detail:
        quoteCount > 0
          ? `${quoteCount} carrier option${quoteCount === 1 ? "" : "s"} ranked for review.`
          : "Carrier ranking finished with no active market match.",
      blocker: quoteCount > 0 ? "Ready for agent review." : "Review carrier appetite/API setup.",
      progress: workflowStepProgress(totalSteps, totalSteps),
      currentStep: totalSteps,
      totalSteps,
      acceptedCount,
      waitingCount,
      quoteCount,
      implemented,
      isClosed: false,
      sortPriority: 20,
    };
  }

  if (session.status === "quoting") {
    return {
      stage: "Running quotes",
      tone: "gold",
      detail: `AI is running ${line} carrier ranking.`,
      blocker: "No blocker",
      progress: workflowActiveStepProgress(totalSteps, totalSteps),
      currentStep: totalSteps,
      totalSteps,
      acceptedCount,
      waitingCount,
      quoteCount,
      implemented,
      isClosed: false,
      sortPriority: 30,
    };
  }

  if (session.status === "awaiting_reply") {
    return {
      stage: "Awaiting client reply",
      tone: "warn",
      detail:
        session.lineOfBusiness === "commercial"
          ? "Shared commercial questionnaire is out to the client."
          : "Questionnaire is out to the client before final ranking.",
      blocker: `${session.missingFields.length} missing field${
        session.missingFields.length === 1 ? "" : "s"
      } outstanding.`,
      progress: workflowActiveStepProgress(3, totalSteps),
      currentStep: 3,
      totalSteps,
      acceptedCount,
      waitingCount,
      quoteCount,
      implemented,
      isClosed: false,
      sortPriority: 40,
    };
  }

  return {
    stage: "Gathering info",
    tone: "neutral",
    detail: `AI is collecting public data and preparing the ${line} questionnaire.`,
    blocker:
      session.missingFields.length > 0
        ? `${session.missingFields.length} detail${session.missingFields.length === 1 ? "" : "s"} needed.`
        : "No blocker",
    progress: workflowActiveStepProgress(2, totalSteps),
    currentStep: 2,
    totalSteps,
    acceptedCount,
    waitingCount,
    quoteCount,
    implemented,
    isClosed: false,
    sortPriority: 50,
  };
}
