import { createHash, createHmac, pbkdf2Sync, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { compareSync as compareBcrypt, hashSync as hashBcrypt } from "bcryptjs";
import { Router, type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { authenticateRequest, requireAuth, validateAuthContext } from "../middleware/auth.js";
import { authIdentityLimiter, authIpLimiter } from "../middleware/rateLimits.js";
import { sendEmail } from "../services/email.js";
import { databaseConfigured, prisma } from "../services/prisma.js";
import { readRemoteState, supabaseStateConfigured } from "../services/supabaseState.js";

export const authRoutes = Router();

const MANAGER_STEP_UP_TTL_MS = 10 * 60 * 1000;
const MANAGER_STEP_UP_MAX_ATTEMPTS = 5;
const SESSION_TTL = "8h";

type ManagerStepUpChallenge = {
  id: string;
  tenantId: string | null;
  userId: string;
  email: string;
  purpose: "client_encrypted_info";
  customerId?: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  consumedAt?: number;
};

const managerChallenges = new Map<string, ManagerStepUpChallenge>();
let managerStepUpTableReady: Promise<void> | null = null;
const PLATFORM_TENANT_ID = "agency_quotex_platform";

type ManagerStepUpChallengeRow = {
  id: string;
  tenant_id: string | null;
  user_id: string;
  email: string;
  purpose: "client_encrypted_info";
  customer_id: string | null;
  code_hash: string;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
};

const endpoints = [
  { method: "POST", path: "/login", description: "Canonical customer, staff, and master login" },
  { method: "POST", path: "/register", description: "Canonical customer and agency staff registration" },
  { method: "GET", path: "/session", description: "Return current canonical session user" },
  { method: "POST", path: "/password/reset-request", description: "Email a one-time password reset link" },
  { method: "POST", path: "/password/reset", description: "Consume a one-time password reset token" },
  { method: "POST", path: "/google/callback", description: "Exchange Google id_token -> session" },
  { method: "POST", path: "/email/send-link", description: "Send magic link to customer email" },
  { method: "POST", path: "/email/verify", description: "Verify magic link token, create session" },
  { method: "POST", path: "/employee/login", description: "Agency user login (email+password+MFA)" },
  { method: "POST", path: "/employee/register", description: "Create a hashed agency staff account" },
  { method: "POST", path: "/master/login", description: "Master admin login with a server-issued platform session" },
  { method: "POST", path: "/master/create", description: "Create the one allowed master admin account" },
  { method: "POST", path: "/password/change", description: "Change the current user's server-backed password" },
  { method: "POST", path: "/manager-2fa/request", description: "Email a manager step-up verification code" },
  { method: "POST", path: "/manager-2fa/verify", description: "Verify a manager step-up code" },
  { method: "POST", path: "/logout", description: "Invalidate session" },
  { method: "GET", path: "/me", description: "Return current session user" },
];

authRoutes.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

const requestManagerStepUpSchema = z.object({
  email: z.string().email().max(254).optional(),
  purpose: z.literal("client_encrypted_info").default("client_encrypted_info"),
  customerId: z.string().max(120).optional(),
});

const verifyManagerStepUpSchema = z.object({
  challengeId: z.string().min(10).max(120),
  code: z.string().regex(/^\d{6}$/),
  purpose: z.literal("client_encrypted_info").default("client_encrypted_info"),
  customerId: z.string().max(120).optional(),
});

const employeeLoginSchema = z.object({
  identifier: z.string().min(3).max(254),
  password: z.string().min(1).max(500),
});

const canonicalLoginSchema = z.object({
  scope: z.enum(["customer", "staff", "master"]),
  identifier: z.string().min(3).max(254),
  password: z.string().min(1).max(500),
  tenantId: z.string().min(1).max(120).optional().nullable(),
});

const canonicalRegisterSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("staff"),
    agencyCode: z.string().min(3).max(80),
    branchId: z.string().max(120).optional(),
    role: z.enum(["agent", "manager", "csr"]),
    firstName: z.string().min(1).max(120),
    lastName: z.string().min(1).max(120),
    phone: z.string().min(1).max(80),
    businessEmail: z.string().email().max(254),
    password: z.string().min(8).max(500),
  }),
  z.object({
    scope: z.literal("customer"),
    tenantId: z.string().min(1).max(120),
    branchId: z.string().max(120).optional(),
    name: z.string().min(1).max(240),
    email: z.string().email().max(254),
    phone: z.string().max(80).optional(),
    password: z.string().min(8).max(500),
  }),
]);

const passwordResetRequestSchema = z.object({
  email: z.string().email().max(254),
  scope: z.enum(["customer", "staff", "master"]).optional(),
  tenantId: z.string().min(1).max(120).optional().nullable(),
});

const passwordResetSchema = z.object({
  token: z.string().min(32).max(500),
  newPassword: z.string().min(8).max(500),
});

const masterLoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(500),
});

const masterCreateSchema = z.object({
  name: z.string().min(1).max(240),
  email: z.string().email().max(254),
  password: z.string().min(12).max(500),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(500),
  newPassword: z.string().min(8).max(500),
});

const optionalSnapshotEmailSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().email().max(254).optional()
);

const staffAgencySnapshotSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
  contactEmail: optionalSnapshotEmailSchema,
  phone: z.string().max(80).optional(),
  address: z.string().max(500).optional(),
  website: z.string().max(500).optional(),
  websiteSlug: z.string().max(120).optional(),
  websiteEnabled: z.boolean().optional(),
  tier: z.string().max(80).optional(),
  active: z.boolean().optional(),
  allowedUsers: z.number().int().min(1).max(1000).optional(),
  agencyCode: z.string().max(80).optional(),
  agencyCodeEncrypted: z.string().max(500).optional(),
  agencyCodePreview: z.string().max(40).optional(),
});

const staffBranchSnapshotSchema = z.object({
  id: z.string().min(1).max(120),
  agencyId: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  address: z.string().max(500).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(40).optional(),
  zip: z.string().max(40).optional(),
  phone: z.string().max(80).optional(),
});

const employeeRegisterSchema = z.object({
  agencyCode: z.string().min(3).max(80),
  branchId: z.string().max(120).optional(),
  role: z.enum(["agent", "manager", "csr"]),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  phone: z.string().min(1).max(80),
  businessEmail: z.string().email().max(254),
  password: z.string().min(8).max(500),
  agency: staffAgencySnapshotSchema.optional(),
  branch: staffBranchSnapshotSchema.optional().nullable(),
});

authRoutes.get("/", (_req, res) => res.json({ resource: "auth", endpoints }));

authRoutes.post("/login", authIpLimiter, authIdentityLimiter, canonicalAsync(async (req, res) => {
  if (!databaseConfigured()) {
    return authFailure(res, 503, "server_unreachable", "Server authentication is not connected to the production database.");
  }
  const parsed = canonicalLoginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return authFailure(res, 400, "invalid_credentials", "Login request is incomplete.");
  }

  const identifier = parsed.data.identifier.trim().toLowerCase();
  const password = parsed.data.password;
  if (parsed.data.scope === "master") {
    const result = await authenticateMasterForLogin(identifier, password);
    if (!result.ok) return authFailure(res, result.status, result.reason);
    return sendCanonicalSession(res, result.user);
  }
  if (parsed.data.scope === "staff") {
    const result = await authenticateStaffForLogin(identifier, password);
    if (!result.ok) return authFailure(res, result.status, result.reason);
    return sendCanonicalSession(res, result.user);
  }

  const result = await authenticateCustomerForLogin(identifier, password, parsed.data.tenantId);
  if (!result.ok) return authFailure(res, result.status, result.reason);
  return sendCanonicalSession(res, result.user);
}));

authRoutes.post("/register", authIpLimiter, authIdentityLimiter, canonicalAsync(async (req, res) => {
  if (!databaseConfigured()) {
    return authFailure(res, 503, "server_unreachable", "Server authentication is not connected to the production database.");
  }
  const parsed = canonicalRegisterSchema.safeParse(req.body ?? {});
  if (!parsed.success) return authFailure(res, 400, "invalid_credentials", "Registration request is incomplete.");

  if (parsed.data.scope === "staff") {
    const result = await createServerStaffAccount(parsed.data);
    if (!result.ok) {
      const status = result.error === "inactive_agency" ? 403 : result.error === "duplicate_email" || result.error === "slot_limit" ? 409 : result.error === "agency_not_found" ? 404 : 400;
      const reason: AuthFailReason = result.error === "inactive_agency" ? "agency_inactive" : result.error === "duplicate_email" ? "invalid_credentials" : "account_not_found";
      return res.status(status).json({ ok: false, reason, error: result.error });
    }
    return sendCanonicalSession(res, result.user);
  }

  const input = parsed.data;
  const email = input.email.trim().toLowerCase();
  const agency = await prisma.agency.findUnique({ where: { id: input.tenantId } });
  if (!agency) return authFailure(res, 404, "account_not_found");
  if (!agency.active) return authFailure(res, 403, "agency_inactive");
  const existing = await prisma.user.findFirst({
    where: {
      tenantId: agency.id,
      email: { equals: email, mode: "insensitive" },
    },
  });
  if (existing) return authFailure(res, 409, existing.role === "customer" ? "invalid_credentials" : "wrong_portal");
  const branchId = input.branchId ? await resolveBranchForStaff(input.branchId, agency.id) : null;
  if (input.branchId && !branchId) return authFailure(res, 400, "invalid_credentials");

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        id: `user_${randomUUID()}`,
        tenantId: agency.id,
        branchId,
        name: input.name.trim(),
        email,
        phone: input.phone?.trim() || null,
        role: "customer",
        status: "active",
        passwordHash: hashPasswordForStorage(input.password),
        passwordChangedAt: new Date(),
        profile: { profileCompleted: true },
        permissions: {},
      },
    });
    await tx.customerProfile.create({
      data: {
        id: `customer_${randomUUID()}`,
        tenantId: agency.id,
        userId: created.id,
        branchId,
        name: created.name,
        email: created.email,
        phone: created.phone,
      },
    });
    return created;
  });
  return sendCanonicalSession(res, { ...user, agency });
}));

authRoutes.post("/password/reset-request", authIpLimiter, authIdentityLimiter, canonicalAsync(async (req, res) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success || !databaseConfigured()) return res.status(202).json({ ok: true });
  try {
    const email = parsed.data.email.trim().toLowerCase();
    let user = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      ...(parsed.data.scope ? { role: parsed.data.scope === "staff" ? { in: [...ACTIVE_STAFF_ROLES] } : parsed.data.scope === "master" ? "master_admin" : "customer" } : {}),
      ...(parsed.data.tenantId ? { tenantId: parsed.data.tenantId } : {}),
      status: { in: ["active", "inactive"] },
    },
    include: { agency: true },
  });
    if (!user && parsed.data.scope) {
      await migrateLegacySnapshotIdentity(parsed.data.scope, email, parsed.data.tenantId);
      user = await prisma.user.findFirst({
        where: {
          email: { equals: email, mode: "insensitive" },
          role: parsed.data.scope === "staff" ? { in: [...ACTIVE_STAFF_ROLES] } : parsed.data.scope === "master" ? "master_admin" : "customer",
          ...(parsed.data.tenantId ? { tenantId: parsed.data.tenantId } : {}),
          status: { in: ["active", "inactive"] },
        },
        include: { agency: true },
      });
    }
    if (user && (user.role === "master_admin" || user.agency?.active)) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashResetToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.$transaction([
      prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.create({ data: { id: `reset_${randomUUID()}`, userId: user.id, tokenHash, expiresAt } }),
    ]);
      const base = (process.env.FRONTEND_ORIGIN || "https://quotexinsurance.com").replace(/\/$/, "");
      const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;
      const delivery = await sendEmail({
      to: user.email,
      subject: "Reset your Quotex password",
      text: `Use this secure link to reset your Quotex password. It expires in 30 minutes: ${resetUrl}`,
      html: `<p>Use the secure link below to reset your Quotex password. It expires in 30 minutes.</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p>`,
      categories: ["security", "password-reset"],
    });
      if (delivery.status !== "sent") console.error("[auth] password reset email failed", { userId: user.id, provider: delivery.provider, error: delivery.error });
    }
  } catch (error) {
    console.error("[auth] password reset request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return res.status(202).json({ ok: true });
}));

authRoutes.post("/password/reset", authIpLimiter, authIdentityLimiter, canonicalAsync(async (req, res) => {
  if (!databaseConfigured()) return authFailure(res, 503, "server_unreachable");
  const parsed = passwordResetSchema.safeParse(req.body ?? {});
  if (!parsed.success) return authFailure(res, 400, "invalid_credentials");
  const tokenHash = hashResetToken(parsed.data.token);
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) return authFailure(res, 400, "invalid_credentials");
  await prisma.$transaction([
    prisma.user.update({
      where: { id: reset.userId },
      data: {
        passwordHash: hashPasswordForStorage(parsed.data.newPassword),
        passwordChangedAt: new Date(),
        authVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
  return res.json({ ok: true });
}));

authRoutes.post("/master/login", async (req, res) => {
  if (!databaseConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "database_unavailable",
      message: "Server authentication is not connected to the production database.",
    });
  }
  const parsed = masterLoginSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const result = await authenticateMasterForLogin(parsed.data.email.trim().toLowerCase(), parsed.data.password);
  if (!result.ok) return authFailure(res, result.status, result.reason);
  return sendCanonicalSession(res, result.user);
});

authRoutes.post("/master/create", async (req, res) => {
  if (!databaseConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "database_unavailable",
      message: "Server authentication is not connected to the production database.",
    });
  }
  const parsed = masterCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.user.findFirst({ where: { role: "master_admin" } });
  if (existing) {
    if (existing.email.toLowerCase() !== email || blockedStaffStatus(existing.status)) {
      return res.status(409).json({ ok: false, error: "master_account_exists" });
    }
    if (existing.passwordHash && verifyPasswordHashForLogin(parsed.data.password, existing.passwordHash)) {
      await prisma.user.update({ where: { id: existing.id }, data: { lastLoginAt: new Date() } }).catch(() => null);
      return sendMasterSession(res, existing);
    }
    if (!existing.passwordHash) return authFailure(res, 409, "password_not_set");
    return res.status(409).json({ ok: false, error: "master_account_exists" });
  }

  const platformTenant = await ensurePlatformTenant();
  const user = await prisma.user.create({
    data: {
      id: `user_${randomUUID()}`,
      tenantId: platformTenant.id,
      name: parsed.data.name.trim(),
      email,
      phone: null,
      role: "master_admin",
      status: "active",
      passwordHash: hashPasswordForStorage(parsed.data.password),
      passwordChangedAt: new Date(),
      profile: { profileCompleted: true, platformOwner: true },
      permissions: {},
      lastLoginAt: new Date(),
    },
  });

  return sendMasterSession(res, user);
});

authRoutes.post("/employee/login", async (req, res) => {
  if (!databaseConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "database_unavailable",
      message: "Server authentication is not connected to the production database.",
    });
  }
  const parsed = employeeLoginSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const result = await authenticateStaffForLogin(parsed.data.identifier.trim().toLowerCase(), parsed.data.password);
  if (!result.ok) return authFailure(res, result.status, result.reason);
  return sendCanonicalSession(res, result.user);
});

authRoutes.post("/employee/register", async (req, res) => {
  if (!databaseConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "database_unavailable",
      message: "Server authentication is not connected to the production database.",
    });
  }
  const parsed = employeeRegisterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const error = employeeRegisterErrorCode(req.body, parsed.error);
    return res.status(400).json({ ok: false, error, details: parsed.error.flatten() });
  }

  const result = await createServerStaffAccount(parsed.data);
  if (!result.ok) {
    const status =
      result.error === "inactive_agency" ? 403 :
      result.error === "duplicate_email" ? 409 :
      result.error === "slot_limit" ? 409 :
      result.error === "weak_password" ? 400 :
      result.error === "missing_fields" ? 400 :
      404;
    return res.status(status).json({ ok: false, error: result.error });
  }

  const { user } = result;
  const token = issueSessionJwt({
    userId: user.id,
    role: user.role,
    tenantId: user.tenantId,
    branchId: user.branchId,
    permissions: permissionsFromJson(user.permissions),
    authVersion: user.authVersion,
  });
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => null);

  return res.json(staffSessionResponse(token, user));
});

authRoutes.post("/manager-2fa/request", requireAuth, async (req, res) => {
  if (!req.auth || !canRequestManagerStepUp(req.auth.role)) {
    return res.status(403).json({ ok: false, error: "manager_required" });
  }
  const parsed = requestManagerStepUpSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const recipientEmail = await managerStepUpRecipientEmail(req.auth.userId, parsed.data.email);
  if (!recipientEmail) {
    return res.status(503).json({
      ok: false,
      error: "recipient_unavailable",
      message: "Verification email could not be started because the signed-in manager email is unavailable.",
    });
  }

  await purgeExpiredChallenges();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = randomUUID();
  const challenge: ManagerStepUpChallenge = {
    id,
    tenantId: req.auth.tenantId,
    userId: req.auth.userId,
    email: recipientEmail,
    purpose: parsed.data.purpose,
    customerId: parsed.data.customerId,
    codeHash: hashStepUpCode(id, code),
    expiresAt: Date.now() + MANAGER_STEP_UP_TTL_MS,
    attempts: 0,
  };

  try {
    await saveManagerChallenge(challenge);
  } catch {
    return res.status(503).json({
      ok: false,
      error: "challenge_store_unavailable",
      message: "Verification could not be started. Please try again in a moment.",
    });
  }

  const email = await sendEmail({
    to: challenge.email,
    subject: "Your Quotex manager verification code",
    text: `Your Quotex verification code is ${code}. It expires in 10 minutes. If you did not request this code, contact support immediately.`,
    html: managerStepUpEmailHtml(code),
    categories: ["security", "manager-step-up"],
  });

  if (email.status !== "sent") {
    await deleteManagerChallenge(challenge.id);
    return res.status(503).json({
      ok: false,
      error: "email_unavailable",
      message: email.error ?? "Verification email could not be sent.",
      configured: email.configured,
      provider: email.provider,
    });
  }

  res.json({
    ok: true,
    challengeId: id,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    maskedEmail: maskEmail(challenge.email),
  });
});

authRoutes.post("/manager-2fa/verify", requireAuth, async (req, res) => {
  if (!req.auth || !canRequestManagerStepUp(req.auth.role)) {
    return res.status(403).json({ ok: false, error: "manager_required" });
  }
  const parsed = verifyManagerStepUpSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  await purgeExpiredChallenges();
  const challenge = await loadManagerChallenge(parsed.data.challengeId);
  if (!challenge) return res.status(400).json({ ok: false, error: "challenge_not_found" });
  if (challenge.userId !== req.auth.userId || challenge.tenantId !== req.auth.tenantId) {
    return res.status(403).json({ ok: false, error: "challenge_scope_mismatch" });
  }
  if (challenge.purpose !== parsed.data.purpose || challenge.customerId !== parsed.data.customerId) {
    return res.status(400).json({ ok: false, error: "challenge_purpose_mismatch" });
  }
  if (challenge.consumedAt) return res.status(400).json({ ok: false, error: "challenge_consumed" });
  if (challenge.expiresAt < Date.now()) {
    await deleteManagerChallenge(challenge.id);
    return res.status(400).json({ ok: false, error: "challenge_expired" });
  }
  if (challenge.attempts >= MANAGER_STEP_UP_MAX_ATTEMPTS) {
    await deleteManagerChallenge(challenge.id);
    return res.status(429).json({ ok: false, error: "too_many_attempts" });
  }

  const attempts = challenge.attempts + 1;
  const ok = timingSafeEqualString(challenge.codeHash, hashStepUpCode(challenge.id, parsed.data.code));
  if (!ok) {
    if (attempts >= MANAGER_STEP_UP_MAX_ATTEMPTS) {
      await deleteManagerChallenge(challenge.id);
    } else {
      await updateManagerChallengeAttempts(challenge.id, attempts);
    }
    return res.status(400).json({ ok: false, error: "invalid_code" });
  }

  await deleteManagerChallenge(challenge.id);
  res.json({
    ok: true,
    verified: true,
    purpose: challenge.purpose,
    customerId: challenge.customerId,
    verifiedAt: new Date().toISOString(),
  });
});

authRoutes.get("/me", requireAuth, async (req, res) => {
  if (!req.auth) return res.status(401).json({ ok: false, error: "unauthorized" });
  if (!databaseConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "database_unavailable",
      message: "Server authentication is not connected to the production database.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    include: { agency: true },
  });
  if (!user || blockedStaffStatus(user.status)) {
    return res.status(401).json({ ok: false, error: "invalid_session" });
  }
  if (user.role !== "master_admin" && !user.agency?.active) {
    return res.status(403).json({ ok: false, error: "inactive_agency" });
  }

  res.json({
    ok: true,
    user: {
      id: user.id,
      tenantId: user.role === "master_admin" ? null : user.tenantId,
      branchId: user.branchId,
      role: user.role,
      email: user.email,
      name: user.name,
      agency: user.role === "master_admin" ? undefined : sessionAgencyPayload(user.agency),
    },
  });
});

authRoutes.get("/session", canonicalAsync(async (req, res) => {
  const authenticated = authenticateRequest(req);
  if (!authenticated) return authFailure(res, 401, "no_session");
  const validation = await validateAuthContext(authenticated);
  if (!validation.ok) return authFailure(res, validation.status, validation.reason);
  req.auth = validation.auth;

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    include: { agency: true },
  });
  if (!user || blockedStaffStatus(user.status)) {
    return authFailure(res, 401, "invalid_credentials");
  }
  if (user.role !== "master_admin" && !user.agency?.active) {
    return authFailure(res, 403, "agency_inactive");
  }

  return res.json({
    ok: true,
    user: {
      id: user.id,
      tenantId: user.role === "master_admin" ? null : user.tenantId,
      branchId: user.branchId,
      role: user.role,
      email: user.email,
      name: user.name,
      agency: user.role === "master_admin" ? undefined : sessionAgencyPayload(user.agency),
    },
  });
}));

authRoutes.post("/logout", requireAuth, canonicalAsync(async (req, res) => {
  if (!req.auth) return authFailure(res, 401, "no_session");
  await prisma.user.update({
    where: { id: req.auth.userId },
    data: { authVersion: { increment: 1 } },
  });
  return res.json({ ok: true });
}));

authRoutes.post("/password/change", requireAuth, canonicalAsync(async (req, res) => {
  if (!req.auth) return authFailure(res, 401, "invalid_credentials");
  if (!databaseConfigured()) {
    return authFailure(res, 503, "server_unreachable", "Server authentication is not connected to the production database.");
  }
  const parsed = changePasswordSchema.safeParse(req.body ?? {});
  if (!parsed.success) return authFailure(res, 400, "invalid_credentials", "Password change request is incomplete.");

  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    include: { agency: true },
  });
  if (!user || blockedStaffStatus(user.status)) return authFailure(res, 403, "account_disabled");
  if (user.role !== "master_admin" && !user.agency?.active) return authFailure(res, 403, "agency_inactive");
  if (!user.passwordHash) return authFailure(res, 409, "password_not_set");
  if (!verifyPasswordHashForLogin(parsed.data.currentPassword, user.passwordHash)) {
    return authFailure(res, 401, "invalid_credentials");
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPasswordForStorage(parsed.data.newPassword),
      passwordChangedAt: new Date(),
      authVersion: { increment: 1 },
    },
    include: { agency: true },
  });
  return sendCanonicalSession(res, updated);
}));

for (const endpoint of endpoints) {
  if (endpoint.path === "/" || endpoint.path.startsWith("/manager-2fa/")) continue;
  const method = endpoint.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  authRoutes[method](endpoint.path, (_req, res) =>
    res.status(501).json({
      error: "not_implemented",
      resource: "auth",
      endpoint: `${endpoint.method} ${endpoint.path}`,
      description: endpoint.description,
    })
  );
}

type SnapshotRecord = Record<string, unknown>;
type StaffRegisterInput = z.infer<typeof employeeRegisterSchema>;
type StaffBranchSnapshotInput = z.infer<typeof staffBranchSnapshotSchema>;
type StaffInputErrorCode = "missing_fields" | "invalid_email" | "weak_password";
type StaffAccountResult =
  | { ok: true; user: Awaited<ReturnType<typeof prisma.user.findFirst>> & { agency: NonNullable<Awaited<ReturnType<typeof prisma.agency.findFirst>>> } }
  | { ok: false; error: "agency_not_found" | "inactive_agency" | "duplicate_email" | "slot_limit" | "weak_password" | "missing_fields" | "invalid_credentials" };
type MasterSessionUser = {
  id: string;
  tenantId: string;
  branchId: string | null;
  role: string;
  status: string;
  passwordHash: string | null;
  email: string;
  name: string;
  permissions: unknown;
  authVersion: number;
};
type SessionAgency = {
  id: string;
  name: string;
  contactEmail: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  websiteSlug: string | null;
  websiteEnabled: boolean;
  serviceAreas: unknown;
  agencyCodePreview: string | null;
  tier: string;
  active: boolean;
  allowedUsers: number;
  allowedProspectsPerMonth: number;
  allowedAiMessagesPerMonth: number;
  allowedCarriers: number;
  createdAt: Date;
};

const SNAPSHOT_STAFF_ROLES = new Set(["agent", "manager", "csr"]);
const ACTIVE_STAFF_ROLES = ["agent", "manager", "csr", "agency_owner", "agency_admin"] as const;

type AuthFailReason =
  | "invalid_credentials"
  | "account_not_found"
  | "account_disabled"
  | "agency_inactive"
  | "password_not_set"
  | "rate_limited"
  | "server_unreachable"
  | "wrong_portal"
  | "no_session";

type CanonicalSessionUser = {
  id: string;
  tenantId: string;
  branchId: string | null;
  role: string;
  status: string;
  passwordHash: string | null;
  email: string;
  name: string;
  permissions: unknown;
  authVersion: number;
  agency?: SessionAgency | null;
};

type LoginOutcome =
  | { ok: true; user: CanonicalSessionUser }
  | { ok: false; status: number; reason: AuthFailReason };

function authFailure(res: Response, status: number, reason: AuthFailReason, message?: string) {
  return res.status(status).json({
    ok: false,
    reason,
    error: reason,
    ...(message ? { message } : {}),
  });
}

function sendCanonicalSession(res: Response, user: CanonicalSessionUser) {
  const isMaster = user.role === "master_admin";
  const token = issueSessionJwt({
    userId: user.id,
    role: user.role,
    tenantId: isMaster ? null : user.tenantId,
    branchId: user.branchId,
    permissions: permissionsFromJson(user.permissions),
    authVersion: user.authVersion,
  });

  return res.json({
    ok: true,
    token,
    expiresIn: SESSION_TTL,
    user: {
      id: user.id,
      tenantId: isMaster ? null : user.tenantId,
      branchId: user.branchId,
      role: user.role,
      email: user.email,
      name: user.name,
      agency: isMaster ? undefined : sessionAgencyPayload(user.agency),
    },
  });
}

async function authenticateMasterForLogin(email: string, password: string): Promise<LoginOutcome> {
  let user = await prisma.user.findFirst({
    where: { role: "master_admin", email: { equals: email, mode: "insensitive" } },
  });
  if (!user && await migrateLegacySnapshotIdentity("master", email)) {
    user = await prisma.user.findFirst({
      where: { role: "master_admin", email: { equals: email, mode: "insensitive" } },
    });
  }
  if (!user) {
    const otherPortal = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    return { ok: false, status: otherPortal ? 403 : 401, reason: otherPortal ? "wrong_portal" : "account_not_found" };
  }
  if (blockedStaffStatus(user.status)) return { ok: false, status: 403, reason: "account_disabled" };
  if (!user.passwordHash) return { ok: false, status: 409, reason: "password_not_set" };
  if (!verifyPasswordHashForLogin(password, user.passwordHash)) {
    return { ok: false, status: 401, reason: "invalid_credentials" };
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      ...(passwordHashNeedsUpgrade(user.passwordHash) ? { passwordHash: hashPasswordForStorage(password) } : {}),
    },
  }).catch(() => user);
  return { ok: true, user: { ...updated, agency: null } };
}

async function authenticateStaffForLogin(identifier: string, password: string): Promise<LoginOutcome> {
  let candidates = await prisma.user.findMany({
    where: {
      role: { in: [...ACTIVE_STAFF_ROLES] },
      email: { equals: identifier, mode: "insensitive" },
    },
    include: { agency: true },
  });
  if (candidates.length === 0 && await migrateLegacySnapshotIdentity("staff", identifier)) {
    candidates = await prisma.user.findMany({
      where: {
        role: { in: [...ACTIVE_STAFF_ROLES] },
        email: { equals: identifier, mode: "insensitive" },
      },
      include: { agency: true },
    });
  }
  if (candidates.length === 0) {
    const otherPortal = await prisma.user.findFirst({ where: { email: { equals: identifier, mode: "insensitive" } } });
    if (otherPortal) return { ok: false, status: 403, reason: "wrong_portal" };
    return { ok: false, status: 401, reason: "account_not_found" };
  }
  if (candidates.every((candidate) => !candidate.agency?.active)) {
    return { ok: false, status: 403, reason: "agency_inactive" };
  }
  if (candidates.every((candidate) => permanentlyBlockedStatus(candidate.status))) {
    return { ok: false, status: 403, reason: "account_disabled" };
  }
  const matches = candidates.filter((candidate) =>
    Boolean(candidate.passwordHash && verifyPasswordHashForLogin(password, candidate.passwordHash))
  );
  if (matches.length === 0) {
    if (candidates.every((candidate) => !candidate.passwordHash)) {
      if (candidates.every((candidate) => !candidate.agency?.active)) {
        return { ok: false, status: 403, reason: "agency_inactive" };
      }
      if (candidates.every((candidate) => permanentlyBlockedStatus(candidate.status))) {
        return { ok: false, status: 403, reason: "account_disabled" };
      }
      return { ok: false, status: 409, reason: "password_not_set" };
    }
    return { ok: false, status: 401, reason: "invalid_credentials" };
  }
  if (matches.length > 1) return { ok: false, status: 401, reason: "invalid_credentials" };
  const user = matches[0];
  if (!user.passwordHash) return { ok: false, status: 409, reason: "password_not_set" };
  if (!user.agency?.active) return { ok: false, status: 403, reason: "agency_inactive" };
  if (permanentlyBlockedStatus(user.status)) return { ok: false, status: 403, reason: "account_disabled" };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(user.status === "inactive" ? { status: "active" } : {}),
      lastLoginAt: new Date(),
      ...(passwordHashNeedsUpgrade(user.passwordHash) ? { passwordHash: hashPasswordForStorage(password) } : {}),
    },
    include: { agency: true },
  }).catch(() => user);
  return { ok: true, user: updated };
}

async function authenticateCustomerForLogin(email: string, password: string, tenantId?: string | null): Promise<LoginOutcome> {
  const where = {
    role: "customer",
    email: { equals: email, mode: "insensitive" as const },
    ...(tenantId ? { tenantId } : {}),
  };
  let candidates = await prisma.user.findMany({ where, include: { agency: true } });
  if (candidates.length === 0 && await migrateLegacySnapshotIdentity("customer", email, tenantId)) {
    candidates = await prisma.user.findMany({ where, include: { agency: true } });
  }
  if (candidates.length === 0) {
    const otherPortal = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        ...(tenantId ? { tenantId } : {}),
      },
    });
    if (otherPortal) return { ok: false, status: 403, reason: "wrong_portal" };
    return { ok: false, status: 401, reason: "account_not_found" };
  }
  if (candidates.every((candidate) => !candidate.agency?.active)) {
    return { ok: false, status: 403, reason: "agency_inactive" };
  }
  if (candidates.every((candidate) => blockedStaffStatus(candidate.status))) {
    return { ok: false, status: 403, reason: "account_disabled" };
  }

  const matches = candidates.filter((candidate) =>
    Boolean(candidate.passwordHash && verifyPasswordHashForLogin(password, candidate.passwordHash))
  );
  if (matches.length === 0) {
    if (candidates.every((candidate) => !candidate.passwordHash)) {
      if (candidates.every((candidate) => !candidate.agency?.active)) {
        return { ok: false, status: 403, reason: "agency_inactive" };
      }
      if (candidates.every((candidate) => blockedStaffStatus(candidate.status))) {
        return { ok: false, status: 403, reason: "account_disabled" };
      }
      return { ok: false, status: 409, reason: "password_not_set" };
    }
    return { ok: false, status: 401, reason: "invalid_credentials" };
  }
  if (matches.length > 1) return { ok: false, status: 401, reason: "invalid_credentials" };
  const user = matches[0];
  if (!user.passwordHash) return { ok: false, status: 409, reason: "password_not_set" };

  if (!user.agency?.active) return { ok: false, status: 403, reason: "agency_inactive" };
  if (blockedStaffStatus(user.status)) return { ok: false, status: 403, reason: "account_disabled" };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      ...(passwordHashNeedsUpgrade(user.passwordHash) ? { passwordHash: hashPasswordForStorage(password) } : {}),
    },
    include: { agency: true },
  }).catch(() => user);
  return { ok: true, user: updated };
}

async function migrateLegacySnapshotIdentity(
  scope: "customer" | "staff" | "master",
  identifier: string,
  requiredTenantId?: string | null
): Promise<boolean> {
  const snapshot = await loadCurrentAppStateSnapshot();
  if (!snapshot) return false;
  const normalized = identifier.trim().toLowerCase();
  const candidate = snapshotArray(snapshot, "users").find((item) => {
    if (!snapshotUserMatches(item, normalized)) return false;
    const role = fieldString(item.role);
    if (scope === "master" && role !== "master_admin") return false;
    if (scope === "customer" && role !== "customer") return false;
    if (scope === "staff" && !ACTIVE_STAFF_ROLES.includes(role as (typeof ACTIVE_STAFF_ROLES)[number])) return false;
    if (requiredTenantId && fieldString(item.tenantId) !== requiredTenantId) return false;
    return true;
  });
  if (!candidate) return false;

  const email = (fieldString(candidate.businessEmail) || fieldString(candidate.email)).toLowerCase();
  if (!email) return false;
  const name =
    fieldString(candidate.name) ||
    `${fieldString(candidate.firstName)} ${fieldString(candidate.lastName)}`.trim() ||
    email;
  const legacyStatus = snapshotAccountStatus(candidate);

  if (scope === "master") {
    const existingMaster = await prisma.user.findFirst({ where: { role: "master_admin" } });
    if (existingMaster) return existingMaster.email.toLowerCase() === email;
    const platformTenant = await ensurePlatformTenant();
    await prisma.user.create({
      data: {
        id: `user_${randomUUID()}`,
        tenantId: platformTenant.id,
        name,
        email,
        phone: nullableFieldString(candidate.phone),
        role: "master_admin",
        status: legacyStatus,
        passwordHash: null,
        passwordChangedAt: null,
        profile: { profileCompleted: true, platformOwner: true, migratedFromLegacySnapshot: true },
        permissions: {},
      },
    });
    return true;
  }

  const tenantId = fieldString(candidate.tenantId);
  if (!tenantId) return false;
  const agencySnapshot = snapshotArray(snapshot, "agencies").find((agency) => fieldString(agency.id) === tenantId);
  if (!agencySnapshot) return false;
  const agency = await upsertAgencyFromSnapshot(
    agencySnapshot,
    snapshotAgencyCode(agencySnapshot),
    email
  );
  const role = scope === "customer" ? "customer" : fieldString(candidate.role);
  const branchId = await resolveBranchForStaff(fieldString(candidate.branchId), agency.id, snapshot);
  const existing = await prisma.user.findFirst({
    where: {
      tenantId: agency.id,
      email: { equals: email, mode: "insensitive" },
      role,
    },
  });
  if (existing) return true;

  const user = await prisma.user.create({
    data: {
      id: `user_${randomUUID()}`,
      tenantId: agency.id,
      branchId,
      name,
      email,
      phone: nullableFieldString(candidate.phone),
      role,
      status: legacyStatus,
      passwordHash: null,
      passwordChangedAt: null,
      profile: {
        firstName: fieldString(candidate.firstName) || firstNameFromFullName(name),
        lastName: fieldString(candidate.lastName) || lastNameFromFullName(name),
        businessEmail: email,
        profileCompleted: true,
        migratedFromLegacySnapshot: true,
      },
      permissions: {},
    },
  });

  if (scope === "customer") {
    await prisma.customerProfile.create({
      data: {
        id: `customer_${randomUUID()}`,
        tenantId: agency.id,
        userId: user.id,
        branchId,
        name,
        email,
        phone: nullableFieldString(candidate.phone),
        mailingAddress: nullableFieldString(candidate.mailingAddress),
      },
    });
  }
  return true;
}

function sendMasterSession(res: Response, user: MasterSessionUser) {
  const token = issueSessionJwt({
    userId: user.id,
    role: "master_admin",
    tenantId: null,
    branchId: null,
    permissions: permissionsFromJson(user.permissions),
    authVersion: user.authVersion,
  });

  return res.json({
    ok: true,
    token,
    expiresIn: SESSION_TTL,
    user: {
      id: user.id,
      tenantId: null,
      branchId: null,
      role: "master_admin",
      email: user.email,
      name: user.name,
    },
  });
}

function sessionAgencyPayload(agency: SessionAgency | null | undefined) {
  if (!agency) return undefined;
  return {
    id: agency.id,
    name: agency.name,
    contactEmail: agency.contactEmail,
    phone: agency.phone,
    address: agency.address,
    website: agency.website,
    websiteSlug: agency.websiteSlug,
    websiteEnabled: agency.websiteEnabled,
    serviceAreas: Array.isArray(agency.serviceAreas)
      ? agency.serviceAreas.filter((area): area is string => typeof area === "string")
      : [],
    agencyCodePreview: agency.agencyCodePreview,
    tier: agency.tier,
    active: agency.active,
    allowedUsers: agency.allowedUsers,
    allowedProspectsPerMonth: agency.allowedProspectsPerMonth,
    allowedAiMessagesPerMonth: agency.allowedAiMessagesPerMonth,
    allowedCarriers: agency.allowedCarriers,
    createdAt: agency.createdAt.toISOString(),
  };
}

async function ensurePlatformTenant() {
  const existing = await prisma.agency.findUnique({ where: { id: PLATFORM_TENANT_ID } });
  if (existing) return existing;
  return prisma.agency.create({
    data: {
      id: PLATFORM_TENANT_ID,
      name: "Quotex Platform",
      contactEmail: "contact@quotexinsurance.com",
      phone: "517-294-2671",
      website: "https://quotexinsurance.com",
      tier: "platform",
      active: true,
      allowedUsers: 1,
      websiteEnabled: false,
      serviceAreas: [],
      websiteSettings: {},
      carrierRunnerSettings: {},
      billingSettings: {},
      performanceSettings: {},
    },
  });
}

function employeeRegisterErrorCode(input: unknown, error: z.ZodError<z.infer<typeof employeeRegisterSchema>>): StaffInputErrorCode {
  const body = isRecord(input) ? input : {};
  if (
    !fieldString(body.agencyCode) ||
    !fieldString(body.role) ||
    !fieldString(body.firstName) ||
    !fieldString(body.lastName) ||
    !fieldString(body.phone) ||
    !fieldString(body.businessEmail) ||
    !fieldString(body.password)
  ) {
    return "missing_fields";
  }
  const fields = error.flatten().fieldErrors;
  if (fields.businessEmail?.length) return "invalid_email";
  if (fields.password?.length) return "weak_password";
  return "missing_fields";
}

function staffSessionResponse(
  token: string,
  user: {
    id: string;
    tenantId: string;
    branchId?: string | null;
    role: string;
    email: string;
    name: string;
    agency?: {
      id: string;
      name: string;
      contactEmail: string;
      phone?: string | null;
      address?: string | null;
      website?: string | null;
      websiteSlug?: string | null;
      websiteEnabled?: boolean | null;
      tier?: string | null;
      active?: boolean | null;
      allowedUsers?: number | null;
      allowedProspectsPerMonth?: number | null;
      allowedAiMessagesPerMonth?: number | null;
      allowedCarriers?: number | null;
      agencyCodePreview?: string | null;
    } | null;
  }
) {
  return {
    ok: true,
    token,
    expiresIn: SESSION_TTL,
    user: {
      id: user.id,
      tenantId: user.tenantId,
      branchId: user.branchId,
      role: user.role,
      email: user.email,
      name: user.name,
    },
    agency: user.agency
      ? {
          id: user.agency.id,
          name: user.agency.name,
          contactEmail: user.agency.contactEmail,
          phone: user.agency.phone,
          address: user.agency.address,
          website: user.agency.website,
          websiteSlug: user.agency.websiteSlug,
          websiteEnabled: user.agency.websiteEnabled,
          tier: user.agency.tier,
          active: user.agency.active,
          allowedUsers: user.agency.allowedUsers,
          allowedProspectsPerMonth: user.agency.allowedProspectsPerMonth,
          allowedAiMessagesPerMonth: user.agency.allowedAiMessagesPerMonth,
          allowedCarriers: user.agency.allowedCarriers,
          agencyCodePreview: user.agency.agencyCodePreview,
        }
      : null,
  };
}

async function createServerStaffAccount(input: StaffRegisterInput): Promise<StaffAccountResult> {
  const firstName = fieldString(input.firstName);
  const lastName = fieldString(input.lastName);
  const phone = fieldString(input.phone);
  const email = fieldString(input.businessEmail).toLowerCase();
  const agencyCode = normalizeAgencyCode(input.agencyCode);
  if (!firstName || !lastName || !phone || !email || !agencyCode || !SNAPSHOT_STAFF_ROLES.has(input.role)) {
    return { ok: false, error: "missing_fields" };
  }
  if (input.password.length < 8) return { ok: false, error: "weak_password" };

  const agency = await resolveAgencyForStaffRegistration(agencyCode, email, input.agency);
  if (!agency) return { ok: false, error: "agency_not_found" };
  if (!agency.active) return { ok: false, error: "inactive_agency" };

  let branchId = await resolveBranchForStaff(input.branchId, agency.id);
  if (!branchId && input.branchId?.trim() && input.branch) {
    branchId = await upsertBranchFromLocalPromotion(input.branch, agency.id, input.branchId);
  }
  if (input.branchId?.trim() && !branchId) return { ok: false, error: "missing_fields" };

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    include: { agency: true },
  });
  if (existing?.passwordHash || (existing && existing.tenantId !== agency.id)) {
    return { ok: false, error: "duplicate_email" };
  }

  const staffCount = await prisma.user.count({
    where: {
      tenantId: agency.id,
      role: { in: [...ACTIVE_STAFF_ROLES] },
      status: { notIn: ["banned", "deleted", "inactive"] },
    },
  });
  if (!existing && staffCount >= agency.allowedUsers) return { ok: false, error: "slot_limit" };

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          branchId,
          name: `${firstName} ${lastName}`.trim(),
          phone,
          role: input.role,
          status: "active",
          passwordHash: hashPasswordForStorage(input.password),
          passwordChangedAt: new Date(),
          profile: {
            ...(isRecord(existing.profile) ? existing.profile : {}),
            firstName,
            lastName,
            businessEmail: email,
            profileCompleted: true,
          },
        },
        include: { agency: true },
      })
    : await prisma.user.create({
        data: {
          id: `user_${randomUUID()}`,
          tenantId: agency.id,
          branchId,
          name: `${firstName} ${lastName}`.trim(),
          email,
          phone,
          role: input.role,
          status: "active",
          passwordHash: hashPasswordForStorage(input.password),
          passwordChangedAt: new Date(),
          profile: {
            firstName,
            lastName,
            businessEmail: email,
            profileCompleted: true,
          },
          permissions: {},
        },
        include: { agency: true },
      });

  return { ok: true, user };
}

async function resolveAgencyForStaffRegistration(
  agencyCode: string,
  fallbackEmail: string,
  submittedAgency?: StaffRegisterInput["agency"]
) {
  const storedHash = agencyCodeHashForStorage(agencyCode);
  const rawHash = storedHash.replace(/^hmac\$sha256\$/, "");
  const direct = await prisma.agency.findFirst({
    where: { OR: [{ agencyCodeHash: storedHash }, { agencyCodeHash: rawHash }] },
  });
  if (direct) return direct;

  const snapshot = await loadCurrentAppStateSnapshot();
  const snapshotAgency = snapshot
    ? snapshotArray(snapshot, "agencies").find((agency) => snapshotAgencyCode(agency) === agencyCode)
    : null;
  if (snapshotAgency) return upsertAgencyFromSnapshot(snapshotAgency, agencyCode, fallbackEmail);

  const verifiedSubmittedAgency = verifiedRegistrationAgencySnapshot(submittedAgency, agencyCode);
  return verifiedSubmittedAgency ? upsertAgencyFromSnapshot(verifiedSubmittedAgency, agencyCode, fallbackEmail) : null;
}

function verifiedRegistrationAgencySnapshot(
  submittedAgency: StaffRegisterInput["agency"],
  agencyCode: string
): SnapshotRecord | null {
  if (!submittedAgency) return null;
  const candidate = submittedAgency as SnapshotRecord;
  if (!fieldString(candidate.id) || !fieldString(candidate.name)) return null;
  const protectedCode = snapshotAgencyCode(candidate);
  if (!protectedCode || protectedCode !== agencyCode) return null;
  const preview = fieldString(candidate.agencyCodePreview);
  if (preview && preview !== agencyCode.slice(-4)) return null;
  return candidate;
}

async function upsertAgencyFromSnapshot(snapshotAgency: SnapshotRecord, agencyCode: string, fallbackEmail: string) {
  const id = fieldString(snapshotAgency.id) || `agency_${randomUUID()}`;
  const name = fieldString(snapshotAgency.name) || "Agency";
  const contactEmail = fieldString(snapshotAgency.contactEmail) || fallbackEmail || "support@quotexinsurance.com";
  const codeHash = agencyCode ? agencyCodeHashForStorage(agencyCode) : null;
  return prisma.agency.upsert({
    where: { id },
    update: {
      name,
      contactEmail,
      phone: nullableFieldString(snapshotAgency.phone),
      address: nullableFieldString(snapshotAgency.address),
      website: nullableFieldString(snapshotAgency.website),
      websiteSlug: nullableFieldString(snapshotAgency.websiteSlug),
      websiteEnabled: booleanField(snapshotAgency.websiteEnabled, false),
      agencyCodeHash: codeHash,
      agencyCodePreview: agencyCode ? agencyCode.slice(-4) : nullableFieldString(snapshotAgency.agencyCodePreview),
      tier: fieldString(snapshotAgency.tier) || "starter",
      active: snapshotAgency.active !== false,
      allowedUsers: boundedInteger(snapshotAgency.allowedUsers, 1, 1000, 3),
    },
    create: {
      id,
      name,
      contactEmail,
      phone: nullableFieldString(snapshotAgency.phone),
      address: nullableFieldString(snapshotAgency.address),
      website: nullableFieldString(snapshotAgency.website),
      websiteSlug: nullableFieldString(snapshotAgency.websiteSlug),
      websiteEnabled: booleanField(snapshotAgency.websiteEnabled, false),
      agencyCodeHash: codeHash,
      agencyCodePreview: agencyCode ? agencyCode.slice(-4) : nullableFieldString(snapshotAgency.agencyCodePreview),
      tier: fieldString(snapshotAgency.tier) || "starter",
      active: snapshotAgency.active !== false,
      allowedUsers: boundedInteger(snapshotAgency.allowedUsers, 1, 1000, 3),
    },
  });
}

async function upsertBranchFromLocalPromotion(
  input: StaffBranchSnapshotInput | null | undefined,
  agencyId: string,
  requestedBranchId?: string | null
): Promise<string | null> {
  const id = fieldString(input?.id) || fieldString(requestedBranchId);
  if (!id) return null;
  const existing = await prisma.branch.findFirst({ where: { id, tenantId: agencyId } });
  if (!input) return existing?.id ?? null;
  if (fieldString(input.agencyId) && fieldString(input.agencyId) !== agencyId) return existing?.id ?? null;
  const branch = await prisma.branch.upsert({
    where: { id },
    update: {
      tenantId: agencyId,
      name: fieldString(input.name) || existing?.name || "Branch",
      address: nullableFieldString(input.address),
      city: nullableFieldString(input.city),
      state: nullableFieldString(input.state),
      zip: nullableFieldString(input.zip),
      phone: nullableFieldString(input.phone),
    },
    create: {
      id,
      tenantId: agencyId,
      name: fieldString(input.name) || "Branch",
      address: nullableFieldString(input.address),
      city: nullableFieldString(input.city),
      state: nullableFieldString(input.state),
      zip: nullableFieldString(input.zip),
      phone: nullableFieldString(input.phone),
    },
  });
  return branch.id;
}

async function resolveBranchForStaff(branchId: string | undefined, agencyId: string, snapshot?: SnapshotRecord): Promise<string | null> {
  const id = fieldString(branchId);
  if (!id) return null;
  const existing = await prisma.branch.findFirst({ where: { id, tenantId: agencyId } });
  if (existing) return existing.id;
  const state = snapshot ?? await loadCurrentAppStateSnapshot();
  const branchSnapshot = state
    ? snapshotArray(state, "branches").find((branch) => {
        const branchAgencyId = fieldString(branch.agencyId) || fieldString(branch.tenantId);
        return fieldString(branch.id) === id && branchAgencyId === agencyId;
      })
    : null;
  if (!branchSnapshot) return null;
  const branch = await prisma.branch.upsert({
    where: { id },
    update: {
      tenantId: agencyId,
      name: fieldString(branchSnapshot.name) || "Branch",
      address: nullableFieldString(branchSnapshot.address),
      city: nullableFieldString(branchSnapshot.city),
      state: nullableFieldString(branchSnapshot.state),
      zip: nullableFieldString(branchSnapshot.zip),
      phone: nullableFieldString(branchSnapshot.phone),
    },
    create: {
      id,
      tenantId: agencyId,
      name: fieldString(branchSnapshot.name) || "Branch",
      address: nullableFieldString(branchSnapshot.address),
      city: nullableFieldString(branchSnapshot.city),
      state: nullableFieldString(branchSnapshot.state),
      zip: nullableFieldString(branchSnapshot.zip),
      phone: nullableFieldString(branchSnapshot.phone),
    },
  });
  return branch.id;
}

async function loadCurrentAppStateSnapshot(): Promise<SnapshotRecord | null> {
  if (!supabaseStateConfigured()) return null;
  const ids = uniqueStrings([
    process.env.STATE_SYNC_ID,
    process.env.VITE_STATE_SYNC_ID,
    "default",
  ]).map((id) => `app_state:${id}`);
  for (const id of ids) {
    const row = await readRemoteState(id).catch(() => null);
    if (isRecord(row?.snapshot)) return row.snapshot;
  }
  return null;
}

function snapshotUserMatches(user: SnapshotRecord, identifier: string): boolean {
  const normalized = identifier.trim().toLowerCase();
  return [
    fieldString(user.email),
    fieldString(user.businessEmail),
    fieldString(user.username),
  ].some((value) => value.toLowerCase() === normalized);
}

function blockedStaffStatus(status: string): boolean {
  return status === "banned" || status === "deleted" || status === "inactive";
}

function permanentlyBlockedStatus(status: string): boolean {
  return status === "banned" || status === "deleted";
}

function snapshotAccountStatus(user: SnapshotRecord): "active" | "inactive" | "banned" | "deleted" {
  const status = fieldString(user.staffAccessStatus) || fieldString(user.status);
  if (status === "banned" || status === "deleted" || status === "inactive") return status;
  return user.active === false ? "inactive" : "active";
}

function hashPasswordForStorage(password: string): string {
  return hashBcrypt(password, 12);
}

function canonicalAsync(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, _next: NextFunction) => {
    return handler(req, res).catch((error) => {
      console.error("[auth] canonical endpoint failed", {
        method: req.method,
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) authFailure(res, 503, "server_unreachable");
    });
  };
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function agencyCodeHashForStorage(code: string): string {
  return `hmac$sha256$${createHmac("sha256", agencyCodeSecret()).update(normalizeAgencyCode(code)).digest("hex")}`;
}

function agencyCodeSecret(): string {
  return process.env.AGENCY_CODE_SECRET?.trim() || process.env.JWT_SECRET?.trim() || "quotex-local-agency-code-development-secret";
}

function normalizeAgencyCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function snapshotAgencyCode(agency: SnapshotRecord): string {
  const encrypted = fieldString(agency.agencyCodeEncrypted);
  const decrypted = decryptSnapshotAgencyCode(encrypted);
  return normalizeAgencyCode(decrypted || fieldString(agency.agencyCode));
}

function decryptSnapshotAgencyCode(value: string): string | null {
  const prefix = "qac1.";
  if (!value.startsWith(prefix)) return null;
  try {
    const payload = value.slice(prefix.length);
    return xorText(fromHex(payload), "quotex-agency-code");
  } catch {
    return null;
  }
}

function xorText(value: string, key: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    out += String.fromCharCode(value.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

function fromHex(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 2) {
    out += String.fromCharCode(parseInt(value.slice(i, i + 2), 16));
  }
  return out;
}

function snapshotArray(snapshot: SnapshotRecord, key: string): SnapshotRecord[] {
  const value = snapshot[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function fieldString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstNameFromFullName(value: string): string {
  return value.trim().split(/\s+/)[0] || "";
}

function lastNameFromFullName(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

function nullableFieldString(value: unknown): string | null {
  return fieldString(value) || null;
}

function booleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function isRecord(value: unknown): value is SnapshotRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => fieldString(value)).filter(Boolean))];
}

function canRequestManagerStepUp(role: string): boolean {
  return [
    "manager",
    "agency_owner",
    "agency_admin",
    "platform_owner",
    "platform_admin",
    "master_admin",
  ].includes(role);
}

async function managerStepUpRecipientEmail(userId: string, fallbackEmail?: string): Promise<string | null> {
  if (databaseConfigured()) {
    const user = await prisma.user
      .findUnique({
        where: { id: userId },
        select: { email: true, status: true },
      })
      .catch(() => null);
    if (!user || user.status === "banned" || user.status === "deleted" || user.status === "inactive") {
      return null;
    }
    return user.email.trim().toLowerCase() || null;
  }
  if (process.env.NODE_ENV !== "production" && fallbackEmail) {
    return fallbackEmail.trim().toLowerCase();
  }
  return null;
}

export function issueSessionJwt(input: {
  userId: string;
  role: string;
  tenantId: string | null;
  branchId?: string | null;
  permissions?: string[];
  authVersion?: number;
}): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error("JWT_SECRET is required to issue a session.");
  const options: jwt.SignOptions = {
    algorithm: "HS256",
    expiresIn: SESSION_TTL,
  };
  const issuer = process.env.JWT_ISSUER?.trim();
  const audience = process.env.JWT_AUDIENCE?.trim();
  if (issuer) options.issuer = issuer;
  if (audience) options.audience = audience;
  return jwt.sign(
    {
      userId: input.userId,
      role: input.role,
      tenantId: input.tenantId,
      branchId: input.branchId ?? null,
      permissions: input.permissions ?? [],
      authVersion: input.authVersion ?? 0,
    },
    secret,
    options
  );
}

export function verifyPasswordHashForLogin(password: string, encodedHash: string): boolean {
  const encoded = encodedHash.trim();
  if (!encoded) return false;
  if (/^\$2[aby]\$/.test(encoded)) {
    try {
      return compareBcrypt(password, encoded);
    } catch {
      return false;
    }
  }
  const parts = encoded.split("$");
  if (parts[0] === "scrypt" && parts.length === 6) {
    const [, nRaw, rRaw, pRaw, salt, expectedHex] = parts;
    const n = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || !salt || !expectedHex) {
      return false;
    }
    const actual = scryptSync(password, salt, Buffer.from(expectedHex, "hex").length, { N: n, r, p });
    return timingSafeEqualHex(actual.toString("hex"), expectedHex);
  }
  if (parts[0] === "pbkdf2" && parts.length === 5) {
    const [, digest, iterationsRaw, salt, expectedHex] = parts;
    const iterations = Number(iterationsRaw);
    if (!/^[a-z0-9-]+$/i.test(digest) || !Number.isInteger(iterations) || iterations < 100_000) {
      return false;
    }
    const actual = pbkdf2Sync(password, salt, iterations, Buffer.from(expectedHex, "hex").length, digest);
    return timingSafeEqualHex(actual.toString("hex"), expectedHex);
  }
  return false;
}

function passwordHashNeedsUpgrade(encodedHash: string): boolean {
  return !/^\$2[aby]\$12\$/.test(encodedHash.trim());
}

function timingSafeEqualHex(actualHex: string, expectedHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actualHex) || !/^[a-f0-9]+$/i.test(expectedHex)) return false;
  const left = Buffer.from(actualHex, "hex");
  const right = Buffer.from(expectedHex, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function permissionsFromJson(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([permission]) => permission);
  }
  return [];
}

function hashStepUpCode(challengeId: string, code: string): string {
  return createHmac("sha256", stepUpSecret()).update(`${challengeId}:${code}`).digest("hex");
}

function stepUpSecret(): string {
  return (
    process.env.MANAGER_2FA_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "quotex-local-manager-step-up-development-secret"
  );
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function purgeExpiredChallenges() {
  const now = Date.now();
  for (const [id, challenge] of managerChallenges) {
    if (challenge.expiresAt < now || challenge.consumedAt) managerChallenges.delete(id);
  }
  if (!usePostgresStepUpStore()) return;
  await ensureManagerStepUpTable();
  await prisma.$executeRaw`
    DELETE FROM public.manager_step_up_challenges
    WHERE expires_at < now() OR consumed_at IS NOT NULL
  `;
}

function usePostgresStepUpStore(): boolean {
  if (process.env.MANAGER_2FA_STORE === "memory") return false;
  return databaseConfigured();
}

async function ensureManagerStepUpTable(): Promise<void> {
  if (!usePostgresStepUpStore()) return;
  managerStepUpTableReady ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.manager_step_up_challenges (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL,
        customer_id TEXT,
        code_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS manager_step_up_challenges_user_idx
      ON public.manager_step_up_challenges (tenant_id, user_id, expires_at)
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS manager_step_up_challenges_expiry_idx
      ON public.manager_step_up_challenges (expires_at)
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE public.manager_step_up_challenges ENABLE ROW LEVEL SECURITY
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'manager_step_up_challenges'
            AND policyname = 'manager_step_up_challenges_deny_browser_roles'
        ) THEN
          CREATE POLICY manager_step_up_challenges_deny_browser_roles
            ON public.manager_step_up_challenges
            FOR ALL TO anon, authenticated
            USING (false)
            WITH CHECK (false);
        END IF;
      END
      $$
    `);
  })();
  await managerStepUpTableReady;
}

async function saveManagerChallenge(challenge: ManagerStepUpChallenge): Promise<void> {
  if (!usePostgresStepUpStore()) {
    managerChallenges.set(challenge.id, challenge);
    return;
  }
  await ensureManagerStepUpTable();
  await prisma.$executeRaw`
    INSERT INTO public.manager_step_up_challenges (
      id, tenant_id, user_id, email, purpose, customer_id, code_hash, expires_at, attempts, updated_at
    )
    VALUES (
      ${challenge.id},
      ${challenge.tenantId},
      ${challenge.userId},
      ${challenge.email},
      ${challenge.purpose},
      ${challenge.customerId ?? null},
      ${challenge.codeHash},
      ${new Date(challenge.expiresAt)},
      ${challenge.attempts},
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      user_id = EXCLUDED.user_id,
      email = EXCLUDED.email,
      purpose = EXCLUDED.purpose,
      customer_id = EXCLUDED.customer_id,
      code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at,
      attempts = EXCLUDED.attempts,
      consumed_at = NULL,
      updated_at = now()
  `;
}

async function loadManagerChallenge(id: string): Promise<ManagerStepUpChallenge | null> {
  if (!usePostgresStepUpStore()) return managerChallenges.get(id) ?? null;
  await ensureManagerStepUpTable();
  const rows = await prisma.$queryRaw<ManagerStepUpChallengeRow[]>`
    SELECT id, tenant_id, user_id, email, purpose, customer_id, code_hash, expires_at, attempts, consumed_at
    FROM public.manager_step_up_challenges
    WHERE id = ${id}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    email: row.email,
    purpose: row.purpose,
    customerId: row.customer_id ?? undefined,
    codeHash: row.code_hash,
    expiresAt: row.expires_at.getTime(),
    attempts: row.attempts,
    consumedAt: row.consumed_at?.getTime(),
  };
}

async function updateManagerChallengeAttempts(id: string, attempts: number): Promise<void> {
  if (!usePostgresStepUpStore()) {
    const challenge = managerChallenges.get(id);
    if (challenge) challenge.attempts = attempts;
    return;
  }
  await ensureManagerStepUpTable();
  await prisma.$executeRaw`
    UPDATE public.manager_step_up_challenges
    SET attempts = ${attempts}, updated_at = now()
    WHERE id = ${id}
  `;
}

async function deleteManagerChallenge(id: string): Promise<void> {
  managerChallenges.delete(id);
  if (!usePostgresStepUpStore()) return;
  await ensureManagerStepUpTable();
  await prisma.$executeRaw`DELETE FROM public.manager_step_up_challenges WHERE id = ${id}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "configured manager email";
  const visible = local.length <= 2 ? local[0] ?? "*" : `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local.at(-1)}`;
  return `${visible}@${domain}`;
}

function managerStepUpEmailHtml(code: string): string {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#14120f">
      <h1 style="font-size:20px;margin:0 0 12px">Quotex manager verification</h1>
      <p>Your one-time verification code is:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:16px 0">${code}</p>
      <p>This code expires in 10 minutes. If you did not request it, contact Quotex Insurance Support immediately.</p>
    </div>
  `;
}
