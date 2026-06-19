import { Router } from "express";
import {
  aiCarrierMatch,
  aiDraftCampaign,
  aiDraftPamphlet,
  aiEmailSubject,
  aiEnhanceMessage,
  aiEnrichAsset,
  aiExtractContactFromFile,
  aiExtractPolicyFromFile,
  aiMarketingMessage,
  aiMarketingCreative,
  aiPortalAssistant,
  aiParseCarrierAppetite,
  aiParseIntake,
  aiPremiumEstimate,
} from "../services/ai/index.js";
import { generateOpenAiImage } from "../services/ai/provider.js";

// ALL AI is server-side. No model key ever crosses to the browser.
export const aiRoutes = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(res: import("express").Response, message: string) {
  return res.status(400).json({ error: "bad_request", message });
}

aiRoutes.post("/parse-intake", async (req, res) => {
  try {
    const { rawDescription } = req.body ?? {};
    if (typeof rawDescription !== "string" || rawDescription.trim().length === 0) {
      return badRequest(res, "rawDescription is required");
    }
    const out = await aiParseIntake(String(rawDescription ?? ""));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/premium-estimate", async (req, res) => {
  try {
    const { assetType, parsedData } = req.body ?? {};
    if (typeof assetType !== "string") return badRequest(res, "assetType is required");
    if (!isRecord(parsedData)) return badRequest(res, "parsedData must be an object");
    const out = await aiPremiumEstimate({ assetType, parsedData });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/carrier-match", async (req, res) => {
  try {
    const { assetType, parsedData, carriers } = req.body ?? {};
    if (typeof assetType !== "string") return badRequest(res, "assetType is required");
    if (!isRecord(parsedData)) return badRequest(res, "parsedData must be an object");
    if (!Array.isArray(carriers)) return badRequest(res, "carriers must be an array");
    const out = await aiCarrierMatch({ assetType, parsedData }, carriers ?? []);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/marketing-message", async (req, res) => {
  try {
    const { prospect, channel } = req.body ?? {};
    if (!isRecord(prospect)) return badRequest(res, "prospect must be an object");
    if (channel !== "email" && channel !== "sms") return badRequest(res, "channel must be email or sms");
    const name = typeof prospect.name === "string" ? prospect.name : "";
    const assetType = typeof prospect.assetType === "string" ? prospect.assetType : "";
    if (!name || !assetType) return badRequest(res, "prospect.name and prospect.assetType are required");
    const out = await aiMarketingMessage({ name, assetType }, channel);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/email-subject", async (req, res) => {
  try {
    const { body, contactName, context } = req.body ?? {};
    if (typeof body !== "string" || body.trim().length === 0) return badRequest(res, "body is required");
    const out = await aiEmailSubject({
      body,
      contactName: typeof contactName === "string" ? contactName : undefined,
      context: typeof context === "string" ? context : undefined,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/enhance-message", async (req, res) => {
  try {
    const { body, channel, contactName } = req.body ?? {};
    if (typeof body !== "string" || body.trim().length === 0) return badRequest(res, "body is required");
    if (channel !== "email" && channel !== "sms") return badRequest(res, "channel must be email or sms");
    const out = await aiEnhanceMessage({
      body,
      channel,
      contactName: typeof contactName === "string" ? contactName : undefined,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/extract-contact", async (req, res) => {
  try {
    const { fileName, fileType, text, dataUrl } = req.body ?? {};
    if (typeof fileName !== "string" || fileName.trim().length === 0) return badRequest(res, "fileName is required");
    const out = await aiExtractContactFromFile({
      fileName,
      fileType: typeof fileType === "string" ? fileType : undefined,
      text: typeof text === "string" ? text : undefined,
      dataUrl: typeof dataUrl === "string" ? dataUrl : undefined,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/extract-policy", async (req, res) => {
  try {
    const { fileName, fileType, text, carrierNames } = req.body ?? {};
    if (typeof fileName !== "string" || fileName.trim().length === 0) return badRequest(res, "fileName is required");
    const out = await aiExtractPolicyFromFile({
      fileName,
      fileType: typeof fileType === "string" ? fileType : undefined,
      text: typeof text === "string" ? text : undefined,
      carrierNames: Array.isArray(carrierNames)
        ? carrierNames.filter((item): item is string => typeof item === "string")
        : undefined,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/enrich-asset", async (req, res) => {
  try {
    const { assetType, seed } = req.body ?? {};
    if (typeof assetType !== "string") return badRequest(res, "assetType is required");
    if (!isRecord(seed)) return badRequest(res, "seed must be an object");
    const out = await aiEnrichAsset({ assetType, seed });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/parse-carrier-appetite", async (req, res) => {
  try {
    const { fileName, text, carrier } = req.body ?? {};
    if (typeof fileName !== "string" && typeof text !== "string") {
      return badRequest(res, "fileName or text is required");
    }
    const out = await aiParseCarrierAppetite({
      fileName: typeof fileName === "string" ? fileName : undefined,
      text: typeof text === "string" ? text : undefined,
      carrierName: isRecord(carrier) && typeof carrier.name === "string" ? carrier.name : undefined,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/draft-campaign", async (req, res) => {
  try {
    const { prompt, agencyName, senderName, signOff, fallback } = req.body ?? {};
    if (typeof prompt !== "string" || prompt.trim().length === 0) return badRequest(res, "prompt is required");
    const out = await aiDraftCampaign({
      prompt,
      agencyName: typeof agencyName === "string" ? agencyName : undefined,
      senderName: typeof senderName === "string" ? senderName : undefined,
      signOff: typeof signOff === "string" ? signOff : undefined,
      fallback,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/marketing-creative", async (req, res) => {
  try {
    const { prompt, agencyName, senderName, signOff } = req.body ?? {};
    if (typeof prompt !== "string" || prompt.trim().length === 0) return badRequest(res, "prompt is required");
    const out = await aiMarketingCreative({
      prompt,
      agencyName: typeof agencyName === "string" ? agencyName : undefined,
      senderName: typeof senderName === "string" ? senderName : undefined,
      signOff: typeof signOff === "string" ? signOff : undefined,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/draft-pamphlet", async (req, res) => {
  try {
    const { prompt, agencyName, campaignDescription, heroImagePrompt, accent, tone } = req.body ?? {};
    if (typeof prompt !== "string" || prompt.trim().length === 0) return badRequest(res, "prompt is required");
    const out = await aiDraftPamphlet({
      prompt,
      agencyName: typeof agencyName === "string" ? agencyName : undefined,
      campaignDescription: typeof campaignDescription === "string" ? campaignDescription : undefined,
      heroImagePrompt: typeof heroImagePrompt === "string" ? heroImagePrompt : undefined,
      accent: typeof accent === "string" ? accent : undefined,
      tone: typeof tone === "string" ? tone : undefined,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/portal-assistant", async (req, res) => {
  try {
    const { question, role, history, localAnswer, knowledge } = req.body ?? {};
    if (typeof question !== "string" || question.trim().length === 0) return badRequest(res, "question is required");
    if (typeof localAnswer !== "string" || typeof knowledge !== "string") {
      return badRequest(res, "localAnswer and knowledge are required");
    }
    const out = await aiPortalAssistant({
      question,
      role: typeof role === "string" ? role : undefined,
      history: Array.isArray(history) ? history : undefined,
      localAnswer,
      knowledge,
    });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.get("/pamphlet-image", async (req, res) => {
  try {
    const prompt = typeof req.query.prompt === "string" ? req.query.prompt : "";
    if (!prompt.trim()) return badRequest(res, "prompt is required");
    const landscape = Number(req.query.width) > Number(req.query.height);
    const image = await generateOpenAiImage({
      prompt,
      size: landscape ? "1536x1024" : "1024x1536",
    });
    if (!image) {
      res.status(503).json({ error: "image_provider_unconfigured" });
      return;
    }
    res.setHeader("content-type", image.mimeType);
    res.setHeader("cache-control", "private, max-age=86400");
    res.end(image.bytes);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});
