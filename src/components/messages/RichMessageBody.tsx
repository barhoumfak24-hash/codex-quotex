import { useMemo, useState, type ReactNode } from "react";
import { Check, ImageOff, ShieldCheck } from "lucide-react";
import {
  MarketingPamphletCard,
  type MarketingPamphletRenderData,
  type PamphletThemeId,
} from "@/components/marketing/MarketingPamphletCard";
import { electronicSignaturePreviewStyle } from "@/lib/electronicSignature";
import { sanitizeEmailHtml, stripEmailHtml } from "@/lib/emailHtml";
import { splitEmailSignatureBody, type EmailSignatureBlock } from "@/lib/emailSignature";
import { api } from "@/lib/api";
import type { Communication } from "@/types";

const MARKETING_EMAIL_BODY_MARKER = "[[quotex:marketing-email-body]]";
const MARKETING_PAMPHLET_MARKER = "[[quotex:marketing-pamphlet]]";
const MARKETING_PAMPHLET_DATA_PREFIX = "[[quotex:marketing-pamphlet-data:";
const MARKETING_PAMPHLET_DATA_SUFFIX = "]]";
const MARKETING_CTA_CLASSNAME = "marketing-cta-link";

type RenderableCommunication = Pick<
  Communication,
  | "bodyHtml"
  | "mailboxOrigin"
  | "direction"
  | "externalRecipientName"
  | "externalRecipientEmail"
  | "mailboxAccount"
  | "subject"
  | "to"
  | "createdAt"
  | "snippet"
  | "mailboxLabels"
  | "rawMimeRef"
  | "messageIdHeader"
>;

export function RichMessageBody({
  body,
  tenantId,
  message,
}: {
  body: string;
  tenantId?: string;
  message?: RenderableCommunication;
}) {
  if (message?.mailboxOrigin === "provider_sync" && message.bodyHtml?.trim()) {
    return <ProviderEmailMessage body={body} message={message} />;
  }

  const { message: textMessage, signature } = splitEmailSignatureBody(body);
  const marketingSections = parseMarketingCampaignSections(textMessage);

  if (marketingSections) {
    return (
      <MarketingCampaignMessage
        emailBody={marketingSections.emailBody}
        pamphletBody={marketingSections.pamphletBody}
        pamphletData={marketingSections.pamphletData}
        signature={signature}
        tenantId={tenantId}
      />
    );
  }

  return (
    <div className="space-y-2">
      {textMessage.trim() && <MessageBlocks body={textMessage} />}
      <EmailSignaturePreview signature={signature} />
    </div>
  );
}

function ProviderEmailMessage({
  body,
  message,
}: {
  body: string;
  message: RenderableCommunication;
}) {
  const [showImages, setShowImages] = useState(false);
  const srcDoc = useMemo(
    () => sanitizeEmailHtml(message.bodyHtml ?? "", { allowRemoteImages: showImages }),
    [message.bodyHtml, showImages]
  );
  const fallback = stripEmailHtml(message.bodyHtml ?? body);
  const from =
    message.direction === "inbound"
      ? message.externalRecipientName || message.externalRecipientEmail || "External sender"
      : message.mailboxAccount || "You";
  const to = (message.to && message.to.length > 0 ? message.to : message.externalRecipientEmail ? [message.externalRecipientEmail] : []).join(", ");
  return (
    <div className="overflow-hidden rounded-md border border-ink-200 bg-white text-ink-950">
      <div className="border-b border-ink-100 bg-ink-50/70 px-3 py-2 text-[11px] text-ink-600">
        <div className="grid gap-1 sm:grid-cols-[4.5rem_1fr]">
          <span className="font-semibold uppercase tracking-wider text-ink-400">From</span>
          <span className="min-w-0 break-words">{from}</span>
          {to && (
            <>
              <span className="font-semibold uppercase tracking-wider text-ink-400">To</span>
              <span className="min-w-0 break-words">{to}</span>
            </>
          )}
          {message.subject && (
            <>
              <span className="font-semibold uppercase tracking-wider text-ink-400">Subject</span>
              <span className="min-w-0 break-words">{message.subject}</span>
            </>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
            <ShieldCheck className="h-3 w-3" />
            Sandboxed email HTML
          </span>
          {(message.mailboxLabels ?? []).slice(0, 4).map((label) => (
            <span key={label} className="rounded-full bg-white px-2 py-0.5 text-ink-500 ring-1 ring-ink-100">
              {label}
            </span>
          ))}
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded border border-ink-200 bg-white px-2 py-1 font-medium text-ink-700 transition hover:border-gold-300 hover:text-ink-950"
            onClick={() => setShowImages((current) => !current)}
          >
            <ImageOff className="h-3 w-3" />
            {showImages ? "Hide remote images" : "Show remote images"}
          </button>
        </div>
      </div>
      <iframe
        title={message.subject ? `Email body: ${message.subject}` : "Email body"}
        sandbox=""
        srcDoc={srcDoc}
        className="block h-[min(560px,60vh)] w-full bg-white"
      />
      {!message.bodyHtml?.trim() && fallback && (
        <div className="border-t border-ink-100 p-3 text-sm">
          <MessageBlocks body={fallback} />
        </div>
      )}
    </div>
  );
}

function MarketingCampaignMessage({
  emailBody,
  pamphletBody,
  pamphletData,
  signature,
  tenantId,
}: {
  emailBody: string;
  pamphletBody: string;
  pamphletData?: MarketingPamphletRenderData;
  signature?: EmailSignatureBlock;
  tenantId?: string;
}) {
  const agency = tenantId ? api.agencies.get(tenantId) : undefined;
  return (
    <div className="space-y-4 text-ink-900">
      {pamphletData ? (
        <MarketingPamphletCard data={pamphletData} agency={agency} logoUrl={agency?.logoUrl || undefined} />
      ) : pamphletBody.trim() ? (
        <div className="space-y-2">
          <MessageBlocks body={pamphletBody} />
        </div>
      ) : null}
      {(emailBody.trim() || signature) && (
        <div className="border-t border-black/10 pt-3">
          {emailBody.trim() && <MessageBlocks body={emailBody} />}
          <EmailSignaturePreview signature={signature} />
        </div>
      )}
    </div>
  );
}

function EmailSignaturePreview({ signature }: { signature?: EmailSignatureBlock }) {
  if (!signature) return null;
  return (
    <div className="mt-2 border-t border-black/10 pt-2">
      <div className="text-ink-400 text-sm leading-none">--</div>
      {signature.text && (
        <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug">
          {signature.text}
        </div>
      )}
      {(signature.images ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {(signature.images ?? []).map((img, index) =>
            img.dataUrl ? (
              <img
                key={`${img.name}-${index}`}
                src={img.dataUrl}
                alt={img.name}
                className="max-h-16 max-w-[160px] object-contain"
              />
            ) : (
              <span
                key={`${img.name}-${index}`}
                className="rounded border border-ink-200 bg-white/70 px-2 py-1 text-[11px] text-ink-500"
              >
                {img.name}
              </span>
            )
          )}
        </div>
      )}
      {signature.electronicSignature?.name && (
        <div className="mt-2 max-w-full overflow-x-auto overflow-y-hidden py-1">
          <div
            className="whitespace-nowrap text-ink-900"
            style={electronicSignaturePreviewStyle(signature.electronicSignature)}
          >
            {signature.electronicSignature.name}
          </div>
        </div>
      )}
    </div>
  );
}

function parseMarketingCampaignSections(body: string): {
  emailBody: string;
  pamphletBody: string;
  pamphletData?: MarketingPamphletRenderData;
} | null {
  const normalized = body.replace(/\r\n/g, "\n");
  const emailIndex = normalized.indexOf(MARKETING_EMAIL_BODY_MARKER);
  const pamphletIndex = normalized.indexOf(MARKETING_PAMPHLET_MARKER);
  if (emailIndex !== -1 && pamphletIndex > emailIndex) {
    const emailSlice = normalized.slice(emailIndex + MARKETING_EMAIL_BODY_MARKER.length, pamphletIndex);
    const data = parsePamphletDataMarker(emailSlice);
    const pamphletBody = normalized.slice(pamphletIndex + MARKETING_PAMPHLET_MARKER.length).trim();
    return {
      emailBody: stripPamphletDataMarkers(emailSlice).trim(),
      pamphletBody,
      pamphletData: data ?? parseMarketingPamphletMarkdown(pamphletBody),
    };
  }
  return parseLegacyMarketingCampaignSections(normalized);
}

function parseLegacyMarketingCampaignSections(body: string): {
  emailBody: string;
  pamphletBody: string;
  pamphletData?: MarketingPamphletRenderData;
} | null {
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const imageIndex = blocks.findIndex((block) => !!parseMarkdownImage(block));
  if (imageIndex === -1) return null;

  const ctaIndex = blocks.findIndex((block) => {
    const link = parseMarkdownLink(block);
    return !!link && /^get in touch$/i.test(link.label.trim());
  });
  const headingIndex = blocks.findIndex(
    (block, index) => index > imageIndex && parseMarkdownHeading(block)?.level === 1
  );
  const greetingIndex = blocks.findIndex((block) => /^hi\b[^,\n]*,/i.test(block));
  const closingIndex = findLastIndex(blocks, isLegacyMarketingClosingBlock);
  const advisorNoteIndex = blocks.findIndex((block) => /^Advisor note\n/i.test(block));
  const advisorNote =
    advisorNoteIndex === -1 ? "" : blocks[advisorNoteIndex].replace(/^Advisor note\n/i, "").trim();

  const pamphletStart = imageIndex;
  const pamphletEnd = ctaIndex >= imageIndex ? ctaIndex : headingIndex >= imageIndex ? blocks.length - 1 : imageIndex;
  const pamphletBody = blocks
    .filter((block, index) => {
      if (index < pamphletStart || index > pamphletEnd) return false;
      if (index === greetingIndex || index === closingIndex || index === advisorNoteIndex) return false;
      return true;
    })
    .join("\n\n")
    .trim();

  const emailBlocks: string[] = [];
  if (greetingIndex !== -1) emailBlocks.push(blocks[greetingIndex]);
  if (advisorNote) {
    emailBlocks.push(advisorNote);
  } else if (greetingIndex !== -1) {
    const afterGreeting = blocks
      .slice(greetingIndex + 1, closingIndex === -1 ? blocks.length : closingIndex)
      .filter((_block, offset) => {
        const index = greetingIndex + 1 + offset;
        if (index >= pamphletStart && index <= pamphletEnd) return false;
        return index !== imageIndex;
      });
    emailBlocks.push(...afterGreeting);
  }
  if (closingIndex !== -1) emailBlocks.push(blocks[closingIndex]);

  const emailBody = emailBlocks.join("\n\n").trim();
  if (!pamphletBody || !emailBody) return null;
  return { emailBody, pamphletBody, pamphletData: parseMarketingPamphletMarkdown(pamphletBody) };
}

function findLastIndex<T>(items: T[], predicate: (item: T, index: number) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index], index)) return index;
  }
  return -1;
}

function isLegacyMarketingClosingBlock(block: string): boolean {
  return /^(best|warm regards|regards|thank you|thanks|sincerely),?\b/i.test(block.trim());
}

function parsePamphletDataMarker(value: string): MarketingPamphletRenderData | null {
  const start = value.indexOf(MARKETING_PAMPHLET_DATA_PREFIX);
  if (start === -1) return null;
  const payloadStart = start + MARKETING_PAMPHLET_DATA_PREFIX.length;
  const end = value.indexOf(MARKETING_PAMPHLET_DATA_SUFFIX, payloadStart);
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(payloadStart, end)));
    return normalizePamphletData(parsed);
  } catch {
    return null;
  }
}

function stripPamphletDataMarkers(value: string): string {
  let next = value;
  while (next.includes(MARKETING_PAMPHLET_DATA_PREFIX)) {
    const start = next.indexOf(MARKETING_PAMPHLET_DATA_PREFIX);
    const end = next.indexOf(MARKETING_PAMPHLET_DATA_SUFFIX, start + MARKETING_PAMPHLET_DATA_PREFIX.length);
    if (end === -1) break;
    next = `${next.slice(0, start)}${next.slice(end + MARKETING_PAMPHLET_DATA_SUFFIX.length)}`;
  }
  return next;
}

function normalizePamphletData(value: unknown): MarketingPamphletRenderData | null {
  if (!isRecord(value)) return null;
  const pamphlet = isRecord(value.pamphlet) ? value.pamphlet : null;
  if (!pamphlet) return null;
  const highlights = Array.isArray(pamphlet.highlights)
    ? pamphlet.highlights.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const headline = stringField(pamphlet.headline);
  if (!headline) return null;
  return {
    imageUrl: stringField(value.imageUrl),
    imageAlt: stringField(value.imageAlt) || headline,
    ctaHref: stringField(value.ctaHref),
    ctaLabel: stringField(value.ctaLabel) || "Get in touch",
    themeId: normalizeThemeId(stringField(value.themeId)),
    pamphlet: {
      eyebrow: stringField(pamphlet.eyebrow) || "Private client insurance",
      headline,
      subheadline: stringField(pamphlet.subheadline) || headline,
      intro: stringField(pamphlet.intro) || stringField(pamphlet.subheadline) || headline,
      highlightsTitle: stringField(pamphlet.highlightsTitle) || "What we will check",
      highlights: highlights.length ? highlights : ["Review the details on file."],
      ctaTitle: stringField(pamphlet.ctaTitle) || "Ready for a review?",
      ctaButton: stringField(pamphlet.ctaButton) || "Get in touch",
      imagePrompt: stringField(pamphlet.imagePrompt) || headline,
    },
  };
}

function parseMarketingPamphletMarkdown(body: string): MarketingPamphletRenderData | undefined {
  const blocks = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const image = blocks.map(parseMarkdownImage).find(Boolean) ?? null;
  const headingIndex = blocks.findIndex((block) => parseMarkdownHeading(block)?.level === 1);
  if (headingIndex === -1) return undefined;
  const headline = parseMarkdownHeading(blocks[headingIndex])?.text ?? "";
  const eyebrow =
    blocks
      .slice(0, headingIndex)
      .map(parseStrongBlock)
      .find(Boolean) ?? "Private client insurance";
  const afterHeading = blocks.slice(headingIndex + 1);
  const subheadline = firstPlainBlock(afterHeading) || headline;
  const intro = firstPlainBlock(afterHeading.slice(subheadline ? 1 : 0)) || subheadline;
  const highlightsTitle =
    afterHeading
      .map(parseStrongBlock)
      .find(Boolean) ?? "What we will check";
  const highlights = afterHeading.map(parseBulletList).find(Boolean) ?? ["Review the details on file."];
  const cta = blocks.map(parseMarkdownLink).find((link) => link && isMarketingCtaLink(link.label, link.href)) ?? null;
  return {
    imageUrl: image?.src,
    imageAlt: image?.alt || headline,
    ctaHref: cta?.href,
    ctaLabel: cta?.label || "Get in touch",
    themeId: "executive",
    pamphlet: {
      eyebrow,
      headline,
      subheadline,
      intro,
      highlightsTitle,
      highlights,
      ctaTitle: "Ready for a review?",
      ctaButton: "Get in touch",
      imagePrompt: image?.alt || headline,
    },
  };
}

function firstPlainBlock(blocks: string[]): string {
  return (
    blocks.find((block) => {
      if (parseMarkdownImage(block)) return false;
      if (parseMarkdownHeading(block)) return false;
      if (parseStrongBlock(block)) return false;
      if (parseBulletList(block)) return false;
      if (parseMarkdownLink(block)) return false;
      return !!block.trim();
    }) ?? ""
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeThemeId(value: string): PamphletThemeId | undefined {
  return value === "executive" || value === "coastal" || value === "ivory" || value === "midnight"
    ? value
    : undefined;
}

function MessageBlocks({ body }: { body: string }) {
  const blocks = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <>
      {blocks.map((block, index) => {
        const image = parseMarkdownImage(block);
        if (image) {
          return (
            <img
              key={`image-${index}-${image.src}`}
              src={image.src}
              alt={image.alt}
              className="max-h-72 w-full rounded-md border border-black/10 object-cover"
              loading="lazy"
            />
          );
        }
        const heading = parseMarkdownHeading(block);
        if (heading) {
          const Tag = heading.level === 1 ? "h3" : "h4";
          return (
            <Tag
              key={`heading-${index}`}
              className={
                heading.level === 1
                  ? "font-display text-2xl leading-tight text-ink-950"
                  : "text-sm font-semibold uppercase tracking-wider text-ink-500"
              }
            >
              {heading.text}
            </Tag>
          );
        }
        const emphasis = parseStrongBlock(block);
        if (emphasis) {
          return (
            <div
              key={`strong-${index}`}
              className="text-xs font-semibold uppercase tracking-wider text-ink-500"
            >
              {emphasis}
            </div>
          );
        }
        const list = parseBulletList(block);
        if (list) {
          return (
            <ul key={`list-${index}`} className="space-y-1.5">
              {list.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className="flex gap-2 leading-snug">
                  <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                    <Check className="h-3 w-3" />
                  </span>
                  <span>{renderInlineLinks(item, `list-${index}-${itemIndex}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        const cta = parseMarkdownLink(block);
        if (cta && isMarketingCtaLink(cta.label, cta.href)) {
          return renderMarketingCta(cta.href, cta.label, `cta-${index}-${cta.href}`);
        }
        const marketingCta = parseMarketingCtaBlock(block);
        if (marketingCta) {
          return renderMarketingCta(marketingCta.href, marketingCta.label, `cta-${index}-${marketingCta.href}`);
        }
        return (
          <p key={`text-${index}`} className="whitespace-pre-wrap break-words leading-snug">
            {renderInlineLinks(block, `block-${index}`)}
          </p>
        );
      })}
    </>
  );
}

function renderInlineLinks(text: string, keyPrefix: string) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]+|\/[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+)\)|(https?:\/\/[^\s<]+|\/marketing\/contact\?[^\s<]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const label = match[1] ?? match[3] ?? "";
    const href = match[2] ?? match[3] ?? "";
    if (isMarketingCtaLink(label, href)) {
      parts.push(renderMarketingCta(href, label || "Get in touch", `${keyPrefix}-${match.index}-${href}`));
      lastIndex = pattern.lastIndex;
      continue;
    }
    parts.push(
      <a
        key={`${keyPrefix}-${match.index}-${href}`}
        href={href}
        target={isExternalHref(href) ? "_blank" : undefined}
        rel={isExternalHref(href) ? "noopener noreferrer" : undefined}
        className="font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900"
      >
        {label}
      </a>
    );
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : text;
}

function isMarketingCtaLink(label: string, href: string): boolean {
  const cleanLabel = label.trim();
  return /get\s+in\s+touch/i.test(cleanLabel) || /\/marketing\/contact(?:\?|$)/i.test(href);
}

function parseMarketingCtaBlock(value: string): { label: string; href: string } | null {
  const markdown = value.match(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/i);
  if (markdown && isMarketingCtaLink(markdown[1], markdown[2])) {
    return { label: /get\s+in\s+touch/i.test(markdown[1]) ? markdown[1].trim() : "Get in touch", href: markdown[2] };
  }
  const rawUrl = value.match(/(https?:\/\/[^\s<)]+\/marketing\/contact\?[^\s<)]*|\/marketing\/contact\?[^\s<)]*)/i);
  if (rawUrl) return { label: "Get in touch", href: rawUrl[1] };
  return null;
}

function renderMarketingCta(href: string, label: string, key: string): ReactNode {
  return (
    <a
      key={key}
      href={href}
      target={isExternalHref(href) ? "_blank" : undefined}
      rel={isExternalHref(href) ? "noopener noreferrer" : undefined}
      className={MARKETING_CTA_CLASSNAME}
    >
      {/get\s+in\s+touch/i.test(label) ? label : "Get in touch"}
    </a>
  );
}

function parseMarkdownImage(value: string): { alt: string; src: string } | null {
  const match = value.match(/^!\[([^\]\n]{0,160})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)$/);
  if (!match) return null;
  return { alt: match[1] || "Campaign image", src: match[2] };
}

function parseMarkdownHeading(value: string): { level: 1 | 2; text: string } | null {
  const match = value.match(/^(#{1,2})\s+(.+)$/);
  if (!match) return null;
  return { level: match[1].length === 1 ? 1 : 2, text: match[2].trim() };
}

function parseStrongBlock(value: string): string | null {
  const match = value.match(/^\*\*([^*\n][\s\S]*?)\*\*$/);
  return match ? match[1].trim() : null;
}

function parseBulletList(value: string): string[] | null {
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || !lines.every((line) => /^[-*]\s+/.test(line))) return null;
  return lines.map((line) => line.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
}

function parseMarkdownLink(value: string): { label: string; href: string } | null {
  const match = value.match(/^\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]+|\/[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+)\)$/);
  if (!match) return null;
  return { label: match[1], href: match[2] };
}

function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(href);
}
