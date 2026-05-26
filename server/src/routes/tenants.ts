import { makePlaceholderRouter } from "./_placeholder.js";

export const tenantsRoutes = makePlaceholderRouter("tenants", [
  { method: "GET", path: "/", description: "List agencies (master only)" },
  { method: "POST", path: "/", description: "Create agency (master only)" },
  { method: "GET", path: "/:id", description: "Get agency by id" },
  { method: "PATCH", path: "/:id", description: "Update agency" },
  { method: "DELETE", path: "/:id", description: "Deactivate agency" },
  { method: "PATCH", path: "/:id/tier", description: "Set subscription tier" },
]);