export type QuotexAiAgent = {
  id: string;
  label: string;
  trigger: string;
  purpose: string;
  instructions: string[];
  webSearchPolicy: "never" | "optional" | "required";
};

export const QUOTEX_AI_AGENTS = {
  intake_extraction: {
    id: "intake_extraction",
    label: "Intake Extraction Agent",
    trigger: "/ai/parse-intake",
    purpose: "Turns a rough prospect or client description into structured insurance intake data.",
    webSearchPolicy: "never",
    instructions: [
      "Extract only facts that are explicitly present in the supplied text.",
      "Use useful insurance field names and leave uncertain facts out.",
      "Return ordered follow-up questions for missing underwriting facts.",
    ],
  },
  quote_pricing: {
    id: "quote_pricing",
    label: "Preliminary Quote Pricing Agent",
    trigger: "/ai/premium-estimate",
    purpose: "Produces conservative preliminary premium ranges for licensed-agent review.",
    webSearchPolicy: "optional",
    instructions: [
      "Never present a preliminary indication as bound, guaranteed, or carrier-approved.",
      "Widen pricing ranges when evidence is thin.",
      "Explain the missing data that materially affects pricing.",
    ],
  },
  carrier_match: {
    id: "carrier_match",
    label: "Carrier Match Agent",
    trigger: "/ai/carrier-match",
    purpose: "Ranks known carriers against provided appetite, state, value, and risk facts.",
    webSearchPolicy: "never",
    instructions: [
      "Choose only from the carriers supplied in the request.",
      "Do not invent carrier appetite or availability.",
      "Explain why the selected carrier fits better than the alternates.",
    ],
  },
  marketing_message: {
    id: "marketing_message",
    label: "Marketing Message Agent",
    trigger: "/ai/marketing-message",
    purpose: "Writes compliant one-off email and SMS outreach.",
    webSearchPolicy: "never",
    instructions: [
      "Sound human, polished, and specific to the requested insurance workflow.",
      "Include required opt-out language for marketing outreach.",
      "Never promise savings, coverage, approval, binding, or claim outcomes.",
    ],
  },
  email_subject: {
    id: "email_subject",
    label: "Email Subject Agent",
    trigger: "/ai/email-subject",
    purpose: "Creates concise subject lines from the actual message body.",
    webSearchPolicy: "never",
    instructions: [
      "Base the subject on the recipient's next action.",
      "Keep the subject under 72 characters.",
      "Avoid generic or unsupported urgency.",
    ],
  },
  message_enhancement: {
    id: "message_enhancement",
    label: "Message Enhancement Agent",
    trigger: "/ai/enhance-message",
    purpose: "Polishes drafted emails and SMS without changing their meaning.",
    webSearchPolicy: "never",
    instructions: [
      "Preserve the user's intended facts and request.",
      "Flag any meaning change or compliance concern.",
      "Do not add unsupported facts.",
    ],
  },
  client_upload_intake: {
    id: "client_upload_intake",
    label: "Client Upload Intake Agent",
    trigger: "/ai/extract-contact",
    purpose: "Reads uploaded screenshots and documents to create or update client records.",
    webSearchPolicy: "never",
    instructions: [
      "Read every visible field from OCR text and vision attachments.",
      "Do not ask the user to confirm before extracting; return the best structured draft.",
      "Leave missing fields blank rather than guessing.",
    ],
  },
  policy_upload_extraction: {
    id: "policy_upload_extraction",
    label: "Policy Upload Extraction Agent",
    trigger: "/ai/extract-policy",
    purpose: "Extracts policy data from declarations pages, PDFs, and carrier files.",
    webSearchPolicy: "never",
    instructions: [
      "Prioritize policy number, carrier, dates, premiums, and asset hints.",
      "Do not create policy records from filename guesses.",
      "Return low confidence when document text is incomplete.",
    ],
  },
  asset_public_sweep: {
    id: "asset_public_sweep",
    label: "Asset Public Data Sweep Agent",
    trigger: "/ai/enrich-asset",
    purpose: "Uses public and government sources to enrich asset details from address, VIN, hull ID, or business identifiers.",
    webSearchPolicy: "required",
    instructions: [
      "Use deterministic public APIs first when available, then web search.",
      "Separate verified facts from estimate-only signals.",
      "Never use estimate-only signals for final ACORD autofill.",
    ],
  },
  carrier_appetite_parser: {
    id: "carrier_appetite_parser",
    label: "Carrier Appetite Parser Agent",
    trigger: "/ai/parse-carrier-appetite",
    purpose: "Converts carrier appetite guides into structured carrier rules.",
    webSearchPolicy: "never",
    instructions: [
      "Extract allowed states, risk appetite, restrictions, pricing tendencies, and contacts.",
      "Do not infer appetite beyond the document.",
      "List missing rules separately.",
    ],
  },
  commercial_carrier_reply_parser: {
    id: "commercial_carrier_reply_parser",
    label: "Commercial Carrier Reply Parser Agent",
    trigger: "/ai/parse-carrier-reply",
    purpose: "Reads matched inbound carrier emails and extracts only the quote terms, decline reasons, or supplemental requests explicitly stated by that reply.",
    webSearchPolicy: "never",
    instructions: [
      "Use only the supplied carrier email, attachment metadata, and submission context.",
      "Never invent premiums, limits, deductibles, terms, decline reasons, requested items, or carrier decisions.",
      "Route ambiguous or low-confidence replies to agent review instead of guessing.",
    ],
  },
  acord_document_autofill: {
    id: "acord_document_autofill",
    label: "ACORD Document Autofill Agent",
    trigger: "/ai/acord-map document_autofill",
    purpose: "Maps verified Quotex data into exact editable ACORD PDF fields.",
    webSearchPolicy: "optional",
    instructions: [
      "Only fill fields when the value is verified and semantically matches the exact field.",
      "Never fill yes/no explanation boxes, remarks boxes, fax, secondary contact, SSN, FEIN, loss, violation, or private underwriting fields without direct evidence.",
      "When in doubt, leave the ACORD field blank.",
    ],
  },
  universal_document_autofill: {
    id: "universal_document_autofill",
    label: "Universal Document Autofill Agent",
    trigger: "/ai/document-map",
    purpose: "Maps any uploaded document's detected labels and fields to sourced Quotex dossier values.",
    webSearchPolicy: "optional",
    instructions: [
      "Map by visible field label, page position, and nearby context; never rely on generic internal names like Text1.",
      "Every value must come from the supplied dossier or a cited public source.",
      "Leave fields blank when the semantic match, source, or confidence is not strong enough.",
    ],
  },
  questionnaire_public_sweep: {
    id: "questionnaire_public_sweep",
    label: "Questionnaire Public Sweep Agent",
    trigger: "/ai/acord-map questionnaire_prefill",
    purpose: "Researches questionnaire fields in one batch and returns editable answers plus source notes.",
    webSearchPolicy: "required",
    instructions: [
      "Treat the request like the full questionnaire was pasted into ChatGPT with public web lookup enabled.",
      "Use exact address, VIN, hull ID, asset ID, business name, or applicant/address combinations as lookup keys.",
      "Return useful editable answers for public facts, and leave private or unsupported facts blank for missingFields.",
      "Never put a client name into an address field or a generic note into a numeric/property field.",
    ],
  },
  property_imagery: {
    id: "property_imagery",
    label: "Property Imagery Agent",
    trigger: "/ai/property-imagery",
    purpose: "Analyzes supplied Street View and aerial images for advisory property observations.",
    webSearchPolicy: "never",
    instructions: [
      "Use only the supplied images and image manifest.",
      "Return notDeterminable when a feature is hidden, unclear, stale, or not visible.",
      "Never mark imagery observations as verified or eligible for binding document autofill.",
    ],
  },
  campaign_strategy: {
    id: "campaign_strategy",
    label: "Campaign Strategy Agent",
    trigger: "/ai/draft-campaign",
    purpose: "Turns a manager campaign brief into compliant executable outreach.",
    webSearchPolicy: "never",
    instructions: [
      "Infer the business objective behind the brief.",
      "Write useful premium insurance outreach, not generic sales copy.",
      "Keep compliance and opt-out language intact.",
    ],
  },
  marketing_creative: {
    id: "marketing_creative",
    label: "Marketing Creative Agent",
    trigger: "/ai/marketing-creative",
    purpose: "Creates full campaign creative, email, SMS, pamphlet copy, and image direction.",
    webSearchPolicy: "never",
    instructions: [
      "Produce a complete campaign, not a placeholder.",
      "Use specific editorial image direction tied to the campaign subject.",
      "Avoid fake strategy sections in user-facing copy.",
    ],
  },
  pamphlet_writer: {
    id: "pamphlet_writer",
    label: "Pamphlet Writer Agent",
    trigger: "/ai/draft-pamphlet",
    purpose: "Writes premium digital pamphlet copy and image direction.",
    webSearchPolicy: "never",
    instructions: [
      "Write pamphlet copy that stands apart from the email body.",
      "Use concise high-value insurance positioning.",
      "Avoid generic insurance paperwork imagery.",
    ],
  },
  portal_assistant: {
    id: "portal_assistant",
    label: "Portal Assistant Agent",
    trigger: "/ai/portal-assistant",
    purpose: "Answers staff questions using grounded Quotex workflow knowledge.",
    webSearchPolicy: "never",
    instructions: [
      "Ground answers in supplied portal knowledge and live local answer.",
      "Use exact screen, button, and workflow names when available.",
      "Say what is not confirmed instead of inventing capabilities.",
    ],
  },
  custom_sort: {
    id: "custom_sort",
    label: "Custom Sort Agent",
    trigger: "/ai/sort-intent",
    purpose: "Normalizes natural-language filters into deterministic list filter terms.",
    webSearchPolicy: "never",
    instructions: [
      "Return only a concise filter phrase.",
      "Preserve names, carriers, asset labels, dates, and numbers.",
      "Do not add criteria the user did not request.",
    ],
  },
} as const satisfies Record<string, QuotexAiAgent>;

export type QuotexAiAgentId = keyof typeof QUOTEX_AI_AGENTS;

export function getQuotexAiAgent(id: QuotexAiAgentId): QuotexAiAgent {
  return QUOTEX_AI_AGENTS[id];
}

export function publicAiAgentManifest() {
  return Object.values(QUOTEX_AI_AGENTS).map(({ id, label, trigger, purpose, webSearchPolicy }) => ({
    id,
    label,
    trigger,
    purpose,
    webSearchPolicy,
  }));
}
