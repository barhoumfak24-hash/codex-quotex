import { useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface CarrierEmailReviewQueueProps {
  tenantId: string;
  actorId: string;
}

export function CarrierEmailReviewQueue({ tenantId, actorId }: CarrierEmailReviewQueueProps) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = api.quoting.listCarrierEmailProcessing(tenantId, "manual_review");
  const communications = useMemo(
    () => new Map(api.communications.listByTenant(tenantId).map((row) => [row.id, row])),
    [tenantId, rows.length]
  );
  const options = useMemo(
    () =>
      api.quoting
        .listByTenant(tenantId)
        .filter((session) => session.lineOfBusiness === "commercial")
        .flatMap((session) => {
          const contactName = session.customerId
            ? api.customers.get(session.customerId)?.name
            : session.prospectId
              ? api.prospects.get(session.prospectId)?.name
              : undefined;
          return (session.commercialCarrierSubmissions ?? []).map((submission) => ({
            sessionId: session.id,
            submissionId: submission.submissionId ?? `${session.id}:${submission.carrierId}`,
            label: `${contactName ?? "Commercial quote"} - ${
              api.carriers.get(submission.carrierId)?.name ?? "Carrier"
            }`,
          }));
        }),
    [tenantId, rows.length]
  );

  if (rows.length === 0) return null;

  async function assign(processingId: string) {
    const value = selected[processingId];
    if (!value) {
      setNotice("Choose the exact quote submission before processing this email.");
      return;
    }
    const [sessionId, submissionId] = value.split("|");
    setBusyId(processingId);
    setNotice(null);
    try {
      const result = await api.quoting.assignCarrierEmailProcessing({
        processingId,
        sessionId,
        submissionId,
        assignedById: actorId,
      });
      setNotice(
        result
          ? "Carrier reply assigned and processed."
          : "That reply could not be assigned. Refresh and choose the submission again."
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="border border-gold-200 bg-gold-50/40 rounded-md px-4 py-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-gold-700 shrink-0" />
        <div>
          <h2 className="font-medium text-sm">Carrier replies needing review</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            These emails had no unique submission identifier. Choose the exact quote before Quotex
            applies the reply.
          </p>
        </div>
      </div>
      <div className="divide-y divide-gold-200 border-y border-gold-200">
        {rows.map((row) => {
          const communication = communications.get(row.communicationId);
          const candidateIds = new Set(row.candidateSubmissionIds ?? []);
          const rowOptions = candidateIds.size
            ? options.filter((option) => candidateIds.has(option.submissionId))
            : options;
          return (
            <div key={row.id} className="py-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)_auto] lg:items-end">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">
                  {communication?.subject || "Carrier reply"}
                </div>
                <div className="text-xs text-ink-500 truncate mt-0.5">
                  {communication?.externalRecipientEmail || "Unknown sender"} - {row.matchReason}
                </div>
              </div>
              <label className="text-xs font-medium text-ink-600">
                Quote submission
                <select
                  className="input mt-1 w-full"
                  value={selected[row.id] ?? ""}
                  onChange={(event) =>
                    setSelected((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                >
                  <option value="">Select client and carrier</option>
                  {rowOptions.map((option) => (
                    <option
                      key={`${option.sessionId}:${option.submissionId}`}
                      value={`${option.sessionId}|${option.submissionId}`}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-outline text-sm"
                disabled={busyId === row.id || !(selected[row.id] ?? "")}
                onClick={() => void assign(row.id)}
              >
                {busyId === row.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Assign and process
              </button>
            </div>
          );
        })}
      </div>
      {notice && <p className="text-xs text-ink-600">{notice}</p>}
    </section>
  );
}
