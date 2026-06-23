import type { User } from "@/types";

const MASTER_SETUP_UNLOCKED_AT = Date.parse("2026-06-23T19:39:30.000Z");

export function isLockingMasterAccount(user: User): boolean {
  if (user.role !== "master_admin") return false;
  if (!user.active || !user.generatedPassword) return false;
  const createdAt = Date.parse(user.createdAt ?? "");
  return Number.isFinite(createdAt) && createdAt >= MASTER_SETUP_UNLOCKED_AT;
}

export function isStaleMasterAccount(user: User): boolean {
  return user.role === "master_admin" && !isLockingMasterAccount(user);
}
