import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

// Auth + tenant scoping middleware.
//
// Production verifies a signed JWT and rejects spoofable identity headers.
// Development can opt into x-user-* headers with ALLOW_DEV_AUTH_HEADERS=true
// for local integration testing without weakening production.

export type AuthContext = {
  userId: string;
  role: string;
  tenantId: string | null;
  branchId?: string | null;
  permissions: string[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      rawBody?: Buffer;
      requestId?: string;
    }
  }
}

const PLATFORM_ROLES = new Set(["platform_owner", "platform_admin", "master_admin"]);
const AGENCY_ADMIN_ROLES = new Set(["agency_owner", "agency_admin", "manager"]);

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "unauthorized" });
  req.auth = auth;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "unauthorized" });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "unauthorized" });
    if (canBypassTenantScope(req.auth) || req.auth.permissions.includes(permission)) return next();
    return res.status(403).json({ error: "forbidden" });
  };
}

export function requireAgencyOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "unauthorized" });
  if (req.auth.role === "agency_owner" || canBypassTenantScope(req.auth)) return next();
  return res.status(403).json({ error: "forbidden" });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "unauthorized" });
  if (AGENCY_ADMIN_ROLES.has(req.auth.role) || canBypassTenantScope(req.auth)) return next();
  return res.status(403).json({ error: "forbidden" });
}

export function requireAgencyAccess(tenantId: string | null | undefined, auth: AuthContext): boolean {
  if (canBypassTenantScope(auth)) return true;
  return Boolean(tenantId && auth.tenantId && tenantId === auth.tenantId);
}

export function enforceTenantIsolation(req: Request, res: Response, next: NextFunction) {
  if (!assertRequestTenantMatchesAuth(req, res)) return;
  next();
}

export function requireRecordOwnership(
  req: Request,
  res: Response,
  next: NextFunction,
  recordTenantId: string | null | undefined
) {
  if (!req.auth) return res.status(401).json({ error: "unauthorized" });
  if (!requireAgencyAccess(recordTenantId, req.auth)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

export function tenantScope(req: Request) {
  if (!req.auth) return { id: "" };
  if (canBypassTenantScope(req.auth)) return {};
  return { tenantId: req.auth.tenantId ?? "" };
}

export function assertBodyTenantMatchesAuth(req: Request, res: Response): boolean {
  return assertRequestTenantMatchesAuth(req, res, { bodyOnly: true });
}

export function assertRequestTenantMatchesAuth(
  req: Request,
  res: Response,
  options: { bodyOnly?: boolean } = {}
): boolean {
  if (!req.auth || canBypassTenantScope(req.auth)) return true;
  const tenantIds = new Set<string>();
  collectTenantIds(req.body, tenantIds);
  if (!options.bodyOnly) {
    collectTenantIds(req.query, tenantIds);
    collectTenantIds(req.params, tenantIds);
    collectTenantIdsFromTenantPath(req, tenantIds);
  }
  if (tenantIds.size === 0) return true;
  if (tenantIds.size === 1 && tenantIds.has(req.auth.tenantId ?? "")) return true;
  res.status(403).json({ error: "tenant_mismatch" });
  return false;
}

function authenticateRequest(req: Request): AuthContext | null {
  const token = bearerToken(req);
  if (token) return verifyJwt(token);
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_AUTH_HEADERS === "true") {
    return devHeaderAuth(req);
  }
  return null;
}

function verifyJwt(token: string): AuthContext | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: process.env.JWT_ISSUER || undefined,
      audience: process.env.JWT_AUDIENCE || undefined,
    });
    if (typeof decoded === "string") return null;
    return authFromPayload(decoded);
  } catch {
    return null;
  }
}

function authFromPayload(payload: JwtPayload): AuthContext | null {
  const userId = stringClaim(payload.userId) || stringClaim(payload.sub);
  const role = stringClaim(payload.role);
  const tenantId = stringClaim(payload.tenantId) || stringClaim(payload.agencyId) || null;
  if (!userId || !role) return null;
  if (!PLATFORM_ROLES.has(role) && !tenantId) return null;
  return {
    userId,
    role,
    tenantId,
    branchId: stringClaim(payload.branchId) || null,
    permissions: arrayClaim(payload.permissions),
  };
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function devHeaderAuth(req: Request): AuthContext | null {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role");
  const tenantId = req.header("x-tenant-id") ?? null;
  if (!userId || !role) return null;
  if (!PLATFORM_ROLES.has(role) && !tenantId) return null;
  return {
    userId,
    role,
    tenantId,
    branchId: req.header("x-branch-id") ?? null,
    permissions: (req.header("x-user-permissions") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function canBypassTenantScope(auth: AuthContext): boolean {
  return PLATFORM_ROLES.has(auth.role);
}

function collectTenantIds(value: unknown, out = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectTenantIds(item, out));
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "tenantId" || key === "agencyId") && typeof child === "string" && child.trim()) {
      out.add(child);
      continue;
    }
    collectTenantIds(child, out);
  }
  return out;
}

function collectTenantIdsFromTenantPath(req: Request, out: Set<string>) {
  const pathname = req.originalUrl.split(/[?#]/, 1)[0] ?? "";
  const match = pathname.match(/^\/api\/tenants\/([^/]+)/);
  if (!match?.[1]) return;
  try {
    out.add(decodeURIComponent(match[1]));
  } catch {
    out.add(match[1]);
  }
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function arrayClaim(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
