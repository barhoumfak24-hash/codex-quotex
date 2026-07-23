import { Router, type Response } from "express";
import { z } from "zod";
import {
  readPublicQuestionnaire,
  updatePublicQuestionnaire,
} from "../services/questionnaireAccess.js";

export const questionnairesRoutes = Router();

const responseSchema = z.object({
  responses: z.record(z.string().max(10_000)).refine((value) => Object.keys(value).length <= 250),
});

questionnairesRoutes.get("/:accessId", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const accessId = normalizeAccessId(req.params.accessId);
    if (!accessId) return res.status(400).json({ found: false, error: "invalid_questionnaire_link" });
    const questionnaire = await readPublicQuestionnaire(accessId);
    if (!questionnaire) return res.status(404).json({ found: false, error: "questionnaire_not_found" });
    return res.json({ found: true, questionnaire });
  } catch (error) {
    next(error);
  }
});

questionnairesRoutes.patch("/:accessId", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const accessId = normalizeAccessId(req.params.accessId);
    if (!accessId) return res.status(400).json({ ok: false, error: "invalid_questionnaire_link" });
    const parsed = responseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_questionnaire_answers" });
    const result = await updatePublicQuestionnaire(accessId, parsed.data.responses, false);
    if (!result.ok) return mutationError(res, result.reason);
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

questionnairesRoutes.post("/:accessId/submit", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const accessId = normalizeAccessId(req.params.accessId);
    if (!accessId) return res.status(400).json({ ok: false, error: "invalid_questionnaire_link" });
    const parsed = responseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_questionnaire_answers" });
    const result = await updatePublicQuestionnaire(accessId, parsed.data.responses, true);
    if (!result.ok) return mutationError(res, result.reason);
    if (result.questionnaire.lineOfBusiness !== "commercial" && result.missingRequired.length > 0) {
      return res.status(422).json({
        ok: false,
        error: "required_answers_missing",
        missingRequired: result.missingRequired,
      });
    }
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

function normalizeAccessId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  return /^[a-z0-9_-]{12,180}$/i.test(normalized) ? normalized : "";
}

function mutationError(
  res: Response,
  reason: "not_found" | "state_unavailable" | "conflict"
) {
  if (reason === "not_found") return res.status(404).json({ ok: false, error: "questionnaire_not_found" });
  return res.status(503).json({ ok: false, error: "questionnaire_temporarily_unavailable" });
}
