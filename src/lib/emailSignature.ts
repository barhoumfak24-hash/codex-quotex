import type { User } from "@/types";

export interface EmailSignatureImage {
  name: string;
  dataUrl?: string;
}

export interface EmailSignatureBlock {
  text?: string;
  images?: EmailSignatureImage[];
  electronicSignature?: NonNullable<User["electronicSignature"]>;
}

const SIGNATURE_TOKEN_PREFIX = "[[quotex-email-signature:";
const SIGNATURE_TOKEN_SUFFIX = "]]";

export function emailSignatureBlockForUser(
  user: User,
  agencyLogo?: EmailSignatureImage | null
): EmailSignatureBlock | null {
  const text = (user.emailSignature ?? "").trim();
  const userImages = (user.emailSignatureImages ?? []).filter((img) => img.dataUrl);
  const images =
    userImages.length > 0
      ? userImages
      : agencyLogo?.dataUrl
      ? [agencyLogo]
      : [];
  const electronicSignature =
    user.emailSignatureIncludesEsignature && user.electronicSignature?.name?.trim()
      ? user.electronicSignature
      : undefined;
  if (!text && images.length === 0 && !electronicSignature) return null;
  return {
    text: text || undefined,
    images,
    electronicSignature,
  };
}

export function appendEmailSignatureBlock(body: string, block: EmailSignatureBlock | null): string {
  if (!block) return body;
  const payload = encodeURIComponent(JSON.stringify(block));
  return `${body.trimEnd()}\n\n${SIGNATURE_TOKEN_PREFIX}${payload}${SIGNATURE_TOKEN_SUFFIX}`;
}

export function splitEmailSignatureBody(body: string): {
  message: string;
  signature?: EmailSignatureBlock;
} {
  const start = body.indexOf(SIGNATURE_TOKEN_PREFIX);
  if (start !== -1) {
    const payloadStart = start + SIGNATURE_TOKEN_PREFIX.length;
    const end = body.indexOf(SIGNATURE_TOKEN_SUFFIX, payloadStart);
    if (end !== -1) {
      const raw = body.slice(payloadStart, end);
      try {
        const decoded = JSON.parse(decodeURIComponent(raw)) as EmailSignatureBlock;
        return {
          message: body.slice(0, start).trimEnd(),
          signature: decoded,
        };
      } catch {
        return { message: body };
      }
    }
  }

  return splitLegacySignatureBody(body);
}

function splitLegacySignatureBody(body: string): {
  message: string;
  signature?: EmailSignatureBlock;
} {
  const lines = body.split(/\r?\n/);
  const images: EmailSignatureImage[] = [];
  let electronicSignature: EmailSignatureBlock["electronicSignature"];
  const kept: string[] = [];

  for (const line of lines) {
    const image = line.match(/^\[Image:\s*(.+?)\]$/i);
    if (image) {
      images.push({ name: image[1].trim() });
      continue;
    }

    const esign = line.match(/^\[Electronic signature:\s*([^|\]]+)(?:\|\s*([^|\]]+))?(?:\|\s*(\d+)px)?\]$/i);
    if (esign) {
      electronicSignature = {
        name: esign[1].trim(),
        fontFamily: "cursive",
        fontSize: Number(esign[3]) || 34,
      };
      continue;
    }

    kept.push(line);
  }

  if (images.length === 0 && !electronicSignature) return { message: body };

  const cleaned = kept.join("\n").replace(/\n{2,}—\s*$/u, "").trimEnd();
  return {
    message: cleaned,
    signature: {
      images,
      electronicSignature,
    },
  };
}
