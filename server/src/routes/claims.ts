import { makePlaceholderRouter } from "./_placeholder.js";

export const claimsRoutes = makePlaceholderRouter("claims", [
  { method: "GET", path: "/", description: "List claims (tenant or customer scoped)" },
  { method: "POST", path: "/", description: "Create claim record (carrier handles intake externally)" },
  { method: "GET", path: "/:id", description: "Get claim" },
  { method: "PATCH", path: "/:id", description: "Update claim status, external ref" },
]);