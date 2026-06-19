import type { QuotingSession } from "@/types";

export type QuotingWorkflowTone = "neutral" | "info" | "success" | "warn" | "error" | "gold";

export interface QuotingWorkflowSummary {
  stage: string;
  tone: QuotingWorkflowTone;
  detail: string;
  blocker: string;
  progress: number;
  acceptedCount: number;
  waitingCount: number;
  quoteCount: number;
  implemented: boolean;
  isClosed: boolean;
  sortPriority: number;
}

export function summarizeQuotingWorkflow(session: QuotingSession): QuotingWorkflowSummary {
  const submissions = session.commercialCarrierSubmissions ?? [];
  const acceptedCount = submissions.filter(
    (submission) => submission.status === "accepted" || submission.status === "supplemental_sent"
  ).length;
  const waitingCount = submissions.filter(
    (submission) => submission.status === "needs_client_info"
  ).length;
  const quoteCount = session.quotes.length;
  const implemented = session.quotes.some((quote) => !!quote.implementation?.policyId);
  const line = session.lineOfBusiness === "commercial" ? "commercial" : "personal";

  if (implemented) {
    return {
      stage: "Policy implemented",
      tone: "success",
      detail: "Quote workflow finished and policy/billing records were created.",
      blocker: "No blocker",
      progress: 100,
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
      progress: acceptedCount > 0 ? 78 : 68,
      acceptedCount,
      waitingCount,
      quoteCount,
      implemented,
      isClosed: false,
      sortPriority: 10,
    };
  }

  if (session.status === "complete") {
    return {
      stage: "Ranking ready",
      tone: "success",
      detail:
        quoteCount > 0
          ? `${quoteCount} carrier option${quoteCount === 1 ? "" : "s"} ranked for review.`
          : "Carrier ranking finished with no active market match.",
      blocker: quoteCount > 0 ? "Ready for agent review." : "Review carrier appetite/API setup.",
      progress: 96,
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
      tone: "info",
      detail: `AI is running ${line} carrier ranking.`,
      blocker: "No blocker",
      progress: 84,
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
      progress: session.questionnaireSentAt ? 52 : 42,
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
    progress: 24,
    acceptedCount,
    waitingCount,
    quoteCount,
    implemented,
    isClosed: false,
    sortPriority: 50,
  };
}
