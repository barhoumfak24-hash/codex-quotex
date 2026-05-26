import { makePlaceholderRouter } from "./_placeholder.js";

export const prospectsRoutes = makePlaceholderRouter("prospects", [
  { method: "GET", path: "/", description: "List prospects in tenant" },
  { method: "GET", path: "/:id", description: "Get prospect with AI summary, docs, messages" },
  { method: "PATCH", path: "/:id", description: "Update prospect (status, assigned agent, notes)" },
  { method: "POST", path: "/:id/convert", description: "Convert prospect → customer" },
  { method: "POST", path: "/:id/send-message", description: "Trigger AI-generated email/SMS" },
]);