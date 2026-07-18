import type { User } from "@/types";

export function isLockingMasterAccount(user: User): boolean {
  return user.role === "master_admin" && user.active !== false;
}

export function isStaleMasterAccount(user: User): boolean {
  // Server authentication owns master-account validity. A browser profile must
  // never be removed merely because it does not contain a readable password.
  return false;
}
