const BLOCKED_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
]);

const URI_ATTRIBUTES = new Set(["href", "src", "background", "poster", "xlink:href"]);
const RESOURCE_ATTRIBUTES = new Set(["src", "background", "poster", "xlink:href"]);
const NAVIGATION_TAGS = new Set(["a", "area"]);

export function plainTextToEmailHtml(value: string): string {
  const clean = value.trim() || "Please see attached.";
  return clean
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function stripEmailHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeEmailHtml(input: string, options: { allowRemoteImages: boolean }): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return emailFrameDocument(`<pre>${escapeHtml(stripEmailHtml(input))}</pre>`, options.allowRemoteImages);
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(input || "", "text/html");
  for (const tag of BLOCKED_TAGS) {
    parsed.querySelectorAll(tag).forEach((node) => node.remove());
  }
  if (!options.allowRemoteImages) {
    parsed.querySelectorAll("style").forEach((node) => node.remove());
  }

  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];
  while (walker.nextNode()) elements.push(walker.currentNode as Element);

  elements.forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === "srcset") {
        if (!options.allowRemoteImages || !isSafeSrcSet(value)) {
          element.removeAttribute(attribute.name);
        }
        return;
      }
      if (URI_ATTRIBUTES.has(name) && !isSafeEmailUrl(value)) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (
        !options.allowRemoteImages &&
        isLoadableResourceAttribute(element, name) &&
        !isEmbeddedEmailResource(value)
      ) {
        if (element.tagName.toLowerCase() === "img" && name === "src") {
          element.setAttribute("data-quotex-blocked-src", value);
        }
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === "style") {
        const safeStyle = sanitizeStyle(value, options.allowRemoteImages);
        if (safeStyle) element.setAttribute(attribute.name, safeStyle);
        else element.removeAttribute(attribute.name);
      }
    });

    if (element.tagName.toLowerCase() === "img") {
      const blockedSrc = element.getAttribute("data-quotex-blocked-src");
      if (blockedSrc && !options.allowRemoteImages) {
        element.setAttribute("alt", element.getAttribute("alt") || "Remote image blocked");
        element.setAttribute("style", mergeStyles(element.getAttribute("style"), "display:inline-block;border:1px solid #ddd;background:#f7f7f7;color:#555;padding:8px;min-width:120px;min-height:32px;"));
      }
    }
  });

  return emailFrameDocument(parsed.body.innerHTML, options.allowRemoteImages);
}

function emailFrameDocument(bodyHtml: string, allowRemoteImages: boolean): string {
  const imagePolicy = allowRemoteImages ? "img-src http: https: data: cid:;" : "img-src data: cid:;";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imagePolicy} style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none';" />
    <base target="_blank" />
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
      body { padding: 16px; overflow-wrap: anywhere; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; border-collapse: collapse; }
      a { color: #0b57d0; }
      blockquote { margin: 12px 0 12px 12px; padding-left: 12px; border-left: 3px solid #ddd; color: #444; }
      pre { white-space: pre-wrap; font-family: Arial, Helvetica, sans-serif; }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

function isSafeEmailUrl(value: string): boolean {
  if (!value) return true;
  return /^(https?:|mailto:|tel:|cid:|data:image\/(?:png|gif|jpeg|jpg|webp);base64,|\/|#)/i.test(value);
}

function isSafeSrcSet(value: string): boolean {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean)
    .every(isSafeEmailUrl);
}

function isLoadableResourceAttribute(element: Element, name: string): boolean {
  if (RESOURCE_ATTRIBUTES.has(name)) return true;
  return name === "href" && !NAVIGATION_TAGS.has(element.tagName.toLowerCase());
}

function isEmbeddedEmailResource(value: string): boolean {
  return /^(cid:|data:image\/(?:png|gif|jpeg|jpg|webp);base64,|#)/i.test(value);
}

function sanitizeStyle(value: string, allowRemoteResources = true): string {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => !/expression\s*\(|javascript:|behavior\s*:|-moz-binding|url\s*\(\s*['"]?\s*javascript:/i.test(declaration))
    .filter((declaration) => allowRemoteResources || !/(?:url|image-set|cross-fade)\s*\(|@import/i.test(declaration))
    .join("; ");
}

function mergeStyles(existing: string | null, next: string): string {
  const current = sanitizeStyle(existing ?? "");
  return [current, next].filter(Boolean).join("; ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
