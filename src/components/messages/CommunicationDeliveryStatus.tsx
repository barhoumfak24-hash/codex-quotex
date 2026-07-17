import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
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
        <Loader2 className="h-3 w-3 animate-spin" /> {status === "queued" ? "Email queued" : "Sending email"}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <div className="mt-1 inline-flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-900">
        <span>Email not sent yet.</span>
        {user && communication.outboxJobId && (
          <button
            type="button"
            className="inline-flex items-center gap-1 font-semibold hover:text-amber-950"
            onClick={() => void retry()}
            disabled={retrying}
          >
            <RefreshCw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} /> Try again
          </button>
        )}
      </div>
    );
  }
  return null;
}
