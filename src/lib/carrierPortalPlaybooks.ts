import type { Carrier, CarrierPortalPlaybook } from "@/types";

const DOCUMENT_STEPS = [
  "Confirm the agent is already signed in to the carrier portal in the active browser session.",
  "Search by policy number first; if missing, search by insured name plus risk address.",
  "Confirm at least two identifiers before opening or downloading anything.",
  "Open policy/account documents and download declarations, ID cards, invoices, endorsements, notices, and carrier correspondence when available.",
  "Attach downloaded files to the active Quotex record without modifying carrier data.",
];

const CLAIM_STEPS = [
  "Confirm the agent is already signed in to the carrier portal in the active browser session.",
  "Search by claim number first; if missing, search by policy number and date of loss.",
  "Confirm insured, policy, and loss date before reading claim details.",
  "Collect claim number, status, adjuster contact, paid/reserve amounts, loss description, and available claim documents.",
  "Attach retrieved claim documents to the active Quotex record without changing claim status.",
];

const QUOTE_STEPS = [
  "Confirm the agent is already signed in to the carrier portal in the active browser session.",
  "Start the carrier's new quote or rating workflow for the requested line.",
  "Enter only data already verified in Quotex or supplied by the client/agent.",
  "Upload ACORDs, schedules, and supplemental documents only when the carrier workflow asks for them.",
  "Save the quote indication/proposal and download the carrier-generated quote PDF when available.",
];

export const CARRIER_RUNNER_STOP_CONDITIONS = [
  "Portal requests login, password, MFA, CAPTCHA, or security challenge.",
  "The portal account, producer code, or agency appointment does not match the active Quotex agency.",
  "The policy, insured, claim, or risk cannot be matched with at least two identifiers.",
  "The carrier blocks the requested state, product, or risk class.",
  "The next action would bind, issue, cancel, endorse, delete, submit payment, or change coverage.",
  "Unexpected warning, legal attestation, producer agreement, or payment screen appears.",
];

export const CARRIER_RUNNER_FORBIDDEN_ACTIONS = [
  "Do not bind or issue coverage.",
  "Do not cancel, non-renew, reinstate, or endorse a policy.",
  "Do not submit payments or change billing/autopay settings.",
  "Do not change carrier portal credentials, recovery methods, MFA, agency profile, or producer settings.",
  "Do not save carrier credentials in Quotex.",
  "Do not submit unverifiable, estimated, or fabricated answers.",
];

type PlaybookSeed = {
  agentPortalUrl?: string;
  sourceUrls?: string[];
  status?: CarrierPortalPlaybook["status"];
  notes?: string;
  documents?: string[];
  claims?: string[];
  quotes?: string[];
};

function playbook(seed: PlaybookSeed): CarrierPortalPlaybook {
  return {
    status: seed.status ?? (seed.agentPortalUrl ? "configured" : "needs_verification"),
    agentPortalUrl: seed.agentPortalUrl,
    sourceUrls: seed.sourceUrls ?? (seed.agentPortalUrl ? [seed.agentPortalUrl] : []),
    documents: seed.documents ?? DOCUMENT_STEPS,
    claims: seed.claims ?? CLAIM_STEPS,
    quotes: seed.quotes ?? QUOTE_STEPS,
    stopConditions: CARRIER_RUNNER_STOP_CONDITIONS,
    forbiddenActions: CARRIER_RUNNER_FORBIDDEN_ACTIONS,
    notes:
      seed.notes ??
      "Runner may only proceed when the agency user already has an authenticated carrier session.",
  };
}

function verificationNeeded(agentPortalUrl: string, notes?: string): CarrierPortalPlaybook {
  return playbook({
    agentPortalUrl,
    status: "needs_verification",
    notes:
      notes ??
      "A public portal or carrier site is configured, but the exact appointed-agency workflow must be verified before runner use.",
  });
}

export const CARRIER_PORTAL_PLAYBOOKS: Record<string, CarrierPortalPlaybook> = {
  carrier_chubb: playbook({
    agentPortalUrl: "https://www.chubb.com/us-en/agents-brokers.html",
  }),
  carrier_pure: playbook({
    agentPortalUrl: "https://broker.pureinsurance.com/",
    sourceUrls: ["https://www.pureinsurance.com/brokers/broker-login", "https://broker.pureinsurance.com/"],
  }),
  carrier_aig: playbook({
    agentPortalUrl: "https://www.aig.com/business/insurance/login",
  }),
  carrier_cincinnati_home: playbook({
    agentPortalUrl: "https://www.cinfin.com/cincinnati-insurance-agents",
  }),
  carrier_vault: verificationNeeded(
    "https://www.vault.insurance/",
    "Carrier website is configured, but a public agent portal entry was not verified. Record the exact Vault producer portal URL before automation."
  ),
  carrier_berkley_one: playbook({
    agentPortalUrl: "https://my.berkleyone.com/",
    sourceUrls: ["https://www.berkleyone.com/", "https://my.berkleyone.com/"],
  }),
  carrier_crestbrook: playbook({
    agentPortalUrl: "https://www.agentcenter.nationwide.com",
    notes: "Crestbrook/Nationwide Private Client is routed through Nationwide Agent Center when the agency is appointed.",
  }),
  carrier_hagerty: playbook({
    agentPortalUrl: "https://www.hagertyagent.com/",
    sourceUrls: ["https://www.hagertyagent.com/", "https://insurance.hagertyagent.com/ISS/s/"],
  }),
  carrier_markel: playbook({
    agentPortalUrl: "https://magic.markelamerican.com/",
    sourceUrls: ["https://www.markel.com/us/for-agents-and-brokers", "https://magic.markelamerican.com/"],
  }),
  carrier_natgen_premier: playbook({
    agentPortalUrl: "https://natgenagency.com/",
    sourceUrls: ["https://nationalgeneral.com/", "https://natgenagency.com/"],
  }),
  carrier_travelers: playbook({
    agentPortalUrl: "https://www.travelers.com/agents/login",
  }),
  carrier_liberty: playbook({
    agentPortalUrl: "https://agents.libertymutual.com/",
  }),
  carrier_safeco: playbook({
    agentPortalUrl: "https://agents.libertymutual.com/",
    notes: "Safeco agent access is routed through Liberty Mutual/Safeco agent portal links for appointed agencies.",
  }),
  carrier_hartford: playbook({
    agentPortalUrl: "https://account.thehartford.com/agent/login",
    sourceUrls: ["https://www.thehartford.com/account-access", "https://account.thehartford.com/agent/login"],
  }),
  carrier_nationwide: playbook({
    agentPortalUrl: "https://www.agentcenter.nationwide.com",
  }),
  carrier_progressive: playbook({
    agentPortalUrl: "https://www.foragentsonly.com/",
  }),
  carrier_allstate: playbook({
    agentPortalUrl: "https://agents.allstate.com",
  }),
  carrier_farmers: playbook({
    agentPortalUrl: "https://agents.farmers.com",
  }),
  carrier_statefarm: verificationNeeded(
    "https://b2b.statefarm.com",
    "State Farm is generally a captive/proprietary channel. Runner can only proceed after an authorized agency session path is verified."
  ),
  carrier_usaa: playbook({
    status: "unsupported",
    sourceUrls: ["https://www.usaa.com/"],
    documents: [],
    claims: [],
    quotes: [],
    notes: "No independent-agent runner playbook is configured. Keep USAA manual unless a valid producer access path is supplied by the agency.",
  }),
  carrier_autoowners: verificationNeeded("https://www.auto-owners.com/"),
  carrier_erie: playbook({
    agentPortalUrl: "https://www.agentexchange.com/",
  }),
  carrier_mercury: verificationNeeded("https://www.mercuryinsurance.com/"),
  carrier_amfam: verificationNeeded("https://www.amfam.com/"),
  carrier_foremost: playbook({
    agentPortalUrl: "https://www.foremoststar.com/",
  }),
  carrier_stillwater: verificationNeeded("https://www.stillwater.com/"),
  carrier_plymouth_rock: verificationNeeded("https://www.plymouthrock.com/"),
  carrier_kemper: playbook({
    agentPortalUrl: "https://agents.kemper.com/",
  }),
  carrier_westfield: verificationNeeded("https://www.westfieldinsurance.com/"),
  carrier_amtrust: verificationNeeded("https://amtrustfinancial.com/"),
  carrier_auto_club_group: verificationNeeded("https://www.aaa.com/insurance"),
  carrier_michigan_farm_bureau: verificationNeeded("https://www.michfb.com/insurance"),
  carrier_frankenmuth: verificationNeeded("https://www.fmins.com/agents"),
  carrier_hanover_citizens: verificationNeeded("https://www.hanover.com/agents"),
  carrier_pioneer_state_mutual: verificationNeeded("https://www.psmic.com"),
  carrier_hastings_mutual: verificationNeeded("https://www.hastingsmutual.com"),
  carrier_fremont: verificationNeeded("https://www.fmic.com"),
  carrier_michigan_insurance_company: verificationNeeded("https://www.michiganinsurance.com"),
  carrier_secura: verificationNeeded("https://www.secura.net/agents"),
  carrier_grange: verificationNeeded("https://www.grangeinsurance.com/agents"),
  carrier_west_bend: verificationNeeded("https://www.thesilverlining.com"),
  carrier_meemic: verificationNeeded("https://www.meemic.com"),
  carrier_insurance_agent_hub: verificationNeeded(
    "https://insurance-agent-hub.replit.app/sign-in",
    "The test carrier portal is available, but its quote, policy, claim, and document workflows must be verified before runner automation is enabled."
  ),
};

export function applyCarrierPortalPlaybook(carrier: Carrier): Carrier {
  const portalPlaybook = CARRIER_PORTAL_PLAYBOOKS[carrier.id];
  if (!portalPlaybook) return carrier;

  type CarrierQuotingAutomation = NonNullable<Carrier["quotingAutomation"]>;
  const existingAutomation: Partial<Omit<CarrierQuotingAutomation, "credentialReference">> =
    carrier.quotingAutomation
      ? (({ credentialReference: _legacyCredentialReference, ...rest }) => rest)(
          carrier.quotingAutomation
        )
      : {};
  const agentPortalUrl =
    existingAutomation.agentPortalUrl ??
    carrier.agentPortalUrl ??
    portalPlaybook.agentPortalUrl;
  const quotingAutomation =
    portalPlaybook.status === "unsupported"
      ? existingAutomation.status
        ? { ...existingAutomation, status: "not_configured" as const, agentPortalUrl: undefined }
        : undefined
      : {
          provider: existingAutomation.provider ?? "AI carrier portal runner",
          agentPortalUrl,
          customerPortalUrl: existingAutomation.customerPortalUrl,
          mfaMode: existingAutomation.mfaMode ?? "staff_prompt",
          status:
            portalPlaybook.status === "configured"
              ? existingAutomation.status ?? "configured"
              : "not_configured",
          lastTestedAt: existingAutomation.lastTestedAt,
          notes:
            existingAutomation.notes ??
            "Uses the agent's existing signed-in carrier browser session only. Quotex never stores or types carrier usernames or passwords.",
        };

  return {
    ...carrier,
    agentPortalUrl,
    quotingAutomation,
    portalPlaybook,
  };
}

export function carrierPortalRunnerStatus(carrier?: Carrier | null) {
  if (!carrier) {
    return {
      canAttempt: false,
      label: "No carrier selected",
      detail: "The runner cannot start without a carrier record.",
      tone: "neutral" as const,
    };
  }

  const playbook = carrier.portalPlaybook ?? CARRIER_PORTAL_PLAYBOOKS[carrier.id];
  if (!playbook) {
    return {
      canAttempt: false,
      label: "No portal playbook",
      detail: "Add a carrier portal playbook before enabling an AI runner.",
      tone: "neutral" as const,
    };
  }

  if (playbook.status === "unsupported") {
    return {
      canAttempt: false,
      label: "Manual only",
      detail: playbook.notes ?? "This carrier does not have a configured runner path.",
      tone: "warn" as const,
    };
  }

  if (playbook.status === "needs_verification") {
    return {
      canAttempt: false,
      label: "Portal needs verification",
      detail:
        playbook.notes ??
        "The public portal entry exists, but an appointed-agency login path must be verified before runner use.",
      tone: "warn" as const,
    };
  }

  return {
    canAttempt: true,
    label: "Portal playbook ready",
    detail:
      "Runner may attempt the carrier workflow only with an existing signed-in portal session and must stop at login, MFA, bind, payment, or mismatch screens.",
    tone: "success" as const,
  };
}
