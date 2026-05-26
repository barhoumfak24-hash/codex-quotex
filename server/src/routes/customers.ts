import { makePlaceholderRouter } from "./_placeholder.js";

export const customersRoutes = makePlaceholderRouter("customers", [
  { method: "GET", path: "/me", description: "Current customer profile" },
  { method: "PATCH", path: "/me", description: "Update profile (name, phone, addresses, opt-ins)" },
  { method: "GET", path: "/", description: "List customers in tenant (agency users)" },
  { method: "GET", path: "/:id", description: "Get customer by id (tenant scoped)" },
  { method: "PATCH", path: "/:id", description: "Update customer (agent edit)" },
]);