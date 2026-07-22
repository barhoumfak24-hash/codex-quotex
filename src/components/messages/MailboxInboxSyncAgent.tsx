import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { syncCommunicationsFromLiveMailbox } from "@/lib/liveMailbox";
import { listMailboxConnections } from "@/lib/mailboxOAuth";
import { useTenant } from "@/lib/tenant";
import type { ConnectedMailbox } from "@/types";

export const ACTIVE_MAILBOX_SYNC_INTERVAL_MS = 5_000;
const MAILBOX_SYNC_LEASE_MS = 12_000;
const MAILBOX_SYNC_LEASE_RETRY_MS = 2_000;
const OFFLINE_RETRY_MS = 15_000;
const MISSING_MAILBOX_RETRY_MS = 30_000;
const MAILBOX_SYNC_RETRY_DELAYS_MS = [10_000, 30_000, 60_000] as const;
const CONNECTED_MAILBOX_REFRESH_MS = 5 * 60_000;
const MISSING_MAILBOX_REFRESH_MS = 60_000;
const MAILBOX_SYNC_LEASE_PREFIX = "quotex.mailbox-sync-leader";
const mailboxSyncAgentId = `mailbox-agent-${Math.random().toString(36).slice(2)}`;

type ConnectionCache = {
  checkedAt: number;
  connectionId: string | null;
};

type MailboxSyncLease = {
  ownerId: string;
  expiresAt: number;
};

function parseMailboxSyncLease(value: string | null): MailboxSyncLease | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<MailboxSyncLease>;
    return typeof parsed.ownerId === "string" && typeof parsed.expiresAt === "number"
      ? { ownerId: parsed.ownerId, expiresAt: parsed.expiresAt }
      : null;
  } catch {
    return null;
  }
}

export function mailboxSyncRetryDelay(failureCount: number): number {
  if (failureCount <= 0) return ACTIVE_MAILBOX_SYNC_INTERVAL_MS;
  return MAILBOX_SYNC_RETRY_DELAYS_MS[
    Math.min(failureCount - 1, MAILBOX_SYNC_RETRY_DELAYS_MS.length - 1)
  ];
}

export function claimMailboxSyncLease(input: {
  storage: Pick<Storage, "getItem" | "setItem">;
  key: string;
  ownerId: string;
  now: number;
  durationMs?: number;
}): boolean {
  const current = parseMailboxSyncLease(input.storage.getItem(input.key));
  if (current && current.ownerId !== input.ownerId && current.expiresAt > input.now) {
    return false;
  }

  const next = {
    ownerId: input.ownerId,
    expiresAt: input.now + (input.durationMs ?? MAILBOX_SYNC_LEASE_MS),
  };
  input.storage.setItem(input.key, JSON.stringify(next));
  const confirmed = parseMailboxSyncLease(input.storage.getItem(input.key));
  return confirmed?.ownerId === input.ownerId;
}

export function releaseMailboxSyncLease(input: {
  storage: Pick<Storage, "getItem" | "removeItem">;
  key: string;
  ownerId: string;
}) {
  const current = parseMailboxSyncLease(input.storage.getItem(input.key));
  if (current?.ownerId === input.ownerId) input.storage.removeItem(input.key);
}

export function pickAutomaticMailboxConnection(
  connections: ConnectedMailbox[],
  userId: string
): ConnectedMailbox | undefined {
  return connections.find(
    (connection) =>
      connection.ownerType === "staff" &&
      connection.status === "connected" &&
      connection.userId === userId
  );
}

export function MailboxInboxSyncAgent() {
  const { user } = useAuth();
  const { agency } = useTenant();
  const running = useRef(false);
  const connectionCache = useRef<ConnectionCache | null>(null);

  useEffect(() => {
    if (!user || !agency?.id) return;

    let cancelled = false;
    let timer: number | undefined;
    let consecutiveFailures = 0;
    let syncRequestedWhileRunning = false;
    const leaseKey = `${MAILBOX_SYNC_LEASE_PREFIX}:${agency.id}:${user.id}`;
    connectionCache.current = null;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void sync(), delayMs);
    };

    const resolveConnectionId = async () => {
      const cached = connectionCache.current;
      const cacheDuration = cached?.connectionId
        ? CONNECTED_MAILBOX_REFRESH_MS
        : MISSING_MAILBOX_REFRESH_MS;
      if (cached && Date.now() - cached.checkedAt < cacheDuration) {
        return cached.connectionId;
      }

      const result = await listMailboxConnections({
        user,
        tenantId: agency.id,
        mineOnly: true,
      });
      if (cancelled) return null;

      const connectionId = result.ok
        ? pickAutomaticMailboxConnection(result.connections, user.id)?.id ?? null
        : null;
      connectionCache.current = { checkedAt: Date.now(), connectionId };
      return connectionId;
    };

    const sync = async () => {
      if (cancelled) return;
      if (running.current) {
        syncRequestedWhileRunning = true;
        return;
      }
      if (!navigator.onLine) {
        schedule(OFFLINE_RETRY_MS);
        return;
      }
      if (
        !claimMailboxSyncLease({
          storage: window.localStorage,
          key: leaseKey,
          ownerId: mailboxSyncAgentId,
          now: Date.now(),
        })
      ) {
        schedule(MAILBOX_SYNC_LEASE_RETRY_MS);
        return;
      }

      running.current = true;
      try {
        const connectionId = await resolveConnectionId();
        if (!connectionId || cancelled) {
          consecutiveFailures = 0;
          schedule(MISSING_MAILBOX_RETRY_MS);
          return;
        }

        const result = await syncCommunicationsFromLiveMailbox({
          tenantId: agency.id,
          user,
          connectionId,
          maxResults: 25,
          automatic: true,
        });
        if (!result.ok) {
          consecutiveFailures += 1;
          connectionCache.current = null;
          schedule(mailboxSyncRetryDelay(consecutiveFailures));
          return;
        }

        consecutiveFailures = 0;
        await api.communications.automatePersonalQuoteReplies(agency.id, user.id);
        api.communications.sweepInboundForActivities(agency.id, user.id);
        schedule(ACTIVE_MAILBOX_SYNC_INTERVAL_MS);
      } finally {
        running.current = false;
        if (syncRequestedWhileRunning && !cancelled) {
          syncRequestedWhileRunning = false;
          schedule(0);
        }
      }
    };

    const requestImmediateSync = () => {
      if (cancelled) return;
      if (running.current) {
        syncRequestedWhileRunning = true;
        return;
      }
      schedule(0);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") requestImmediateSync();
    };
    const onFocus = () => requestImmediateSync();
    const onOnline = () => requestImmediateSync();

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    schedule(0);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      releaseMailboxSyncLease({
        storage: window.localStorage,
        key: leaseKey,
        ownerId: mailboxSyncAgentId,
      });
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [agency?.id, user]);

  return null;
}
