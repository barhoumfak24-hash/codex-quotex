import { makePlaceholderRouter } from "./_placeholder.js";

export const notesRoutes = makePlaceholderRouter("notes", [
  { method: "GET", path: "/", description: "List notes for customer/prospect/policy" },
  { method: "POST", path: "/", description: "Create note (internal or customer-visible)" },
]);