import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { retryPendingMailboxOutbox } from "@/lib/liveMailbox";

const RETRY_INTERVAL_MS = 15_000;

export function MailboxOutboxRetryAgent() {
  const { user } = useAuth();
  const { agency } = useTenant();
  const running = useRef(false);

  useEffect(() => {
    if (!user || !agency?.id) return;

    const retry = async () => {
      if (running.current || document.visibilityState === "hidden" || !navigator.onLine) return;
      running.current = true;
      try {
        await retryPendingMailboxOutbox({ tenantId: agency.id, user });
      } finally {
        running.current = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void retry();
    };
    const interval = window.setInterval(() => void retry(), RETRY_INTERVAL_MS);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    void retry();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [agency?.id, user]);

  return null;
}
