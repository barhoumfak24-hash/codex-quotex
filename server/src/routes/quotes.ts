import { makePlaceholderRouter } from "./_placeholder.js";

export const quotesRoutes = makePlaceholderRouter("quotes", [
  { method: "POST", path: "/", description: "Create a new quote request (auth required, rate limited)" },
  { method: "GET", path: "/:id", description: "Get quote (tenant scoped)" },
  { method: "PATCH", path: "/:id", description: "Update quote (agent edit)" },
  { method: "POST", path: "/:id/submit", description: "Submit to agent for review" },
  { method: "POST", path: "/:id/abandon", description: "Mark quote as abandoned → create prospect" },
]);