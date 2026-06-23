import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";

export function AiRulesPage() {
  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div>
        <h1 className="font-display text-3xl">AI rules</h1>
        <p className="text-ink-500 text-sm mt-1">Guardrails the AI applies on every customer-facing call.</p>
      </div>
      <Disclaimer>
        The model never makes final insurance decisions. All outputs are labeled preliminary. Final
        coverage and binding must be approved by a licensed agent.
      </Disclaimer>
      <Card>
        <CardHeader title="Active rules" />
        <ul className="text-sm space-y-2 text-ink-800">
          <li>1. Every AI-generated estimate must include the preliminary disclaimer.</li>
          <li>2. Carrier-library AI recommendations are internal-only by default.</li>
          <li>3. Marketing outreach respects per-customer opt-out and rate limits.</li>
          <li>4. The AI must not promise coverage, claim payouts, or premium guarantees.</li>
          <li>5. AI calls are server-side only; API keys never reach the browser.</li>
          <li>6. Document content is summarized — never used to bind without agent review.</li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Provider routing" />
        <p className="text-sm text-ink-600">
          Configure <code>AI_PROVIDER</code> in <code>server/.env</code> (openai | anthropic |
          gemini | stub). Use <code>OPENAI_API_KEY</code> and <code>OPENAI_MODEL</code> for the production
          OpenAI route. Production AI calls must route through server-side endpoints with audit logging,
          rate limits, and tenant checks enabled.
        </p>
      </Card>
    </div>
  );
}
