import { provider, type CompleteArgs } from "./provider.js";
import { getQuotexAiAgent, type QuotexAiAgentId } from "./agents.js";

export type CodexAgentTask =
  | "agency_data_import"
  | "client_document_upload"
  | "document_autofill"
  | "universal_document_autofill"
  | "property_imagery"
  | "public_data_sweep"
  | "carrier_portal_runner"
  | "portal_assistant"
  | "custom_sort"
  | "message_email"
  | "quote_pricing";

type CodexAgentArgs = Omit<CompleteArgs, "system"> & {
  task: CodexAgentTask;
  agent: QuotexAiAgentId;
  system: string;
  allowWebSearch?: boolean;
};

const CODEX_SPECIALISTS = [
  "Codex extraction specialist: reads every visible field and preserves exact source meaning.",
  "Insurance workflow specialist: understands ACORD, quoting, carrier runner, agency, client, and policy workflows.",
  "Evidence auditor: rejects guesses, fabricated facts, unsupported web claims, and mismatched field/value pairs.",
  "Security and privacy specialist: keeps secrets server-side and blocks unsafe credential or external-system actions.",
  "Reliability specialist: prefers deterministic, source-backed outputs and flags missing prerequisites instead of pretending work is complete.",
  "Quotex product-review specialist: applies the user's standard that the workflow must be useful, polished, and not glitchy.",
];

function codexAgentModel(): string | undefined {
  return (
    env("CODEX_AGENT_MODEL") ||
    env("OPENAI_CODEX_MODEL") ||
    env("OPENAI_MAX_REASONING_MODEL") ||
    env("AI_REASONING_MODEL")
  );
}

function codexSystem(task: CodexAgentTask, agentId: QuotexAiAgentId, system: string): string {
  const agent = getQuotexAiAgent(agentId);
  return [
    "You are the server-side Codex Orchestrator embedded inside Quotex Insurance.",
    "Behave like a senior agentic coding-and-insurance operations system, not a loose chatbot.",
    `Task profile: ${task}.`,
    `Dedicated agent: ${agent.label} (${agent.id}).`,
    `Website trigger: ${agent.trigger}.`,
    `Agent purpose: ${agent.purpose}`,
    `Agent web-search policy: ${agent.webSearchPolicy}.`,
    "Agent-specific instructions:",
    ...agent.instructions.map((item) => `- ${item}`),
    "",
    "Run these internal specialists before returning JSON:",
    ...CODEX_SPECIALISTS.map((item) => `- ${item}`),
    "",
    "Non-negotiable production rules:",
    "- Return valid JSON only in the requested schema.",
    "- Use the supplied Quotex facts first.",
    "- When external research is available, use it only for public, source-backed facts.",
    "- Never fabricate names, addresses, phone numbers, emails, policy numbers, FEIN/SSN, losses, claims, violations, carrier decisions, credentials, or prices.",
    "- When in doubt, leave the value blank or list it as missing.",
    "- Any write to ACORD/PDF fields must be source-backed, semantically compatible with the target field, and conservative.",
    "- External carrier/browser actions require a signed-in carrier session; never request or store carrier usernames or passwords.",
    "- If a requested action cannot be completed safely, return the blocker in the schema instead of pretending success.",
    "",
    system,
  ].join("\n");
}

export async function codexAgentCompleteJson<T = unknown>(args: CodexAgentArgs): Promise<T> {
  const { agent, allowWebSearch, task, ...completeArgs } = args;
  const tools = allowWebSearch
    ? Array.from(
        new Map([...(completeArgs.tools ?? []), { type: "web_search" }].map((tool) => [JSON.stringify(tool), tool])).values()
      )
    : completeArgs.tools;

  return provider.completeJson<T>({
    ...completeArgs,
    system: codexSystem(task, agent, args.system),
    schemaName: openAiSchemaName(["codex", agent, task, args.schemaName]),
    model: args.model || codexAgentModel(),
    reasoningEffort: args.reasoningEffort ?? "xhigh",
    quality: args.quality ?? "maximum",
    tools,
    toolChoice: allowWebSearch ? args.toolChoice ?? "required" : args.toolChoice,
  });
}

function openAiSchemaName(parts: Array<string | undefined>): string {
  const base = parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join("_")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base.length <= 64) return base || "quotex_ai";
  const hash = stableHash(base);
  return `${base.slice(0, 55).replace(/[_-]+$/g, "")}_${hash}`;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36).slice(0, 8);
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
