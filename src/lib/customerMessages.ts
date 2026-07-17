import type { Communication } from "@/types";

const LAST_SEEN_PREFIX = "quotex.customer.messages.lastSeen.";

export function customerMessagesLastSeen(customerId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(`${LAST_SEEN_PREFIX}${customerId}`) ?? "";
  } catch {
    return "";
  }
}

export function markCustomerMessagesSeen(customerId: string, rows: Communication[]): void {
  if (typeof window === "undefined") return;
  const latest = rows.reduce(
    (value, row) => (row.createdAt > value ? row.createdAt : value),
    new Date().toISOString()
  );
  try {
    window.localStorage.setItem(`${LAST_SEEN_PREFIX}${customerId}`, latest);
  } catch {
    /* unread state is a convenience; messaging must still work without local storage */
  }
}

export function unreadCustomerMessageCount(rows: Communication[], lastSeen: string): number {
  return rows.filter(
    (row) => row.direction === "outbound" && (!lastSeen || row.createdAt > lastSeen)
  ).length;
}
