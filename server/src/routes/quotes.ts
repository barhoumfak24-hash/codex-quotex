import { Router } from "express";
import { z } from "zod";
import { runServerCarrierBindingProvider } from "../services/carrierBindingProviders.js";
import { runServerCarrierQuoteProvider } from "../services/quoteProviders.js";

const carrierQuoteSchema = z.object({
  carrier: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    quotingApi: z
      .object({
        provider: z.string().optional(),
        endpoint: z.string().optional(),
        status: z.enum(["not_configured", "configured", "connected", "error"]),
      })
      .optional(),
  }),
  session: z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    customerId: z.string().optional(),
    prospectId: z.string().optional(),
    assetId: z.string().optional(),
    assetType: z.string().min(1),
    estimatedValue: z.number().optional(),
    state: z.string().optional(),
    lineOfBusiness: z.enum(["personal", "commercial"]).optional(),
    publicFields: z.record(z.unknown()).optional(),
    questionnaireResponses: z.record(z.string()).optional(),
    assetDetails: z.record(z.string()).optional(),
  }),
});

const carrierBindingSchema = z.object({
  carrier: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    agentPortalUrl: z.string().optional(),
    bindingApi: z
      .object({
        provider: z.string().optional(),
        endpoint: z.string().optional(),
        status: z.enum(["not_configured", "configured", "connected", "error"]),
      })
      .optional(),
    quotingApi: z
      .object({
        provider: z.string().optional(),
        endpoint: z.string().optional(),
        status: z.enum(["not_configured", "configured", "connected", "error"]),
      })
      .optional(),
  }),
  session: z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    customerId: z.string().optional(),
    prospectId: z.string().optional(),
    assetId: z.string().optional(),
    assetType: z.string().min(1),
    state: z.string().optional(),
    lineOfBusiness: z.enum(["personal", "commercial"]).optional(),
    publicFields: z.record(z.unknown()).optional(),
    questionnaireResponses: z.record(z.string()).optional(),
    assetDetails: z.record(z.string()).optional(),
  }),
  quote: z.object({
    carrierId: z.string().min(1),
    premium: z.number(),
    providerTrace: z
      .object({
        provider: z.enum(["ezlynx_qas", "carrier_direct", "demo_adapter"]),
        requestId: z.string(),
        executionId: z.string().optional(),
        providerLabel: z.string(),
      })
      .optional(),
  }),
  policy: z
    .object({
      id: z.string().min(1),
      customerId: z.string().min(1),
      assetId: z.string().min(1),
      policyNumber: z.string().optional(),
      finalPremium: z.number().optional(),
      premiumEstimate: z.number().optional(),
      effectiveDate: z.string().optional(),
      renewalDate: z.string().optional(),
      department: z.enum(["personal", "commercial"]).optional(),
    })
    .passthrough(),
  implementedById: z.string().min(1),
});

export const quotesRoutes = Router();

const routeMap = [
  { method: "POST", path: "/", description: "Create a new quote request (auth required, rate limited)" },
  { method: "POST", path: "/carrier/run", description: "Run one carrier quote provider request server-side" },
  { method: "POST", path: "/carrier/bind", description: "Bind / issue one selected carrier quote server-side" },
  { method: "GET", path: "/:id", description: "Get quote (tenant scoped)" },
  { method: "PATCH", path: "/:id", description: "Update quote (agent edit)" },
  { method: "POST", path: "/:id/submit", description: "Submit to agent for review" },
  { method: "POST", path: "/:id/abandon", description: "Mark quote as abandoned and create prospect" },
];

quotesRoutes.get("/", (_req, res) => res.json({ resource: "quotes", endpoints: routeMap }));

quotesRoutes.post("/carrier/run", async (req, res) => {
  const parsed = carrierQuoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_quote_provider_request",
      details: parsed.error.flatten(),
    });
  }
  try {
    const result = await runServerCarrierQuoteProvider(parsed.data);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({
      error: "carrier_quote_provider_failed",
      message: err instanceof Error ? err.message : "Carrier quote provider failed.",
    });
  }
});

quotesRoutes.post("/carrier/bind", async (req, res) => {
  const parsed = carrierBindingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_carrier_binding_request",
      details: parsed.error.flatten(),
    });
  }
  try {
    const result = await runServerCarrierBindingProvider(parsed.data);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({
      error: "carrier_binding_provider_failed",
      message: err instanceof Error ? err.message : "Carrier binding provider failed.",
    });
  }
});

for (const endpoint of routeMap.filter((row) => !["/", "/carrier/run", "/carrier/bind"].includes(row.path))) {
  const method = endpoint.method.toLowerCase() as "get" | "post" | "patch";
  quotesRoutes[method](endpoint.path, (_req, res) =>
    res.status(501).json({
      error: "not_implemented",
      resource: "quotes",
      endpoint: `${endpoint.method} ${endpoint.path}`,
      description: endpoint.description,
    })
  );
}
