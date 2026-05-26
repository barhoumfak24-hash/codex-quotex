import { makePlaceholderRouter } from "./_placeholder.js";

export const assetsRoutes = makePlaceholderRouter("assets", [
  { method: "GET", path: "/", description: "List assets (tenant or customer scoped)" },
  { method: "POST", path: "/", description: "Create asset" },
  { method: "GET", path: "/:id", description: "Get asset detail with policies + docs + timeline" },
  { method: "PATCH", path: "/:id", description: "Update asset" },
]);