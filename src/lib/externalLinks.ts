import { useEffect } from "react";

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

export function safeHref(rawHref: string, options: { allowRelative?: boolean } = {}): string | null {
  const { allowRelative = true } = options;
  const trimmed = rawHref.trim();
  if (!trimmed || CONTROL_CHARS_RE.test(trimmed)) return null;

  if (allowRelative && /^(\/(?!\/)|#|\?)/.test(trimmed)) return trimmed;

  try {
    const base =
      typeof window !== "undefined" ? window.location.href : "https://quotex.local/";
    const url = new URL(trimmed, base);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if (!allowRelative && url.origin === new URL(base).origin && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      return null;
    }
    if (url.protocol === "mailto:" || url.protocol === "tel:") return trimmed;
    return url.href;
  } catch {
    return null;
  }
}

export function isExternalHttpHref(rawHref: string): boolean {
  if (typeof window === "undefined") return false;
  const href = safeHref(rawHref);
  if (!href) return false;
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function externalLinkRel(existingRel?: string): string {
  const rel = new Set((existingRel || "").split(/\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  return Array.from(rel).join(" ");
}

export function externalLinkTarget(rawHref: string, currentTarget?: string): string | undefined {
  return isExternalHttpHref(rawHref) ? "_blank" : currentTarget;
}

export function externalAnchorProps(rawHref: string, existingRel?: string, currentTarget?: string) {
  if (!isExternalHttpHref(rawHref)) {
    return {
      target: currentTarget,
      rel: existingRel,
    };
  }
  return {
    target: "_blank",
    rel: externalLinkRel(existingRel),
  };
}

export function openExternalHref(rawHref: string): boolean {
  if (typeof window === "undefined") return false;
  const href = safeHref(rawHref, { allowRelative: false });
  if (!href) return false;
  const opened = window.open(href, "_blank", "noopener,noreferrer");
  return !!opened;
}

function hardenExternalAnchor(anchor: HTMLAnchorElement) {
  const rawHref = anchor.getAttribute("href");
  if (!rawHref) return;
  const href = safeHref(rawHref);
  if (!href) {
    if (anchor.hasAttribute("href")) anchor.removeAttribute("href");
    anchor.setAttribute("aria-disabled", "true");
    return;
  }
  if (anchor.getAttribute("href") !== href) {
    anchor.setAttribute("href", href);
  }
  if (!isExternalHttpHref(href)) return;
  if (anchor.target !== "_blank") anchor.target = "_blank";
  const rel = externalLinkRel(anchor.rel);
  if (anchor.rel !== rel) anchor.rel = rel;
}

function hardenExternalAnchors(root: ParentNode = document) {
  root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(hardenExternalAnchor);
}

export function useExternalLinkTargets() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    hardenExternalAnchors();

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      hardenExternalAnchor(anchor);
    };

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLAnchorElement) {
          hardenExternalAnchor(record.target);
          continue;
        }
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLAnchorElement) hardenExternalAnchor(node);
          hardenExternalAnchors(node);
        });
      }
    });

    document.addEventListener("click", onClick, true);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });

    return () => {
      document.removeEventListener("click", onClick, true);
      observer.disconnect();
    };
  }, []);
}
