import { postServerAi } from "./aiGateway";
import { evaluateAiProductionGate } from "./aiProductionGuards";

export interface AiCustomFilterSubject {
  text: Array<string | undefined | null>;
  flags?: Record<string, boolean | undefined>;
  numbers?: Array<number | undefined | null>;
}

export async function normalizeAiCustomFilterQuery(
  query: string,
  context?: string
): Promise<string> {
  const raw = query.trim();
  if (!raw) return "";
  const out = await postServerAi<{ normalizedQuery?: string; confidence?: number }>(
    "/ai/sort-intent",
    { query: raw, context },
    { timeoutMs: 4_000 }
  );
  const normalized = out?.normalizedQuery?.trim();
  if (!normalized || normalized.length > 240) return raw;
  const confidence = typeof out?.confidence === "number" ? out.confidence : 0.5;
  const gate = evaluateAiProductionGate({
    system: "custom_sort",
    action: "normalize_query",
    tenantScoped: true,
    confidence,
    usesOnlyProvidedFacts: true,
  });
  if (!gate.allowed || confidence < 0.6) return raw;
  return normalized;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "by",
  "clients",
  "client",
  "customers",
  "customer",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "me",
  "of",
  "on",
  "over",
  "people",
  "prospect",
  "prospects",
  "show",
  "that",
  "the",
  "to",
  "with",
  "above",
  "below",
  "greater",
  "less",
  "more",
  "than",
]);

const SEMANTIC_WORDS = new Set([
  "active",
  "abandoned",
  "account",
  "accounts",
  "ack",
  "acknowledged",
  "additional",
  "agent",
  "assigned",
  "assignment",
  "attention",
  "autopay",
  "bill",
  "billing",
  "bound",
  "business",
  "certificate",
  "certificates",
  "claim",
  "claims",
  "closed",
  "coi",
  "converted",
  "customer",
  "customers",
  "contacted",
  "direct",
  "due",
  "email",
  "escrow",
  "evidence",
  "finance",
  "financed",
  "follow",
  "followup",
  "holder",
  "holders",
  "high",
  "inactive",
  "info",
  "information",
  "insured",
  "insured",
  "lien",
  "lienholder",
  "lienholders",
  "link",
  "linked",
  "lost",
  "managed",
  "manager",
  "marketing",
  "missing",
  "mortgage",
  "mortgagee",
  "mortgagees",
  "named",
  "needs",
  "new",
  "no",
  "none",
  "not",
  "number",
  "open",
  "opened",
  "overdue",
  "opt",
  "opted",
  "out",
  "paused",
  "pending",
  "personal",
  "policies",
  "policy",
  "premium",
  "commercial",
  "approved",
  "received",
  "reconcile",
  "reconciled",
  "reconciliation",
  "declined",
  "review",
  "renewal",
  "renewals",
  "renewed",
  "nonrenewal",
  "nonrenewed",
  "rewrite",
  "sms",
  "soon",
  "submitted",
  "unassigned",
  "unreconciled",
  "under",
  "upcoming",
  "waiting",
]);

export function matchesAiCustomFilter(query: string, subject: AiCustomFilterSubject): boolean {
  const raw = query.trim();
  if (!raw) return true;

  const normalized = normalize(raw);
  const flags = subject.flags ?? {};
  const checks: boolean[] = [];

  addFlagCheck(checks, normalized, flags, ["unassigned", "without agent", "no agent", "needs assignment"], "unassigned");
  addFlagCheck(checks, normalized, flags, ["assigned", "managed", "has agent"], "assigned");
  addFlagCheck(checks, normalized, flags, ["active"], "active");
  addFlagCheck(checks, normalized, flags, ["inactive"], "inactive");
  addFlagCheck(checks, normalized, flags, ["bound", "insured", "bound policies", "bound policy"], "bound");
  addFlagCheck(checks, normalized, flags, ["renewal", "renewals", "renewal due", "renewals due", "upcoming renewal"], "renewal");
  addFlagCheck(
    checks,
    normalized,
    flags,
    ["non renewal", "nonrenewal", "non renewed", "nonrenewed", "carrier non renewal", "rewrite"],
    "nonrenewed"
  );
  addFlagCheck(checks, normalized, flags, ["claim", "claims"], "claim");
  addFlagCheck(checks, normalized, flags, ["open claim", "open claims", "claim opened", "claims opened"], "openClaim");
  addFlagCheck(checks, normalized, flags, ["closed claim", "closed claims"], "closedClaim");
  addFlagCheck(checks, normalized, flags, ["no policy", "no policies", "without policy", "without policies"], "noPolicies");
  addAnyFlagCheck(checks, normalized, flags, ["missing", "missing info", "missing information"], [
    "missing",
    "missingInfo",
    "missingAccount",
    "missingEmail",
    "missingLink",
    "missingClaimNumber",
  ]);
  addAnyFlagCheck(checks, normalized, flags, ["missing account", "no account", "missing account number"], [
    "missingAccount",
  ]);
  addAnyFlagCheck(checks, normalized, flags, ["missing email", "no email", "needs email", "without email"], [
    "missingEmail",
  ]);
  addAnyFlagCheck(checks, normalized, flags, ["missing link", "missing carrier link", "no carrier link"], [
    "missingLink",
  ]);
  addAnyFlagCheck(checks, normalized, flags, ["missing claim number", "no claim number", "needs claim number"], [
    "missingClaimNumber",
  ]);
  addFlagCheck(checks, normalized, flags, ["email opt in", "email opt-in", "email consent"], "emailOptIn");
  addFlagCheck(checks, normalized, flags, ["sms opt in", "sms opt-in", "sms consent"], "smsOptIn");
  addFlagCheck(checks, normalized, flags, ["opted out", "opt out", "marketing opt out"], "optedOut");
  addFlagCheck(checks, normalized, flags, ["needs attention", "attention", "alert"], "alert");
  addFlagCheck(checks, normalized, flags, ["needs follow up", "needs followup", "follow up", "follow-up"], "needsFollowUp");
  addFlagCheck(checks, normalized, flags, ["needs review", "for review", "in review"], "needsReview");
  addFlagCheck(checks, normalized, flags, ["in review"], "inReview");
  addFlagCheck(checks, normalized, flags, ["new"], "new");
  addFlagCheck(checks, normalized, flags, ["contacted"], "contacted");
  addFlagCheck(checks, normalized, flags, ["quote", "quote in progress"], "quote");
  addFlagCheck(checks, normalized, flags, ["abandoned"], "abandoned");
  addFlagCheck(checks, normalized, flags, ["nurturing", "nurture"], "nurturing");
  addFlagCheck(checks, normalized, flags, ["converted"], "converted");
  addFlagCheck(checks, normalized, flags, ["lost"], "lost");
  addFlagCheck(checks, normalized, flags, ["paused"], "paused");
  addFlagCheck(checks, normalized, flags, ["pending", "needs action", "agent action"], "pending");
  addFlagCheck(checks, normalized, flags, ["due soon"], "dueSoon");
  addFlagCheck(checks, normalized, flags, ["past due", "overdue"], "pastDue");
  addFlagCheck(checks, normalized, flags, ["due", "due soon", "past due", "overdue"], "due");
  addFlagCheck(checks, normalized, flags, ["direct", "direct bill", "direct billing"], "directBill");
  addFlagCheck(checks, normalized, flags, ["agency bill", "agency billing"], "agencyBill");
  addFlagCheck(checks, normalized, flags, ["finance", "premium finance", "premium financed", "finance company"], "premiumFinance");
  addFlagCheck(checks, normalized, flags, ["carrier autopay", "autopay"], "carrierAutopay");
  addFlagCheck(checks, normalized, flags, ["mortgage escrow", "mortgagee escrow", "escrow"], "mortgageeEscrow");
  addFlagCheck(checks, normalized, flags, ["received", "commission received"], "received");
  addFlagCheck(checks, normalized, flags, ["reconciled"], "reconciled");
  addFlagCheck(checks, normalized, flags, ["unreconciled", "not reconciled"], "unreconciled");
  addFlagCheck(checks, normalized, flags, ["waiting", "waiting on customer"], "waiting");
  addFlagCheck(checks, normalized, flags, ["submitted", "submitted for renewal"], "submitted");
  addFlagCheck(checks, normalized, flags, ["approved"], "approved");
  addFlagCheck(checks, normalized, flags, ["declined"], "declined");
  addFlagCheck(checks, normalized, flags, ["personal", "private client"], "personal");
  addFlagCheck(checks, normalized, flags, ["commercial", "business", "company"], "commercial");
  addFlagCheck(checks, normalized, flags, ["mortgagee", "mortgagees", "mortgage holder", "mortgage holders"], "mortgagee");
  addFlagCheck(checks, normalized, flags, ["lienholder", "lienholders", "lien holder", "lien holders"], "lienholder");
  addFlagCheck(checks, normalized, flags, ["certificate holder", "certificate holders", "coi", "evidence"], "certificateHolder");
  addFlagCheck(checks, normalized, flags, ["additional insured", "additional insureds"], "additionalInsured");
  addFlagCheck(checks, normalized, flags, ["named insured", "named insureds", "primary insured"], "namedInsured");
  addFlagCheck(checks, normalized, flags, ["beneficiary", "beneficiaries"], "beneficiary");

  const moneyCheck = moneyPredicate(normalized, subject.numbers ?? []);
  if (moneyCheck != null) checks.push(moneyCheck);

  if (/\bhigh value\b|\bhv\b|\bhnw\b/.test(normalized)) {
    checks.push((subject.numbers ?? []).some((value) => Number(value ?? 0) >= 1_000_000));
  }

  if (checks.some((result) => !result)) return false;

  const haystack = normalize(subject.text.filter(Boolean).join(" "));
  const freeTokens = tokenize(normalized).filter(
    (token) => !STOP_WORDS.has(token) && !SEMANTIC_WORDS.has(token) && !/^\d+[km]?$/.test(token)
  );

  if (freeTokens.length === 0) return checks.length > 0;
  return freeTokens.every((token) => haystack.includes(token));
}

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^a-z0-9.$><=\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function aiAssetTypeAliases(type: string | undefined | null): string[] {
  if (type === "luxury_vehicle") return ["auto", "autos", "vehicle", "vehicles", "car", "cars"];
  if (type === "coastal_home") return ["home", "homes", "house", "houses", "property", "coastal"];
  if (type === "jewelry") return ["jewelry", "valuables", "watches", "appraisals"];
  if (type === "yacht") return ["yacht", "boat", "boats", "marine", "watercraft"];
  if (type === "umbrella_liability") return ["umbrella", "liability", "excess"];
  if (type === "full_portfolio") return ["portfolio", "package", "account"];
  return [];
}

function tokenize(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function addFlagCheck(
  checks: boolean[],
  normalized: string,
  flags: Record<string, boolean | undefined>,
  phrases: string[],
  flag: string
) {
  if (phrases.some((phrase) => phraseMatches(normalized, phrase))) {
    checks.push(Boolean(flags[flag]));
  }
}

function addAnyFlagCheck(
  checks: boolean[],
  normalized: string,
  flags: Record<string, boolean | undefined>,
  phrases: string[],
  flagNames: string[]
) {
  if (phrases.some((phrase) => phraseMatches(normalized, phrase))) {
    checks.push(flagNames.some((flag) => Boolean(flags[flag])));
  }
}

function phraseMatches(normalized: string, phrase: string): boolean {
  const escaped = normalize(phrase)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(normalized);
}

function moneyPredicate(normalized: string, numbers: Array<number | undefined | null>): boolean | null {
  const amount = parseMoneyAmount(normalized);
  if (amount == null) return null;
  const values = numbers.map((value) => Number(value ?? 0));
  if (/\b(under|below|less than|<|<=)\b/.test(normalized)) {
    return values.some((value) => value > 0 && value <= amount);
  }
  return values.some((value) => value >= amount);
}

function parseMoneyAmount(normalized: string): number | null {
  if (!/(\$|\b(over|above|greater than|under|below|less than|more than)\b|\d+(?:\.\d+)?\s*(m|million|k|thousand)\b|[<>]=?)/.test(normalized)) {
    return null;
  }
  const match = normalized.match(/(?:\$?\s*)?(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const unit = match[2];
  if (unit === "m" || unit === "million") return n * 1_000_000;
  if (unit === "k" || unit === "thousand") return n * 1_000;
  return n;
}
