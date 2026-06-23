# Quotex AI Routing

Quotex uses server-side AI only. Browser code calls `/api/ai/*`; model keys stay in `server/.env` and never use `VITE_` variables.

## Runtime Layers

1. Browser AI gateway: `src/lib/aiGateway.ts`
   - Sends enabled AI requests to the backend.
   - Uses the browser AI resource governor for cache, dedupe, payload limits, and quota windows.

2. Server AI routes: `server/src/routes/ai.ts`
   - Validates request shape, tenant ownership, and payload size.
   - Calls the AI service layer.

3. Server AI model router: `server/src/services/ai/modelRouter.ts`
   - Chooses the right model profile for the task.
   - Keeps document extraction, ACORD autofill, quote reasoning, marketing, assistant, sort intent, and image generation independently tunable.

4. Provider and governor: `server/src/services/ai/provider.ts` and `server/src/services/ai/governor.ts`
   - Calls the configured provider.
   - Adds server-side cache, dedupe, payload limits, quotas, and usage events.

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

## Non-Negotiable Safety Rules

- ACORD fill should remain deterministic at write time. AI may suggest a mapping, but verified Quotex data or a client/agent answer must be the final source.
- Quote prices should come from deterministic rating/ranking logic, carrier imports, or configured runner outputs. AI may explain and compare, but should not invent premium numbers.
- Carrier runners must run in isolated worker infrastructure before production. The model can assist with page understanding and exception handling, but credentials and submissions need locked-down server-side controls.
- AI custom sort must normalize user intent only. It should not send every client/policy row to the model.
- Every production AI call should keep a usage event, source trace, tenant id, model/profile, and confidence where applicable.
