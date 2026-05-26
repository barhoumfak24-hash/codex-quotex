import { makePlaceholderRouter } from "./_placeholder.js";

export const statusRoutes = makePlaceholderRouter("status", [
  { method: "GET", path: "/", description: "List status events filtered by entity (tenant scoped)" },
  { method: "POST", path: "/", description: "Create status event (system/agent/AI/customer)" },
]);