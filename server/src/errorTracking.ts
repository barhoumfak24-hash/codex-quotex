import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { databaseConfigured, prisma } from "./services/prisma.js";

type ServerErrorContext = {
  req?: Request;
  tags?: Record<string, string | number | boolean | null | undefined>;
  extra?: Record<string, unknown>;
  level?: "error" | "warning" | "info" | "fatal";
};

type ParsedSentryDsn = {
  publicKey: string;
  envelopeUrl: string;
};

const SENTRY_CLIENT = "quotex-lite-node/1.0";
const MAX_STRING_LENGTH = 700;
let initialized = false;

export function initServerErrorTracking() {
  if (initialized || !process.env.SENTRY_DSN?.trim()) return;
  initialized = true;

  process.on("uncaughtException", (error) => {
    reportServerError(error, { level: "fatal", tags: { source: "uncaughtException" } });
  });

  process.on("unhandledRejection", (reason) => {
    reportServerError(reason, { level: "fatal", tags: { source: "unhandledRejection" } });
  });
}

export function sentryErrorMiddleware(err: unknown, req: Request, res: Response, next: NextFunction) {
  reportServerError(err, { req });
  if (res.headersSent) return next(err);
  return res.status(statusCodeFromError(err)).json({
    error: "internal_server_error",
    requestId: req.requestId,
  });
}

export function reportServerError(error: unknown, context: ServerErrorContext = {}) {
  const normalized = normalizeError(error);
  const event = sanitizeForSentry({
    event_id: eventId(),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: context.level ?? "error",
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || "quotex-server@local",
    logger: "quotex.server",
    transaction: context.req ? `${context.req.method} ${context.req.path}` : undefined,
    request: context.req ? requestPayload(context.req) : undefined,
    tags: {
      app: "quotex",
      tenantId: context.req?.auth?.tenantId,
      userRole: context.req?.auth?.role,
      requestId: context.req?.requestId,
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

  recordInternalErrorEvent(event, context);

  const parsed = parseSentryDsn(process.env.SENTRY_DSN);
  if (!parsed) return;

  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");

  void fetch(parsed.envelopeUrl, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope" },
    body: envelope,
  }).catch(() => undefined);
}

function recordInternalErrorEvent(event: Record<string, unknown>, context: ServerErrorContext) {
  if (!databaseConfigured()) return;
  const req = context.req;
  const eventIdValue = typeof event.event_id === "string" ? event.event_id : eventId();
  const metadata = sanitizeForSentry({
    eventId: eventIdValue,
    level: event.level,
    environment: event.environment,
    release: event.release,
    transaction: event.transaction,
    request: event.request,
    tags: event.tags,
    exception: event.exception,
    extra: event.extra,
  });

  void prisma.auditLog
    .create({
      data: {
        id: eventId(),
        tenantId: req?.auth?.tenantId ?? null,
        actorId: req?.auth?.userId ?? "system",
        action: "server.error",
        entityType: "server_error",
        entityId: eventIdValue,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
    .catch(() => undefined);
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

function requestPayload(req: Request) {
  return sanitizeForSentry({
    method: req.method,
    url: `${req.protocol}://${req.get("host")}${req.path}`,
    headers: {
      "user-agent": req.get("user-agent"),
      "x-request-id": req.requestId,
      origin: req.get("origin"),
    },
  });
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
    .slice(1, 30)
    .map((line) => ({ function: limitString(redactString(line.trim())) }))
    .reverse();
}

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return limitString(redactString(value));
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.slice(0, 25).map((item) => redact(item, seen));

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
  return randomUUID().replace(/-/g, "");
}

function statusCodeFromError(err: unknown): number {
  if (typeof err === "object" && err && "status" in err && typeof err.status === "number") {
    return err.status >= 400 && err.status < 600 ? err.status : 500;
  }
  if (typeof err === "object" && err && "statusCode" in err && typeof err.statusCode === "number") {
    return err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  }
  return 500;
}
