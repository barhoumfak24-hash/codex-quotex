import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { sendCommunicationThroughLiveMailbox } from "@/lib/liveMailbox";
import type { Communication, User } from "@/types";

export function CommunicationDeliveryStatus({
  communication,
  tenantId,
  user,
}: {
  communication: Communication;
  tenantId: string;
  user?: User;
}) {
  const [retrying, setRetrying] = useState(false);
  const recoveredLegacySenderFailure = useRef(false);

  const job = communication.outboxJobId
    ? api.mailboxOutbox.get(communication.outboxJobId)
    : undefined;
  const status = job?.status ?? communication.deliveryStatus;

  async function retry() {
    if (!user || !communication.outboxJobId) return;
    setRetrying(true);
    try {
      await sendCommunicationThroughLiveMailbox({ tenantId, user, communication });
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    if (
      recoveredLegacySenderFailure.current ||
      communication.direction !== "outbound" ||
      communication.channel !== "email" ||
      !user ||
      communication.createdById !== user.id ||
      job?.status !== "failed" ||
      job.lastError !== "No sender user was available for live email delivery."
    ) {
      return;
    }
    recoveredLegacySenderFailure.current = true;
    void retry();
  }, [communication.channel, communication.createdById, communication.direction, job?.lastError, job?.status, user?.id]);

  if (communication.direction !== "outbound" || communication.channel !== "email") return null;

  if (status === "draft") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-gold-800">
        AI draft - review before sending
      </span>
    );
  }

  if (!job && status === "synced") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
        <Check className="h-3 w-3" /> Delivered to portal
      </span>
    );
  }
  if (status === "sent") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
        <Check className="h-3 w-3" /> Email sent
      </span>
    );
  }
  if (status === "queued" || status === "sending") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" /> Sending email
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" /> Sending automatically
      </span>
    );
  }
  return null;
}
