import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  quotexPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.quotexPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.quotexPrisma = prisma;
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function databaseHealth() {
  if (!databaseConfigured()) {
    return {
      ok: false,
      configured: false,
      provider: "supabase-postgres",
      checkedAt: new Date().toISOString(),
    };
  }

  await prisma.$queryRaw`select 1`;

  return {
    ok: true,
    configured: true,
    provider: "supabase-postgres",
    checkedAt: new Date().toISOString(),
  };
}

export type DatabaseRlsContext = {
  tenantId?: string | null;
  userId?: string | null;
  role?: string | null;
  branchId?: string | null;
};

export async function withRlsContext<T>(
  context: DatabaseRlsContext,
  callback: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${context.tenantId ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_id', ${context.userId ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.role', ${context.role ?? ""}, true)`;
    await tx.$executeRaw`SELECT set_config('app.branch_id', ${context.branchId ?? ""}, true)`;

    return callback(tx);
  });
}
