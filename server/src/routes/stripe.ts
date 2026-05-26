import { makePlaceholderRouter } from "./_placeholder.js";

// Stripe placeholders. Production:
// - Verify webhook signature with raw body middleware
// - Idempotent handlers on customer.subscription.* and payment_intent.*
// - Update Agency.stripeSubscriptionId and Deposit.status accordingly
export const stripeRoutes = makePlaceholderRouter("stripe", [
  { method: "POST", path: "/webhook", description: "Stripe webhook (verify signature, idempotent)" },
  { method: "POST", path: "/agencies/:id/subscription", description: "Create or update agency subscription" },
  { method: "POST", path: "/deposits/intent", description: "Create PaymentIntent for customer deposit" },
]);