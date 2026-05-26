import { makePlaceholderRouter } from "./_placeholder.js";

export const policiesRoutes = makePlaceholderRouter("policies", [
  { method: "GET", path: "/", description: "List policies (tenant scoped)" },
  { method: "POST", path: "/", description: "Create policy from approved quote" },
  { method: "GET", path: "/:id", description: "Policy detail w/ deposits, payments, docs, claims" },
  { method: "PATCH", path: "/:id", description: "Update policy (status, final premium, etc.)" },
  { method: "POST", path: "/:id/bind", description: "Mark bound" },
]);