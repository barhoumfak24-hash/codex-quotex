import { makePlaceholderRouter } from "./_placeholder.js";

export const masterRoutes = makePlaceholderRouter("master", [
  { method: "GET", path: "/analytics", description: "Platform-wide usage analytics" },
  { method: "GET", path: "/usage/ai", description: "AI message volume per agency" },
  { method: "GET", path: "/usage/sms", description: "SMS volume per agency" },
  { method: "GET", path: "/usage/email", description: "Email volume per agency" },
  { method: "POST", path: "/agencies/:id/users", description: "Add/remove user; triggers Stripe seat update" },
]);