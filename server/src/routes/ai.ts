import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { assertBodyTenantMatchesAuth } from "../middleware/auth.js";
import {
  aiAnalyzePropertyImagery,
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
  aiMapAcordFields,
  aiMapUniversalDocumentFields,
  aiPortalAssistant,
  aiParseCarrierReply,
  aiSortIntent,
  aiParseCarrierAppetite,
  aiParseIntake,
  aiPremiumEstimate,
} from "../services/ai/index.js";
import { publicAiAgentManifest } from "../services/ai/agents.js";
import { generateOpenAiImage } from "../services/ai/provider.js";

// ALL AI is server-side. No model key ever crosses to the browser.
export const aiRoutes = Router();

const DEFAULT_AI_STRING_LIMIT = 50_000;
const AI_STRING_LIMITS: Record<string, number> = {
  body: 20_000,
  dataurl: 8_500_000,
  filename: 300,
  knowledge: 80_000,
  localanswer: 80_000,
  prompt: 10_000,
  question: 8_000,
  rawdescription: 20_000,
  text: 80_000,
};

aiRoutes.use(rejectOversizedAiInput);
aiRoutes.use((req, res, next) => {
  if (!assertBodyTenantMatchesAuth(req, res)) return;
  next();
});

aiRoutes.get("/agents", (_req, res) => {
  res.json({ agents: publicAiAgentManifest() });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(res: import("express").Response, message: string) {
  return res.status(400).json({ error: "bad_request", message });
}

function rejectOversizedAiInput(req: Request, res: Response, next: NextFunction) {
  const violation = findOversizedString(req.body);
  if (violation) {
    return res.status(413).json({
      error: "ai_payload_too_large",
      field: violation.path,
      maxCharacters: violation.max,
    });
  }
  next();
}

function findOversizedString(
  value: unknown,
  path: string[] = [],
  seen = new WeakSet<object>()
): { path: string; max: number } | null {
  if (typeof value === "string") {
    const key = path[path.length - 1]?.toLowerCase() ?? "";
    const max = AI_STRING_LIMITS[key] ?? DEFAULT_AI_STRING_LIMIT;
    return value.length > max ? { path: path.join(".") || "body", max } : null;
  }
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const violation = findOversizedString(value[index], [...path, String(index)], seen);
      if (violation) return violation;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const violation = findOversizedString(child, [...path, key], seen);
    if (violation) return violation;
  }
  return null;
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
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "AI mapping failed.";
    res.status(500).json({ error: "ai_failed", message });
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
    const { assetType, seed, targetQuestions } = req.body ?? {};
    if (typeof assetType !== "string") return badRequest(res, "assetType is required");
    if (!isRecord(seed)) return badRequest(res, "seed must be an object");
    const out = await aiEnrichAsset({ assetType, seed, targetQuestions });
    res.json(out);
  } catch {
    res.status(500).json({ error: "ai_failed" });
  }
});

aiRoutes.post("/property-imagery", async (req, res) => {
  try {
    const { address, lat, lon, displayName, provider } = req.body ?? {};
    if (typeof address !== "string" || address.trim().length === 0) return badRequest(res, "address is required");
    const nLat = Number(lat);
    const nLon = Number(lon);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return badRequest(res, "lat and lon are required");
    const out = await aiAnalyzePropertyImagery({
      address,
      lat: nLat,
      lon: nLon,
      displayName: typeof displayName === "string" ? displayName : undefined,
      provider: provider === "census" ? "census" : "google",
    });
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

aiRoutes.post("/parse-carrier-reply", async (req, res) => {
  try {
    const { submission, email } = req.body ?? {};
    if (!isRecord(email)) return badRequest(res, "email must be an object");
    const cleanEmail = {
      subject: typeof email.subject === "string" ? email.subject : undefined,
      text: typeof email.text === "string" ? email.text : undefined,
      html: typeof email.html === "string" ? email.html : undefined,
      attachments: Array.isArray(email.attachments)
        ? email.attachments.filter(isRecord).map((attachment) => ({
            id: typeof attachment.id === "string" ? attachment.id : undefined,
            fileName: typeof attachment.fileName === "string" ? attachment.fileName : undefined,
            fileType: typeof attachment.fileType === "string" ? attachment.fileType : undefined,
            description: typeof attachment.description === "string" ? attachment.description : undefined,
          }))
        : undefined,
    };
    const out = await aiParseCarrierReply({
      submission: isRecord(submission) ? submission : undefined,
      email: cleanEmail,
    });
    res.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Carrier reply parsing failed.";
    res.status(500).json({ error: "ai_failed", message });
  }
});

aiRoutes.post("/document-map", async (req, res) => {
  try {
    const { document, fields, dossier, attachments } = req.body ?? {};
    if (!Array.isArray(fields)) return badRequest(res, "fields must be an array");
    if (!isRecord(dossier)) return badRequest(res, "dossier must be an object");
    const cleanFields = fields
      .filter(isRecord)
      .map((field) => ({
        id: typeof field.id === "string" ? field.id : undefined,
        label: typeof field.label === "string" ? field.label : "",
        acordFieldKey: typeof field.acordFieldKey === "string" ? field.acordFieldKey : undefined,
        acordFieldLabels: Array.isArray(field.acordFieldLabels)
          ? field.acordFieldLabels.filter((label): label is string => typeof label === "string")
          : undefined,
        required: field.required === true,
        kind: typeof field.kind === "string" ? field.kind : typeof field.type === "string" ? field.type : undefined,
        page: typeof field.page === "number" ? field.page : undefined,
        rect: isRecord(field.rect)
          ? {
              x: Number(field.rect.x) || 0,
              y: Number(field.rect.y) || 0,
              width: Number(field.rect.width) || 0,
              height: Number(field.rect.height) || 0,
            }
          : undefined,
      }))
      .filter((field) => field.label.trim().length > 0);
    if (cleanFields.length === 0) return badRequest(res, "at least one field label is required");
    const cleanAttachments = Array.isArray(attachments)
      ? attachments
          .filter(isRecord)
          .map((attachment) => ({
            fileName: typeof attachment.fileName === "string" ? attachment.fileName : undefined,
            mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : undefined,
            dataUrl: typeof attachment.dataUrl === "string" ? attachment.dataUrl : "",
          }))
          .filter((attachment) => attachment.dataUrl)
      : undefined;
    const out = await aiMapUniversalDocumentFields({
      document: isRecord(document)
        ? {
            fileName: typeof document.fileName === "string" ? document.fileName : undefined,
            fileType: typeof document.fileType === "string" ? document.fileType : undefined,
            documentName: typeof document.documentName === "string" ? document.documentName : undefined,
            kind: typeof document.kind === "string" ? document.kind : undefined,
          }
        : undefined,
      fields: cleanFields,
      dossier,
      attachments: cleanAttachments,
    });
    res.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "AI document mapping failed.";
    res.status(500).json({ error: "ai_failed", message });
  }
});

aiRoutes.post("/acord-map", async (req, res) => {
  try {
    const { template, fields, dossier, intent } = req.body ?? {};
    if (!Array.isArray(fields)) return badRequest(res, "fields must be an array");
    if (!isRecord(dossier)) return badRequest(res, "dossier must be an object");
    const cleanFields = fields
      .filter(isRecord)
      .map((field) => ({
        id: typeof field.id === "string" ? field.id : undefined,
        label: typeof field.label === "string" ? field.label : "",
        acordFieldKey: typeof field.acordFieldKey === "string" ? field.acordFieldKey : undefined,
        acordFieldLabels: Array.isArray(field.acordFieldLabels)
          ? field.acordFieldLabels.filter((label): label is string => typeof label === "string")
          : undefined,
        required: field.required === true,
        kind: typeof field.kind === "string" ? field.kind : undefined,
        page: typeof field.page === "number" ? field.page : undefined,
      }))
      .filter((field) => field.label.trim().length > 0);
    if (cleanFields.length === 0) return badRequest(res, "at least one field label is required");
    const cleanTemplate = isRecord(template)
      ? {
          documentName: typeof template.documentName === "string" ? template.documentName : undefined,
          fileName: typeof template.fileName === "string" ? template.fileName : undefined,
          formNumber: typeof template.formNumber === "string" ? template.formNumber : undefined,
        }
      : undefined;
    const out = await aiMapAcordFields({
      template: cleanTemplate,
      fields: cleanFields,
      dossier,
      intent: intent === "questionnaire_prefill" ? "questionnaire_prefill" : "document_autofill",
    });
    res.json(out);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "AI mapping failed.";
    res.status(500).json({ error: "ai_failed", message });
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

aiRoutes.post("/sort-intent", async (req, res) => {
  try {
    const { query, context } = req.body ?? {};
    if (typeof query !== "string" || query.trim().length === 0) return badRequest(res, "query is required");
    const out = await aiSortIntent({
      query,
      context: typeof context === "string" ? context : undefined,
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
      size: landscape ? "1792x1024" : "1024x1792",
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
