import { makePlaceholderRouter } from "./_placeholder.js";

export const renewalsRoutes = makePlaceholderRouter("renewals", [
  { method: "GET", path: "/", description: "List renewals (tenant scoped)" },
  { method: "POST", path: "/:id/notify-customer", description: "Send AI renewal reminder to customer" },
  { method: "POST", path: "/:id/notify-agent", description: "Notify assigned agent" },
  { method: "PATCH", path: "/:id", description: "Update renewal status" },
]);