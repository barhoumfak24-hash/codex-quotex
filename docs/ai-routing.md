# Quotex AI Routing

Quotex uses server-side AI only. Browser code calls `/api/ai/*`; model keys stay in `server/.env` and never use `VITE_` variables.

## Runtime Layers

1. Browser AI gateway: `src/lib/aiGateway.ts`
   - Sends enabled AI requests to the backend.
   - Uses the browser AI resource governor for cache, dedupe, payload limits, and quota windows.
   - Production builds require server AI by default. If an AI gateway request fails in production, Quotex surfaces the failure instead of silently using local/demo fallbacks.

2. Server AI routes: `server/src/routes/ai.ts`
   - Validates request shape, tenant ownership, and payload size.
   - Calls the AI service layer.

3. Server AI model router: `server/src/services/ai/modelRouter.ts`
   - Chooses the right model profile for the task.
   - Keeps document extraction, ACORD autofill, quote reasoning, marketing, assistant, sort intent, and image generation independently tunable.

4. Provider and governor: `server/src/services/ai/provider.ts` and `server/src/services/ai/governor.ts`
   - Calls OpenAI only. Unsupported `AI_PROVIDER` values fail closed instead of falling back.
   - Adds server-side cache, dedupe, payload limits, quotas, and usage events.

5. Codex orchestrator: `server/src/services/ai/codexOrchestrator.ts`
   - Wraps every production AI task with Codex-style specialist instructions before it reaches the provider.
   - Uses `CODEX_AGENT_MODEL` / `OPENAI_CODEX_MODEL` first, then falls back to the normal reasoning model.
   - Runs the same internal checklist for extraction, ACORD autofill, public-data sweep, portal assistant, carrier runners, messaging, quote pricing, and custom sort.
   - Forces conservative behavior: source-backed facts, no guessed credentials, no unsafe carrier actions, no unsupported ACORD writes.

6. Legacy provider bridges
   - Base44/OpenClaw/browser/demo AI bridges are not runtime AI providers.
   - If old `BASE44_*` variables are still present, the server ignores them and warns that Quotex AI is OpenAI-only.
   - Questionnaire/public-data sweeps use the OpenAI Responses API with the web-search tool through the Codex orchestrator.

## Model Profiles

| Profile | Used For | Env Override |
|---|---|---|
| `document_extraction` | Agency import, add-client uploads, intake parsing, policy/contact extraction, appetite parsing | `AI_DOCUMENT_MODEL` |
| `document_autofill` | ACORD/PDF mapping suggestions and future fillable-field reasoning | `AI_AUTOFILL_MODEL` |
| `portal_runner` | Carrier portal runner planning and future runner page understanding | `AI_RUNNER_MODEL` |
| `pricing_reasoning` | Preliminary premium reasoning, quote ranking, carrier matching | `AI_PRICING_MODEL` |
| `fast_text` | Email subjects, message enhancement, short text tasks | `AI_FAST_MODEL` |
| `sort_intent` | AI custom sort query normalization | `AI_SORT_MODEL` |
| `marketing_creative` | Campaign copy, pamphlets, marketing studio text | `AI_MARKETING_MODEL` |
| `portal_assistant` | Portal assistant answer generation | `AI_PORTAL_ASSISTANT_MODEL` |
| `image_generation` | Marketing imagery | `OPENAI_IMAGE_MODEL` |

Set `CODEX_AGENT_MODEL` to the highest-grade production model approved for Quotex agentic workflows. This does not expose a key to the browser; it only changes server-side routing.

## Production Fallback Policy

Tests may mock AI responses. Runtime app code should use server-side OpenAI only.

- Leave `VITE_AI_MODE=server` in production, or omit it and let the production gateway default to server AI.
- Do not set `VITE_ALLOW_BROWSER_AI_FALLBACKS=true` for production. Production ignores it.
- If `/api/ai/*` is unavailable in production, the caller should fail visibly so the issue is fixed instead of producing fabricated AI output.
- Server environment validation requires `OPENAI_API_KEY`, database-backed rate limits, tenant isolation, transactional email, address autocomplete credentials, and disaster-recovery configuration before live agency data is imported.

## Non-Negotiable Safety Rules

- ACORD fill should remain deterministic at write time. AI may suggest a mapping, but verified Quotex data or a client/agent answer must be the final source.
- Quote prices should come from deterministic rating/ranking logic, carrier imports, or configured runner outputs. AI may explain and compare, but should not invent premium numbers.
- Carrier runners must run in isolated worker infrastructure before production. The model can assist with page understanding and exception handling, but credentials and submissions need locked-down server-side controls.
- AI custom sort must normalize user intent only. It should not send every client/policy row to the model.
- Every production AI call should keep a usage event, source trace, tenant id, model/profile, and confidence where applicable.
- ACORD mappings are filtered after model output. Address fields must look like addresses, email fields must look like emails, phone fields must look like phone numbers, and sensitive identifiers are never inferred.
- Questionnaire output is still filtered by the same ACORD/questionnaire guardrails before it can appear in the UI.
