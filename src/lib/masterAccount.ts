import type { User } from "@/types";

export function isLockingMasterAccount(user: User): boolean {
  if (user.role !== "master_admin") return false;
  return user.active !== false && Boolean(user.generatedPassword?.trim());
}

export function isStaleMasterAccount(user: User): boolean {
  return user.role === "master_admin" && !isLockingMasterAccount(user);
}
