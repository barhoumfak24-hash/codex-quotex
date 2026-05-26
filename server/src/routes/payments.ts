import { makePlaceholderRouter } from "./_placeholder.js";

export const paymentsRoutes = makePlaceholderRouter("payments", [
  { method: "POST", path: "/deposits", description: "Create Stripe PaymentIntent for deposit" },
  { method: "GET", path: "/deposits/:id", description: "Get deposit" },
  { method: "GET", path: "/deposits", description: "List deposits (tenant or customer scoped)" },
  { method: "GET", path: "/receipts/:id", description: "Get receipt document" },
]);