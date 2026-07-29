import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../middleware/auth.js";
import { prisma } from "./prisma.js";
import { readRemoteState } from "./supabaseState.js";
import { scopeSnapshotToTenant } from "./stateSnapshotScope.js";

type JsonObject = Record<string, unknown>;

export async function ensureConnectQuoteSession(
  auth: AuthContext,
  quoteSessionId: string
): Promise<boolean> {
  const tenantId = auth.tenantId?.trim();
  if (!tenantId || !quoteSessionId.trim()) return false;

  const existing = await prisma.quotingSession.findUnique({
    where: { id: quoteSessionId },
    select: { tenantId: true },
  });
  if (existing) return existing.tenantId === tenantId;

  const remoteState = await readRemoteState(appStateId()).catch(() => null);
  if (!remoteState) return false;

  const scopedSnapshot = asObject(scopeSnapshotToTenant(remoteState.snapshot, tenantId));
  const snapshotSession = rows(scopedSnapshot?.quotingSessions).find(
    (session) => stringValue(session.id) === quoteSessionId
  );
  if (!snapshotSession || stringValue(snapshotSession.tenantId) !== tenantId) return false;

  try {
    await prisma.quotingSession.create({
      data: {
        id: quoteSessionId,
        tenantId,
        assetType: stringValue(snapshotSession.assetType) || "other",
        estimatedValue: nonNegativeNumber(snapshotSession.estimatedValue),
        assetDetails: jsonObject(snapshotSession.assetDetails),
        createdById: auth.userId,
        status: stringValue(snapshotSession.status) || "quoting",
        ...optionalString("categoryId", snapshotSession.categoryId),
        ...optionalString("categoryLabel", snapshotSession.categoryLabel),
        ...optionalString("state", snapshotSession.state),
        ...optionalString("lineOfBusiness", snapshotSession.lineOfBusiness),
      },
    });
    return true;
  } catch (error) {
    // Prisma errors can cross a bundled/serverless module boundary where
    // `instanceof PrismaClientKnownRequestError` is false. The stable error
    // code is the reliable signal that another request created this row first.
    if (prismaErrorCode(error) !== "P2002") {
      throw error;
    }
    const raced = await prisma.quotingSession.findUnique({
      where: { id: quoteSessionId },
      select: { tenantId: true },
    });
    return raced?.tenantId === tenantId;
  }
}

function prismaErrorCode(error: unknown): string {
  const record = asObject(error);
  return stringValue(record?.code);
}

function appStateId(): string {
  const configured =
    process.env.STATE_SYNC_ID?.trim() ||
    process.env.VITE_STATE_SYNC_ID?.trim() ||
    "default";
  return `app_state:${configured}`;
}

function optionalString<Key extends string>(key: Key, value: unknown): Partial<Record<Key, string>> {
  const normalized = stringValue(value);
  return normalized ? { [key]: normalized } as Partial<Record<Key, string>> : {};
}

function nonNegativeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function jsonObject(value: unknown): Prisma.InputJsonValue {
  if (!asObject(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return {};
  }
}

function rows(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject).filter((row): row is JsonObject => Boolean(row)) : [];
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
