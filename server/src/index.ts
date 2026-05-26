// =====================================================================
// Quotex Insurance — backend entry point (skeleton).
//
// This server is a route-complete scaffold. It compiles and runs, but
// the handlers return 501-style placeholders. Wire up Prisma, real auth,
// Stripe webhook signatures, etc. before going to production.
// =====================================================================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authRoutes } from "./routes/auth.js";
import { tenantsRoutes } from "./routes/tenants.js";
import { customersRoutes } from "./routes/customers.js";
import { quotesRoutes } from "./routes/quotes.js";
import { aiRoutes } from "./routes/ai.js";
import { prospectsRoutes } from "./routes/prospects.js";
import { assetsRoutes } from "./routes/assets.js";
import { policiesRoutes } from "./routes/policies.js";
import { paymentsRoutes } from "./routes/payments.js";
import { documentsRoutes } from "./routes/documents.js";
import { carriersRoutes } from "./routes/carriers.js";
import { claimsRoutes } from "./routes/claims.js";
import { marketingRoutes } from "./routes/marketing.js";
import { renewalsRoutes } from "./routes/renewals.js";
import { statusRoutes } from "./routes/status.js";
import { notesRoutes } from "./routes/notes.js";
import { masterRoutes } from "./routes/master.js";
import { stripeRoutes } from "./routes/stripe.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Sensible global rate limit — refine per-route below.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 240,
    standardHeaders: "draft-7",
  })
);

// Stricter limits for sensitive endpoints
const strict = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-7" });

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/tenants", tenantsRoutes);
app.use("/api/customers", customersRoutes);
app.use("/api/quotes", strict, quotesRoutes);
app.use("/api/ai", strict, aiRoutes);
app.use("/api/prospects", prospectsRoutes);
app.use("/api/assets", assetsRoutes);
app.use("/api/policies", policiesRoutes);
app.use("/api/payments", strict, paymentsRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/carriers", carriersRoutes);
app.use("/api/claims", claimsRoutes);
app.use("/api/marketing", strict, marketingRoutes);
app.use("/api/renewals", renewalsRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/master", masterRoutes);
app.use("/api/stripe", stripeRoutes);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Quotex API listening on http://localhost:${port}`);
});