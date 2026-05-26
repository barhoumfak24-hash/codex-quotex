import { makePlaceholderRouter } from "./_placeholder.js";

export const carriersRoutes = makePlaceholderRouter("carriers", [
  { method: "GET", path: "/", description: "List carriers (master = all, agency = linked only)" },
  { method: "POST", path: "/", description: "Create carrier (master only)" },
  { method: "GET", path: "/:id", description: "Get carrier" },
  { method: "PATCH", path: "/:id", description: "Update carrier (master only)" },
  { method: "DELETE", path: "/:id", description: "Remove carrier (master only)" },
  { method: "POST", path: "/:id/link", description: "Link carrier to agency tenant" },
  { method: "POST", path: "/:id/unlink", description: "Unlink carrier from agency tenant" },
  { method: "GET", path: "/:id/claims-link", description: "Return carrier claims URL for filing" },
]);