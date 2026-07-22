import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { syncCommunicationsFromLiveMailbox } from "@/lib/liveMailbox";
import { listMailboxConnections } from "@/lib/mailboxOAuth";
import { useTenant } from "@/lib/tenant";
import type { ConnectedMailbox } from "@/types";

const SYNC_INTERVAL_MS = 15_000;
const CONNECTED_MAILBOX_REFRESH_MS = 5 * 60_000;
const MISSING_MAILBOX_REFRESH_MS = 60_000;

type ConnectionCache = {
  checkedAt: number;
  connectionId: string | null;
};

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
    connectionCache.current = null;

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
      if (
        cancelled ||
        running.current ||
        document.visibilityState === "hidden" ||
        !navigator.onLine
      ) {
        return;
      }

      running.current = true;
      try {
        const connectionId = await resolveConnectionId();
        if (!connectionId || cancelled) return;

        const result = await syncCommunicationsFromLiveMailbox({
          tenantId: agency.id,
          user,
          connectionId,
          maxResults: 25,
          automatic: true,
        });
        if (!result.ok) {
          connectionCache.current = null;
          return;
        }

        api.communications.sweepInboundForActivities(agency.id, user.id);
      } finally {
        running.current = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const onFocus = () => void sync();
    const onOnline = () => void sync();
    const interval = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    void sync();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [agency?.id, user]);

  return null;
}
