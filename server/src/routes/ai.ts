import { Router } from "express";
import { aiParseIntake, aiPremiumEstimate, aiCarrierMatch, aiMarketingMessage } from "../services/ai/index.js";

// ALL AI is server-side. No model key ever crosses to the browser.
export const aiRoutes = Router();

aiRoutes.post("/parse-intake", async (req, res) => {
  try {
    const { rawDescription } = req.body ?? {};
    const out = await aiParseIntake(String(rawDescription ?? ""));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/premium-estimate", async (req, res) => {
  try {
    const { assetType, parsedData } = req.body ?? {};
    const out = await aiPremiumEstimate({ assetType, parsedData });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/carrier-match", async (req, res) => {
  try {
    const { assetType, parsedData, carriers } = req.body ?? {};
    const out = await aiCarrierMatch({ assetType, parsedData }, carriers ?? []);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/marketing-message", async (req, res) => {
  try {
    const { prospect, channel } = req.body ?? {};
    const out = await aiMarketingMessage(prospect, channel);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "ai_failed" });
  }
});