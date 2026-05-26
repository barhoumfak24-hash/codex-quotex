import { makePlaceholderRouter } from "./_placeholder.js";

export const marketingRoutes = makePlaceholderRouter("marketing", [
  { method: "GET", path: "/campaigns", description: "List campaigns (tenant scoped)" },
  { method: "POST", path: "/campaigns", description: "Create campaign" },
  { method: "PATCH", path: "/campaigns/:id", description: "Pause/resume/edit campaign" },
  { method: "GET", path: "/messages", description: "List sent/queued messages" },
  { method: "POST", path: "/messages", description: "Queue an AI-generated message (Twilio/SendGrid)" },
  { method: "POST", path: "/unsubscribe", description: "Customer/prospect opt-out endpoint" },
]);