import { createHmac, pbkdf2Sync, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { sendEmail } from "../services/email.js";
import { databaseConfigured, prisma } from "../services/prisma.js";

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
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: { equals: identifier, mode: "insensitive" } }],
    },
    include: { agency: true },
  });
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
