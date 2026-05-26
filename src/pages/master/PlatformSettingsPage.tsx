import { Card, CardHeader } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";

export function PlatformSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Platform settings</h1>
        <p className="text-ink-500 text-sm mt-1">Founder-controlled global settings.</p>
      </div>
      <Disclaimer>
        Production settings (provider keys, webhook secrets, rate limits) must live in the backend
        environment, never in the browser bundle.
      </Disclaimer>
      <Card>
        <CardHeader title="Integrations" />
        <ul className="text-sm space-y-2 text-ink-700">
          <li><strong>AI:</strong> server-side provider routing (Anthropic / Gemini / OpenAI).</li>
          <li><strong>Email:</strong> SendGrid or Amazon SES.</li>
          <li><strong>SMS:</strong> Twilio with TCPA opt-out handling.</li>
          <li><strong>Documents:</strong> S3-compatible storage with signed URLs.</li>
          <li><strong>Payments:</strong> Stripe (deposits + subscriptions).</li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Compliance" />
        <ul className="text-sm space-y-2 text-ink-700">
          <li>All marketing messages include opt-out instructions.</li>
          <li>Per-user, per-channel rate limits enforced server-side.</li>
          <li>Audit log of every admin action.</li>
          <li>Tenant data isolation enforced at the database row level.</li>
        </ul>
      </Card>
    </div>
  );
}