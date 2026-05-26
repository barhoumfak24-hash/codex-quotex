// Stripe service stub.
// Real impl: import Stripe from 'stripe'; const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createDepositPaymentIntent(_args: {
  amount: number;
  currency: string;
  customerEmail: string;
  metadata: Record<string, string>;
}) {
  // Returns { clientSecret } the frontend uses with Stripe.js to confirm.
  return { clientSecret: "stub_secret", id: "pi_stub" };
}

export async function updateAgencySubscription(_args: {
  agencyId: string;
  tier: "minimum" | "mid" | "ultra";
  seatCount: number;
}) {
  // Update subscription items based on tier and seat count.
  return { stripeSubscriptionId: "sub_stub" };
}

export async function verifyWebhook(_rawBody: Buffer, _signature: string) {
  // stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  return { type: "stub.event", data: { object: {} } };
}