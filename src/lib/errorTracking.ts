type ErrorTrackingContext = {
  level?: "error" | "warning" | "info";
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
};

declare const __BUILD_SHA__: string | undefined;

type ParsedSentryDsn = {
  publicKey: string;
  envelopeUrl: string;
};

const SENTRY_CLIENT = "quotex-lite-browser/1.0";
const MAX_STRING_LENGTH = 600;
let initialized = false;

export function initClientErrorTracking() {
  if (initialized || typeof window === "undefined") return;
  if (!clientDsn()) return;
  initialized = true;

  window.addEventListener("error", (event) => {
    reportClientError(event.error ?? event.message, {
      extra: {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, {
      extra: { source: "unhandledrejection" },
    });
  });
}

export function reportClientError(error: unknown, context: ErrorTrackingContext = {}) {
  const parsed = parseSentryDsn(clientDsn());
  if (!parsed || typeof fetch === "undefined") return;

  const normalized = normalizeError(error);
  const event = sanitizeForSentry({
    event_id: eventId(),
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: context.level ?? "error",
    environment: clientEnv("VITE_SENTRY_ENVIRONMENT") || clientEnv("MODE") || "development",
    release: clientEnv("VITE_SENTRY_RELEASE") || buildRelease(),
    logger: "quotex.browser",
    transaction: safeBrowserPath(),
    tags: {
      app: "quotex",
      surface: safeSurface(),
      ...context.tags,
    },
    exception: {
      values: [
        {
          type: normalized.name,
          value: normalized.message,
          stacktrace: normalized.stack ? { frames: stackFrames(normalized.stack) } : undefined,
        },
      ],
    },
    extra: context.extra ?? {},
  });

  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");

  void fetch(parsed.envelopeUrl, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope" },
    body: envelope,
    keepalive: true,
  }).catch(() => undefined);
}

export function parseSentryDsn(dsn: string | undefined | null): ParsedSentryDsn | null {
  const trimmed = dsn?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const publicKey = url.username;
    const projectId = url.pathname.split("/").filter(Boolean).at(-1);
    if (!publicKey || !projectId) return null;
    const pathPrefix = url.pathname
      .split("/")
      .filter(Boolean)
      .slice(0, -1)
      .join("/");
    const basePath = pathPrefix ? `/${pathPrefix}` : "";
    return {
      publicKey,
      envelopeUrl: `${url.protocol}//${url.host}${basePath}/api/${projectId}/envelope/?sentry_key=${encodeURIComponent(
        publicKey
      )}&sentry_version=7&sentry_client=${encodeURIComponent(SENTRY_CLIENT)}`,
    };
  } catch {
    return null;
  }
}

export function sanitizeForSentry<T>(value: T): T {
  return redact(value, new WeakSet()) as T;
}

function clientDsn(): string {
  return clientEnv("VITE_SENTRY_DSN");
}

function clientEnv(key: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return String(((import.meta as any).env?.[key] ?? "") as string).trim();
  } catch {
    return "";
  }
}

function buildRelease(): string {
  try {
    return typeof __BUILD_SHA__ === "string" && __BUILD_SHA__ !== "unknown"
      ? `quotex@${__BUILD_SHA__}`
      : "quotex@local";
  } catch {
    return "quotex@local";
  }
}

function safeSurface(): string {
  if (typeof window === "undefined") return "unknown";
  const pathname = window.location.pathname;
  if (pathname.startsWith("/employee")) return "employee";
  if (pathname.startsWith("/agency-app") || pathname.startsWith("/app")) return "agency-app";
  if (pathname.startsWith("/agency") || pathname.startsWith("/customer")) return "customer";
  if (pathname.startsWith("/checkout")) return "checkout";
  return "website";
}

function safeBrowserPath(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
}

function normalizeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: limitString(error.name || "Error"),
      message: limitString(redactString(error.message || "Unknown error")),
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { name: "Error", message: limitString(redactString(error)) };
  }
  return { name: "Error", message: "Unknown non-error rejection" };
}

function stackFrames(stack: string): Array<Record<string, unknown>> {
  return stack
    .split("\n")
    .slice(1, 25)
    .map((line) => ({ function: limitString(redactString(line.trim())) }))
    .reverse();
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return limitString(redactString(value));
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = "[Filtered]";
    } else {
      out[key] = redact(nested, seen);
    }
  }
  return out;
}

function isSensitiveKey(key: string): boolean {
  return /password|passcode|token|secret|authorization|cookie|api[-_]?key|service[-_]?role|email|phone|address|ssn|dob|birth|vin|policy|claim|license/i.test(
    key
  );
}

function redactString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[phone]")
    .replace(/\b(?:sk|pk|rk|xox|ghp|gho|ghu|github_pat|SG)\S{12,}\b/gi, "[secret]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[ssn]");
}

function limitString(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
}

function eventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
