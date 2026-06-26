import { createHmac, pbkdf2Sync, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
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
  { method: "POST", path: "/google/callback", description: "Exchange Google id_token -> session" },
  { method: "POST", path: "/email/send-link", description: "Send magic link to customer email" },
  { method: "POST", path: "/email/verify", description: "Verify magic link token, create session" },
  { method: "POST", path: "/employee/login", description: "Agency user login (email+password+MFA)" },
  { method: "POST", path: "/employee/register", description: "Create a hashed agency staff account" },
  { method: "POST", path: "/employee/promote-local", description: "Migrate a verified legacy staff account into hashed server auth" },
  { method: "POST", path: "/master/login", description: "Master admin login (SSO + hardware MFA required)" },
  { method: "POST", path: "/manager-2fa/request", description: "Email a manager step-up verification code" },
  { method: "POST", path: "/manager-2fa/verify", description: "Verify a manager step-up code" },
  { method: "POST", path: "/logout", description: "Invalidate session" },
  { method: "GET", path: "/me", description: "Return current session user" },
];

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

const employeeRegisterSchema = z.object({
  agencyCode: z.string().min(3).max(80),
  branchId: z.string().max(120).optional(),
  role: z.enum(["agent", "manager", "csr"]),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  phone: z.string().min(1).max(80),
  businessEmail: z.string().email().max(254),
  password: z.string().min(8).max(500),
});

const employeeLocalPromotionSchema = z.object({
  password: z.string().min(8).max(500),
  user: z.object({
    id: z.string().min(1).max(120).optional(),
    tenantId: z.string().min(1).max(120),
    branchId: z.string().max(120).optional().nullable(),
    role: z.enum(["agent", "manager", "csr"]),
    email: z.string().email().max(254),
    businessEmail: z.string().email().max(254).optional(),
    firstName: z.string().max(120).optional(),
    lastName: z.string().max(120).optional(),
    name: z.string().min(1).max(240),
    phone: z.string().max(80).optional(),
    active: z.boolean().optional(),
    staffAccessStatus: z.enum(["active", "banned", "deleted", "inactive"]).optional(),
  }),
  agency: z.object({
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(240),
    contactEmail: z.string().email().max(254).optional(),
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
  }),
  branch: z
    .object({
      id: z.string().min(1).max(120),
      agencyId: z.string().min(1).max(120),
      name: z.string().min(1).max(120),
      address: z.string().max(500).optional(),
      city: z.string().max(120).optional(),
      state: z.string().max(40).optional(),
      zip: z.string().max(40).optional(),
      phone: z.string().max(80).optional(),
    })
    .optional()
    .nullable(),
});

authRoutes.get("/", (_req, res) => res.json({ resource: "auth", endpoints }));

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

  const identifier = parsed.data.identifier.trim().toLowerCase();
  let user = await prisma.user.findFirst({
    where: {
      OR: [{ email: { equals: identifier, mode: "insensitive" } }],
    },
    include: { agency: true },
  });
  if (user && blockedStaffStatus(user.status)) {
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }
  if (!user || !user.passwordHash) {
    user = await promoteSnapshotStaffForLogin(identifier, parsed.data.password);
  }
  if (!user || user.status === "banned" || user.status === "deleted" || user.status === "inactive") {
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }
  if (!user.agency?.active) {
    return res.status(403).json({ ok: false, error: "inactive_agency" });
  }
  if (!user.passwordHash) {
    return res.status(403).json({
      ok: false,
      error: "password_not_configured",
      message: "This server account needs a password reset before protected API access can be issued.",
    });
  }
  if (!verifyPasswordHashForLogin(parsed.data.password, user.passwordHash)) {
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }

  const token = issueSessionJwt({
    userId: user.id,
    role: user.role,
    tenantId: user.tenantId,
    branchId: user.branchId,
    permissions: permissionsFromJson(user.permissions),
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => null);

  return res.json({
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
  });
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
  if (!parsed.success) return res.status(400).json({ ok: false, error: "missing_fields", details: parsed.error.flatten() });

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
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => null);

  return res.json({
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
  });
});

authRoutes.post("/employee/promote-local", async (req, res) => {
  if (!databaseConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "database_unavailable",
      message: "Server authentication is not connected to the production database.",
    });
  }
  const parsed = employeeLocalPromotionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "missing_fields", details: parsed.error.flatten() });
  }

  const result = await promoteLocalStaffAccount(parsed.data);
  if (!result.ok) {
    const status =
      result.error === "inactive_agency" ? 403 :
      result.error === "duplicate_email" ? 409 :
      result.error === "weak_password" ? 400 :
      result.error === "missing_fields" ? 400 :
      401;
    return res.status(status).json({ ok: false, error: result.error });
  }

  const { user } = result;
  const token = issueSessionJwt({
    userId: user.id,
    role: user.role,
    tenantId: user.tenantId,
    branchId: user.branchId,
    permissions: permissionsFromJson(user.permissions),
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => null);

  return res.json({
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
  });
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
type LocalStaffPromotionInput = z.infer<typeof employeeLocalPromotionSchema>;
type StaffAccountResult =
  | { ok: true; user: Awaited<ReturnType<typeof prisma.user.findFirst>> & { agency: NonNullable<Awaited<ReturnType<typeof prisma.agency.findFirst>>> } }
  | { ok: false; error: "agency_not_found" | "inactive_agency" | "duplicate_email" | "slot_limit" | "weak_password" | "missing_fields" | "invalid_credentials" };

const SNAPSHOT_STAFF_ROLES = new Set(["agent", "manager", "csr"]);
const ACTIVE_STAFF_ROLES = ["agent", "manager", "csr", "agency_owner", "agency_admin"] as const;

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

  const agency = await resolveAgencyForStaffRegistration(agencyCode, email);
  if (!agency) return { ok: false, error: "agency_not_found" };
  if (!agency.active) return { ok: false, error: "inactive_agency" };

  const branchId = await resolveBranchForStaff(input.branchId, agency.id);
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

async function promoteLocalStaffAccount(input: LocalStaffPromotionInput): Promise<StaffAccountResult> {
  const email = fieldString(input.user.businessEmail) || fieldString(input.user.email);
  const normalizedEmail = email.toLowerCase();
  const name = fieldString(input.user.name) || normalizedEmail;
  if (
    !normalizedEmail ||
    input.password.length < 8 ||
    !SNAPSHOT_STAFF_ROLES.has(input.user.role) ||
    fieldString(input.user.tenantId) !== fieldString(input.agency.id)
  ) {
    return { ok: false, error: "missing_fields" };
  }
  if (
    input.user.active === false ||
    input.user.staffAccessStatus === "banned" ||
    input.user.staffAccessStatus === "deleted" ||
    input.user.staffAccessStatus === "inactive"
  ) {
    return { ok: false, error: "invalid_credentials" };
  }
  if (input.agency.active === false) return { ok: false, error: "inactive_agency" };

  const agency = await resolveExistingAgencyForLocalPromotion(input.agency, input.user.tenantId, normalizedEmail);
  if (!agency?.active) return { ok: false, error: "inactive_agency" };

  const branchId = await upsertBranchFromLocalPromotion(input.branch, agency.id, input.user.branchId ?? undefined);
  const existing = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    include: { agency: true },
  });
  if (existing && existing.tenantId !== agency.id) return { ok: false, error: "duplicate_email" };
  if (existing && blockedStaffStatus(existing.status)) return { ok: false, error: "invalid_credentials" };

  const firstName = fieldString(input.user.firstName) || firstNameFromFullName(name);
  const lastName = fieldString(input.user.lastName) || lastNameFromFullName(name);
  const profile = {
    ...(existing && isRecord(existing.profile) ? existing.profile : {}),
    firstName,
    lastName,
    businessEmail: normalizedEmail,
    profileCompleted: true,
    legacyLocalAuthPromotedAt: new Date().toISOString(),
  };
  const passwordHash = hashPasswordForStorage(input.password);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          tenantId: agency.id,
          branchId,
          name,
          phone: nullableFieldString(input.user.phone) ?? existing.phone,
          role: input.user.role,
          status: "active",
          passwordHash,
          passwordChangedAt: new Date(),
          profile,
        },
        include: { agency: true },
      })
    : await prisma.user.create({
        data: {
          id: fieldString(input.user.id) || `user_${randomUUID()}`,
          tenantId: agency.id,
          branchId,
          name,
          email: normalizedEmail,
          phone: nullableFieldString(input.user.phone),
          role: input.user.role,
          status: "active",
          passwordHash,
          passwordChangedAt: new Date(),
          profile,
          permissions: {},
        },
        include: { agency: true },
      });

  return { ok: true, user };
}

async function promoteSnapshotStaffForLogin(identifier: string, password: string) {
  const snapshot = await loadCurrentAppStateSnapshot();
  if (!snapshot) return null;
  const userSnapshot = snapshotArray(snapshot, "users").find((user) => snapshotUserMatches(user, identifier));
  if (!userSnapshot || blockedSnapshotStaff(userSnapshot)) return null;
  const snapshotPassword = fieldString(userSnapshot.generatedPassword);
  if (!snapshotPassword || !timingSafeEqualString(snapshotPassword, password)) return null;

  const tenantId = fieldString(userSnapshot.tenantId);
  if (!tenantId) return null;
  const agencySnapshot = snapshotArray(snapshot, "agencies").find((agency) => fieldString(agency.id) === tenantId);
  if (!agencySnapshot) return null;
  const agencyCode = snapshotAgencyCode(agencySnapshot);
  const agency = await upsertAgencyFromSnapshot(agencySnapshot, agencyCode, fieldString(userSnapshot.email));
  if (!agency?.active) return null;
  const branchId = await resolveBranchForStaff(fieldString(userSnapshot.branchId), agency.id, snapshot);

  const email = fieldString(userSnapshot.businessEmail) || fieldString(userSnapshot.email);
  if (!email) return null;
  const name =
    fieldString(userSnapshot.name) ||
    `${fieldString(userSnapshot.firstName)} ${fieldString(userSnapshot.lastName)}`.trim() ||
    email;
  const role = fieldString(userSnapshot.role);
  if (!SNAPSHOT_STAFF_ROLES.has(role)) return null;

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email.toLowerCase(), mode: "insensitive" } },
    include: { agency: true },
  });
  if (existing && existing.tenantId !== agency.id) return null;

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          tenantId: agency.id,
          branchId,
          name,
          phone: fieldString(userSnapshot.phone) || existing.phone,
          role,
          status: "active",
          passwordHash: hashPasswordForStorage(password),
          passwordChangedAt: new Date(),
          profile: {
            ...(isRecord(existing.profile) ? existing.profile : {}),
            firstName: fieldString(userSnapshot.firstName),
            lastName: fieldString(userSnapshot.lastName),
            businessEmail: email.toLowerCase(),
            profileCompleted: true,
          },
        },
        include: { agency: true },
      })
    : await prisma.user.create({
        data: {
          id: fieldString(userSnapshot.id) || `user_${randomUUID()}`,
          tenantId: agency.id,
          branchId,
          name,
          email: email.toLowerCase(),
          phone: fieldString(userSnapshot.phone) || null,
          role,
          status: "active",
          passwordHash: hashPasswordForStorage(password),
          passwordChangedAt: new Date(),
          profile: {
            firstName: fieldString(userSnapshot.firstName),
            lastName: fieldString(userSnapshot.lastName),
            businessEmail: email.toLowerCase(),
            profileCompleted: true,
          },
          permissions: {},
        },
        include: { agency: true },
      });
  return user;
}

async function resolveAgencyForStaffRegistration(agencyCode: string, fallbackEmail: string) {
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
  return snapshotAgency ? upsertAgencyFromSnapshot(snapshotAgency, agencyCode, fallbackEmail) : null;
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

async function resolveExistingAgencyForLocalPromotion(
  input: LocalStaffPromotionInput["agency"],
  tenantId: string,
  fallbackEmail: string
) {
  const agencyCode = normalizeAgencyCode(
    fieldString(input.agencyCode) || decryptSnapshotAgencyCode(fieldString(input.agencyCodeEncrypted)) || ""
  );
  const codeHash = agencyCode ? agencyCodeHashForStorage(agencyCode) : null;
  const id = fieldString(input.id);
  if (!id || id !== fieldString(tenantId)) return null;
  const hashLookups = codeHash ? [codeHash, codeHash.replace(/^hmac\$sha256\$/, "")] : [];
  const existing = await prisma.agency.findFirst({
    where: {
      OR: [
        { id },
        ...hashLookups.map((agencyCodeHash) => ({ agencyCodeHash })),
      ],
    },
  });
  if (!existing || existing.id !== id) return null;
  if (!existing.active || input.active === false) return existing;

  const name = fieldString(input.name) || "Agency";
  const base = {
    name,
    contactEmail: fieldString(input.contactEmail) || fallbackEmail || "support@quotexinsurance.com",
    phone: nullableFieldString(input.phone),
    address: nullableFieldString(input.address),
    website: nullableFieldString(input.website),
    websiteSlug: nullableFieldString(input.websiteSlug),
    websiteEnabled: booleanField(input.websiteEnabled, false),
  };
  const codeFields = codeHash
    ? {
        agencyCodeHash: codeHash,
        agencyCodePreview: agencyCode.slice(-4),
      }
    : {};
  return prisma.agency.update({
    where: { id },
    data: {
      ...base,
      ...codeFields,
    },
  });
}

async function upsertBranchFromLocalPromotion(
  input: LocalStaffPromotionInput["branch"],
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

function blockedSnapshotStaff(user: SnapshotRecord): boolean {
  const role = fieldString(user.role);
  const status = fieldString(user.staffAccessStatus) || fieldString(user.status);
  return (
    !SNAPSHOT_STAFF_ROLES.has(role) ||
    user.active === false ||
    status === "banned" ||
    status === "deleted" ||
    status === "inactive"
  );
}

function blockedStaffStatus(status: string): boolean {
  return status === "banned" || status === "deleted" || status === "inactive";
}

function hashPasswordForStorage(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const n = 16_384;
  const r = 8;
  const p = 1;
  const hash = scryptSync(password, salt, 32, { N: n, r, p }).toString("hex");
  return `scrypt$${n}$${r}$${p}$${salt}$${hash}`;
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
    },
    secret,
    options
  );
}

export function verifyPasswordHashForLogin(password: string, encodedHash: string): boolean {
  const encoded = encodedHash.trim();
  if (!encoded) return false;
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
