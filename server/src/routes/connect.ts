import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ensureConnectQuoteSession } from "../services/connectQuoteSession.js";
import { findCarrierEmailVerificationCode } from "../services/mailboxOneTimeCode.js";
import { prisma } from "../services/prisma.js";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const JOB_LEASE_MS = 2 * 60 * 1000;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TERMINAL_JOB_STATUSES = new Set(["completed", "manual_required", "failed", "cancelled"]);
const SENSITIVE_KEY = /password|passcode|credential|cookie|authorization|secret|token|otp|one.?time|session/i;

const jobStatuses = [
  "queued",
  "claimed",
  "opening_portal",
  "waiting_for_login",
  "waiting_for_mfa",
  "running",
  "completed",
  "manual_required",
  "failed",
  "cancelled",
] as const;

type JobStatus = (typeof jobStatuses)[number];

const allowedTransitions: Record<JobStatus, ReadonlySet<JobStatus>> = {
  queued: new Set(["claimed", "cancelled"]),
  claimed: new Set(["opening_portal", "manual_required", "failed", "cancelled"]),
  opening_portal: new Set(["waiting_for_login", "waiting_for_mfa", "running", "manual_required", "failed", "cancelled"]),
  waiting_for_login: new Set(["waiting_for_mfa", "running", "manual_required", "failed", "cancelled"]),
  waiting_for_mfa: new Set(["running", "manual_required", "failed", "cancelled"]),
  running: new Set(["waiting_for_mfa", "completed", "manual_required", "failed", "cancelled"]),
  completed: new Set(),
  manual_required: new Set(["running", "cancelled"]),
  failed: new Set(),
  cancelled: new Set(),
};

const pairingClaimSchema = z.object({
  code: z.string().min(6).max(32),
  deviceLabel: z.string().trim().min(1).max(120),
  browser: z.string().trim().min(1).max(80).optional(),
});

const createJobSchema = z.object({
  carrierId: z.string().trim().min(1).max(160),
  carrierName: z.string().trim().min(1).max(200),
  jobType: z.enum(["open_portal", "retrieve_quote", "retrieve_policy", "retrieve_claim", "retrieve_documents"]),
  quoteSessionId: z.string().trim().min(1).max(200).optional(),
  deviceId: z.string().trim().min(1).max(200).optional(),
  payload: z.record(z.unknown()).default({}),
});

const jobStatusSchema = z.object({
  status: z.enum(jobStatuses),
  result: z.record(z.unknown()).optional(),
  errorCode: z.string().trim().max(120).optional(),
  errorMessage: z.string().trim().max(1000).optional(),
});

const jobListQuerySchema = z.object({
  quoteSessionId: z.string().trim().min(1).max(200),
  jobType: z
    .enum(["open_portal", "retrieve_quote", "retrieve_policy", "retrieve_claim", "retrieve_documents"])
    .optional(),
});

const emailCodeLookupSchema = z.object({
  carrierHost: z.string().trim().min(1).max(255),
  excludeMessageKeys: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(5).default([]),
});

type ExtensionDevice = {
  id: string;
  tenantId: string;
  userId: string;
  label: string;
};

export const connectRoutes = Router();
export const connectExtensionRoutes = Router();

connectRoutes.post("/pairings", async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth?.tenantId) return res.status(403).json({ ok: false, error: "agency_account_required" });

    const code = createPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    await prisma.$transaction([
      prisma.connectPairingCode.deleteMany({
        where: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          claimedAt: null,
        },
      }),
      prisma.connectPairingCode.create({
        data: {
          id: randomUUID(),
          tenantId: auth.tenantId,
          userId: auth.userId,
          codeHash: secureHash(normalizePairingCode(code)),
          expiresAt,
        },
      }),
    ]);

    res.status(201).json({
      ok: true,
      code,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

connectRoutes.get("/devices", async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth?.tenantId) return res.status(403).json({ ok: false, error: "agency_account_required" });
    const devices = await prisma.connectDevice.findMany({
      where: { tenantId: auth.tenantId, userId: auth.userId, active: true },
      select: {
        id: true,
        label: true,
        browser: true,
        lastSeenAt: true,
        createdAt: true,
      },
      orderBy: { lastSeenAt: "desc" },
    });
    res.json({ ok: true, devices });
  } catch (error) {
    next(error);
  }
});

connectRoutes.delete("/devices/:deviceId", async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth?.tenantId) return res.status(403).json({ ok: false, error: "agency_account_required" });
    const updated = await prisma.connectDevice.updateMany({
      where: {
        id: req.params.deviceId,
        tenantId: auth.tenantId,
        userId: auth.userId,
      },
      data: { active: false },
    });
    if (updated.count === 0) return res.status(404).json({ ok: false, error: "device_not_found" });
    await prisma.carrierAutomationJob.updateMany({
      where: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        deviceId: req.params.deviceId,
        status: { notIn: [...TERMINAL_JOB_STATUSES] },
      },
      data: {
        status: "cancelled",
        errorCode: "device_revoked",
        errorMessage: "The paired browser was disconnected.",
        completedAt: new Date(),
      },
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

connectRoutes.post("/jobs", async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth?.tenantId) return res.status(403).json({ ok: false, error: "agency_account_required" });
    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_job" });
    if (containsSensitiveValue(parsed.data.payload)) {
      return res.status(400).json({ ok: false, error: "sensitive_job_payload_rejected" });
    }

    if (parsed.data.quoteSessionId) {
      const quoteSessionAvailable = await ensureConnectQuoteSession(auth, parsed.data.quoteSessionId);
      if (!quoteSessionAvailable) {
        return res.status(404).json({ ok: false, error: "quote_session_not_found" });
      }
    }

    const device = await prisma.connectDevice.findFirst({
      where: {
        ...(parsed.data.deviceId ? { id: parsed.data.deviceId } : {}),
        tenantId: auth.tenantId,
        userId: auth.userId,
        active: true,
      },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true },
    });
    if (!device) return res.status(409).json({ ok: false, error: "connect_device_required" });

    const existing = await prisma.carrierAutomationJob.findFirst({
      where: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        deviceId: device.id,
        quoteSessionId: parsed.data.quoteSessionId ?? null,
        carrierId: parsed.data.carrierId,
        jobType: parsed.data.jobType,
        status: { notIn: [...TERMINAL_JOB_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return res.status(200).json({ ok: true, job: publicJob(existing), reused: true });

    const job = await prisma.carrierAutomationJob.create({
      data: {
        id: randomUUID(),
        tenantId: auth.tenantId,
        userId: auth.userId,
        deviceId: device.id,
        quoteSessionId: parsed.data.quoteSessionId,
        carrierId: parsed.data.carrierId,
        carrierName: parsed.data.carrierName,
        jobType: parsed.data.jobType,
        payload: parsed.data.payload as Prisma.InputJsonValue,
        status: "queued",
      },
    });
    await recordConnectAudit({
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: "connect.job.created",
      entityType: "carrier_automation_job",
      entityId: job.id,
      metadata: connectJobAuditMetadata(job),
    });
    res.status(201).json({ ok: true, job: publicJob(job), reused: false });
  } catch (error) {
    next(error);
  }
});

connectRoutes.get("/jobs", async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth?.tenantId) {
      return res.status(403).json({ ok: false, error: "agency_account_required" });
    }
    const parsed = jobListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_job_query" });
    }
    const jobs = await prisma.carrierAutomationJob.findMany({
      where: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        quoteSessionId: parsed.data.quoteSessionId,
        ...(parsed.data.jobType ? { jobType: parsed.data.jobType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 250,
    });
    return res.json({ ok: true, jobs: jobs.map(publicJob) });
  } catch (error) {
    next(error);
  }
});

connectRoutes.get("/jobs/:jobId", async (req, res, next) => {
  try {
    const auth = req.auth;
    if (!auth?.tenantId) return res.status(403).json({ ok: false, error: "agency_account_required" });
    const job = await prisma.carrierAutomationJob.findFirst({
      where: { id: req.params.jobId, tenantId: auth.tenantId, userId: auth.userId },
    });
    if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
    res.json({ ok: true, job: publicJob(job) });
  } catch (error) {
    next(error);
  }
});

connectExtensionRoutes.post("/pairings/claim", async (req, res, next) => {
  try {
    const parsed = pairingClaimSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_pairing_request" });

    const codeHash = secureHash(normalizePairingCode(parsed.data.code));
    const pairing = await prisma.connectPairingCode.findUnique({
      where: { codeHash },
      include: { user: true, agency: true },
    });
    if (!pairing || pairing.claimedAt || pairing.expiresAt.getTime() <= Date.now()) {
      return res.status(404).json({ ok: false, error: "pairing_code_invalid_or_expired" });
    }
    if (pairing.user.status !== "active" || !pairing.agency.active) {
      return res.status(403).json({ ok: false, error: "account_inactive" });
    }

    const token = randomBytes(32).toString("base64url");
    const deviceId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.connectDevice.create({
        data: {
          id: deviceId,
          tenantId: pairing.tenantId,
          userId: pairing.userId,
          label: parsed.data.deviceLabel,
          browser: parsed.data.browser,
          tokenHash: secureHash(token),
          tokenPrefix: token.slice(0, 8),
          active: true,
          lastSeenAt: new Date(),
        },
      });
      const claimed = await tx.connectPairingCode.updateMany({
        where: { id: pairing.id, claimedAt: null, expiresAt: { gt: new Date() } },
        data: { claimedAt: new Date(), deviceId },
      });
      if (claimed.count !== 1) throw new Error("pairing_already_claimed");
    });
    await recordConnectAudit({
      tenantId: pairing.tenantId,
      actorId: pairing.userId,
      action: "connect.device.paired",
      entityType: "connect_device",
      entityId: deviceId,
      metadata: {
        deviceLabel: parsed.data.deviceLabel,
        browser: parsed.data.browser ?? null,
      },
    });

    res.status(201).json({
      ok: true,
      device: {
        id: deviceId,
        label: parsed.data.deviceLabel,
        tenantId: pairing.tenantId,
        userId: pairing.userId,
        userEmail: pairing.user.email,
        agencyName: pairing.agency.name,
      },
      token,
    });
  } catch (error) {
    next(error);
  }
});

connectExtensionRoutes.use(requireConnectDevice);

connectExtensionRoutes.post("/disconnect", async (_req, res, next) => {
  try {
    const device = connectDevice(res);
    await prisma.$transaction([
      prisma.connectDevice.update({
        where: { id: device.id },
        data: { active: false },
      }),
      prisma.carrierAutomationJob.updateMany({
        where: {
          tenantId: device.tenantId,
          userId: device.userId,
          deviceId: device.id,
          status: { notIn: [...TERMINAL_JOB_STATUSES] },
        },
        data: {
          status: "cancelled",
          errorCode: "device_disconnected",
          errorMessage: "The paired browser was disconnected.",
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      }),
    ]);
    await recordConnectAudit({
      tenantId: device.tenantId,
      actorId: device.userId,
      action: "connect.device.disconnected",
      entityType: "connect_device",
      entityId: device.id,
      metadata: { source: "extension" },
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

connectExtensionRoutes.post("/heartbeat", async (_req, res, next) => {
  try {
    const device = connectDevice(res);
    await prisma.connectDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });
    res.json({ ok: true, device });
  } catch (error) {
    next(error);
  }
});

connectExtensionRoutes.get("/jobs/next", async (_req, res, next) => {
  try {
    const device = connectDevice(res);
    const now = new Date();
    const job = await prisma.$transaction(async (tx) => {
      await tx.carrierAutomationJob.updateMany({
        where: {
          tenantId: device.tenantId,
          userId: device.userId,
          deviceId: device.id,
          leaseExpiresAt: { lt: now },
          status: { in: ["claimed", "opening_portal", "waiting_for_login", "waiting_for_mfa", "running"] },
        },
        data: {
          status: "queued",
          claimedAt: null,
          leaseExpiresAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });

      const queued = await tx.carrierAutomationJob.findFirst({
        where: {
          tenantId: device.tenantId,
          userId: device.userId,
          deviceId: device.id,
          status: "queued",
        },
        orderBy: { createdAt: "asc" },
      });
      if (!queued) return null;

      const claimed = await tx.carrierAutomationJob.updateMany({
        where: { id: queued.id, status: "queued", deviceId: device.id },
        data: {
          status: "claimed",
          claimedAt: now,
          leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
        },
      });
      if (claimed.count !== 1) return null;
      return tx.carrierAutomationJob.findUnique({ where: { id: queued.id } });
    });

    await prisma.connectDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });
    if (job) {
      await recordConnectAudit({
        tenantId: device.tenantId,
        actorId: device.userId,
        action: "connect.job.claimed",
        entityType: "carrier_automation_job",
        entityId: job.id,
        metadata: connectJobAuditMetadata(job),
      });
    }
    res.json({ ok: true, job: job ? extensionJob(job) : null });
  } catch (error) {
    next(error);
  }
});

connectExtensionRoutes.post("/jobs/:jobId/email-code", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Pragma", "no-cache");
    const device = connectDevice(res);
    const parsed = emailCodeLookupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_email_code_request" });

    const job = await prisma.carrierAutomationJob.findFirst({
      where: {
        id: req.params.jobId,
        tenantId: device.tenantId,
        userId: device.userId,
        deviceId: device.id,
      },
      select: {
        id: true,
        carrierName: true,
        status: true,
        createdAt: true,
      },
    });
    if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });
    if (job.status !== "waiting_for_mfa") {
      return res.status(409).json({ ok: false, error: "job_not_waiting_for_mfa" });
    }

    const result = await findCarrierEmailVerificationCode({
      tenantId: device.tenantId,
      userId: device.userId,
      carrierName: job.carrierName,
      carrierHost: parsed.data.carrierHost,
      jobCreatedAt: job.createdAt,
      excludeMessageKeys: parsed.data.excludeMessageKeys,
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

connectExtensionRoutes.post("/jobs/:jobId/status", async (req, res, next) => {
  try {
    const device = connectDevice(res);
    const parsed = jobStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_job_status" });
    if (parsed.data.result && containsSensitiveValue(parsed.data.result)) {
      return res.status(400).json({ ok: false, error: "sensitive_job_result_rejected" });
    }

    const job = await prisma.carrierAutomationJob.findFirst({
      where: {
        id: req.params.jobId,
        tenantId: device.tenantId,
        userId: device.userId,
        deviceId: device.id,
      },
    });
    if (!job) return res.status(404).json({ ok: false, error: "job_not_found" });

    const currentStatus = job.status as JobStatus;
    const nextStatus = parsed.data.status;
    if (currentStatus !== nextStatus && !allowedTransitions[currentStatus]?.has(nextStatus)) {
      return res.status(409).json({
        ok: false,
        error: "invalid_job_transition",
        currentStatus,
        requestedStatus: nextStatus,
      });
    }
    if (
      nextStatus === "completed" &&
      !isVerifiedResultForJob(job.jobType, parsed.data.result)
    ) {
      return res.status(400).json({ ok: false, error: "verified_result_required" });
    }

    const terminal = TERMINAL_JOB_STATUSES.has(nextStatus);
    const updated = await prisma.carrierAutomationJob.update({
      where: { id: job.id },
      data: {
        status: nextStatus,
        result: parsed.data.result ? (parsed.data.result as Prisma.InputJsonValue) : undefined,
        errorCode: parsed.data.errorCode ?? null,
        errorMessage: parsed.data.errorMessage ?? null,
        leaseExpiresAt: terminal ? null : new Date(Date.now() + JOB_LEASE_MS),
        completedAt: terminal ? new Date() : null,
      },
    });
    await recordConnectAudit({
      tenantId: device.tenantId,
      actorId: device.userId,
      action: "connect.job.status_changed",
      entityType: "carrier_automation_job",
      entityId: job.id,
      metadata: {
        ...connectJobAuditMetadata(updated),
        previousStatus: currentStatus,
        nextStatus,
        errorCode: parsed.data.errorCode ?? null,
      },
    });
    await prisma.connectDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    res.json({ ok: true, job: extensionJob(updated) });
  } catch (error) {
    next(error);
  }
});

async function requireConnectDevice(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.match(/^QuotexConnect\s+(.+)$/i)?.[1]?.trim();
  if (!token) return res.status(401).json({ ok: false, error: "connect_auth_required" });
  try {
    const device = await prisma.connectDevice.findUnique({
      where: { tokenHash: secureHash(token) },
      include: { user: true, agency: true },
    });
    if (!device?.active) return res.status(401).json({ ok: false, error: "connect_device_revoked" });
    if (device.user.status !== "active") return res.status(403).json({ ok: false, error: "account_inactive" });
    if (!device.agency.active) return res.status(403).json({ ok: false, error: "agency_inactive" });
    res.locals.connectDevice = {
      id: device.id,
      tenantId: device.tenantId,
      userId: device.userId,
      label: device.label,
    } satisfies ExtensionDevice;
    next();
  } catch {
    return res.status(503).json({ ok: false, error: "connect_service_unavailable" });
  }
}

function connectDevice(res: Response): ExtensionDevice {
  return res.locals.connectDevice as ExtensionDevice;
}

function createPairingCode(): string {
  const bytes = randomBytes(8);
  const raw = Array.from(bytes, (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function secureHash(value: string): string {
  const pepper = process.env.CONNECT_PAIRING_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (!pepper) throw new Error("connect_pairing_secret_not_configured");
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

async function recordConnectAudit(input: {
  tenantId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
}) {
  if (containsSensitiveValue(input.metadata)) {
    throw new Error("sensitive_connect_audit_metadata_rejected");
  }
  await prisma.auditLog.create({
    data: {
      id: `audit_${randomUUID()}`,
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

function connectJobAuditMetadata(job: {
  quoteSessionId: string | null;
  carrierId: string;
  carrierName: string;
  jobType: string;
  status: string;
  deviceId?: string | null;
}) {
  return {
    quoteSessionId: job.quoteSessionId,
    carrierId: job.carrierId,
    carrierName: job.carrierName,
    jobType: job.jobType,
    status: job.status,
    deviceId: job.deviceId ?? null,
  };
}

function containsSensitiveValue(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  if (Array.isArray(value)) return value.some((item) => containsSensitiveValue(item, seen));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => SENSITIVE_KEY.test(key) || containsSensitiveValue(nested, seen)
  );
}

function isVerifiedResult(result: Record<string, unknown> | undefined): boolean {
  if (!result) return false;
  const verification = result.verification;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) return false;
  const record = verification as Record<string, unknown>;
  if (record.verified !== true || record.source !== "carrier_portal") return false;
  if (typeof record.portalUrl !== "string" || typeof record.verifiedAt !== "string") return false;
  try {
    const url = new URL(record.portalUrl);
    if (url.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return Number.isFinite(Date.parse(record.verifiedAt));
}

function isVerifiedResultForJob(
  jobType: string,
  result: Record<string, unknown> | undefined
): boolean {
  if (!isVerifiedResult(result)) return false;
  if (jobType !== "retrieve_quote") return true;

  const quote =
    result?.quote && typeof result.quote === "object" && !Array.isArray(result.quote)
      ? (result.quote as Record<string, unknown>)
      : result;
  const premium = Number(quote?.premium ?? quote?.annualPremium);
  const reference = String(
    quote?.carrierReference ?? quote?.quoteNumber ?? quote?.reference ?? ""
  ).trim();
  return Number.isFinite(premium) && premium > 0 && reference.length > 0;
}

function publicJob(job: {
  id: string;
  quoteSessionId: string | null;
  carrierId: string;
  carrierName: string;
  jobType: string;
  status: string;
  result: Prisma.JsonValue | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: job.id,
    quoteSessionId: job.quoteSessionId,
    carrierId: job.carrierId,
    carrierName: job.carrierName,
    jobType: job.jobType,
    status: job.status,
    result: job.result,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

function extensionJob(job: {
  id: string;
  quoteSessionId: string | null;
  carrierId: string;
  carrierName: string;
  jobType: string;
  payload: Prisma.JsonValue;
  status: string;
  result: Prisma.JsonValue | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: job.id,
    quoteSessionId: job.quoteSessionId,
    carrierId: job.carrierId,
    carrierName: job.carrierName,
    jobType: job.jobType,
    payload: job.payload,
    status: job.status,
    result: job.result,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
