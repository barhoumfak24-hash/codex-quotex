// Auth + tenant scoping middleware (placeholders).
// Production:
// - Verify JWT (or session cookie) → load user
// - Attach { userId, role, tenantId } to req
// - Reject if role mismatch
// - Reject if user.tenantId !== resource.tenantId (master_admin bypass)
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; role: string; tenantId: string | null };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // TODO: real JWT verification
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role");
  const tenantId = req.header("x-tenant-id") ?? null;
  if (!userId || !role) return res.status(401).json({ error: "unauthorized" });
  req.auth = { userId, role, tenantId };
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "unauthorized" });
    if (!roles.includes(req.auth.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

// Adds a Prisma `where` clause that enforces tenant scope.
// master_admin sees everything.
export function tenantScope(req: Request) {
  if (!req.auth) return { id: "" };
  if (req.auth.role === "master_admin") return {};
  return { tenantId: req.auth.tenantId ?? "" };
}