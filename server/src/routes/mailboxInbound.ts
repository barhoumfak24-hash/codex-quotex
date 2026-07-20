import Busboy from "busboy";
import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import {
  ingestCarrierReply,
  verifyInboundWebhookSecret,
  type InboundCarrierReply,
} from "../services/carrierReplyRelay.js";

export const mailboxInboundRoutes = Router();

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

mailboxInboundRoutes.post("/sendgrid/:secret", async (req, res, next) => {
  if (!verifyInboundWebhookSecret(req.params.secret ?? "")) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  if (!req.is("multipart/form-data")) {
    return res.status(415).json({ ok: false, error: "multipart_required" });
  }

  try {
    const payload = await parseSendGridInbound(req);
    const result = await ingestCarrierReply(payload);
    // Acknowledge valid provider calls even when the route is stale or unknown.
    // Retrying cannot make an unaddressed message linkable.
    return res.status(200).json({ ok: true, status: result.status });
  } catch (error) {
    next(error);
  }
});

async function parseSendGridInbound(req: Request) {
  return new Promise<InboundCarrierReply>((resolve, reject) => {
    const fields = new Map<string, string>();
    const attachments: NonNullable<InboundCarrierReply["attachments"]> = [];
    let totalAttachmentBytes = 0;
    let settled = false;
    const parser = Busboy({
      headers: req.headers,
      limits: {
        fields: 100,
        files: 25,
        fieldSize: 2 * 1024 * 1024,
        fileSize: MAX_ATTACHMENT_BYTES,
      },
    });

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error("Inbound email could not be parsed."));
    };

    parser.on("field", (name, value) => {
      fields.set(name, value);
    });
    parser.on("file", (_fieldName, stream, info) => {
      const chunks: Buffer[] = [];
      let sizeBytes = 0;
      let truncated = false;
      stream.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
        totalAttachmentBytes += chunk.length;
        if (totalAttachmentBytes <= MAX_TOTAL_ATTACHMENT_BYTES) chunks.push(chunk);
      });
      stream.on("limit", () => {
        truncated = true;
      });
      stream.on("error", fail);
      stream.on("end", () => {
        if (truncated || totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) return;
        const fileType = info.mimeType || "application/octet-stream";
        attachments.push({
          id: `attachment_${randomUUID()}`,
          fileName: safeFileName(info.filename),
          fileType,
          sizeBytes,
          dataUrl: `data:${fileType};base64,${Buffer.concat(chunks).toString("base64")}`,
        });
      });
    });
    parser.on("error", fail);
    parser.on("finish", () => {
      if (settled) return;
      settled = true;
      const envelope = parseEnvelope(fields.get("envelope"));
      resolve({
        from: fields.get("from") ?? envelope.from ?? "",
        to: uniqueEmails([...(envelope.to ?? []), ...splitRecipients(fields.get("to"))]),
        cc: uniqueEmails(splitRecipients(fields.get("cc"))),
        subject: fields.get("subject"),
        text: fields.get("text"),
        html: fields.get("html"),
        headers: fields.get("headers"),
        envelope: fields.get("envelope"),
        attachments,
      });
    });
    req.pipe(parser);
  });
}

function parseEnvelope(value: string | undefined): { from?: string; to?: string[] } {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as { from?: unknown; to?: unknown };
    return {
      from: typeof parsed.from === "string" ? parsed.from : undefined,
      to: Array.isArray(parsed.to) ? parsed.to.filter((row): row is string => typeof row === "string") : undefined,
    };
  } catch {
    return {};
  }
}

function splitRecipients(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,;]/)
    .map((row) => row.trim())
    .filter(Boolean);
}

function uniqueEmails(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function safeFileName(value: string): string {
  const cleaned = (value || "attachment").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned.slice(0, 260) || "attachment";
}
