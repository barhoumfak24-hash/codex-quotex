import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileSignature, RefreshCw, Send } from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { api } from "@/lib/api";
import {
  agencyPlanRenewalIso,
  agencyPlanStartIso,
  agencyPlanTermMonths,
  agencyRenewalStatus,
  daysUntilAgencyRenewal,
  monthsUntilAgencyRenewal,
} from "@/lib/agencyContract";
import { fmt } from "@/lib/format";
import type { Agency } from "@/types";

type RenewalRow = {
  agency: Agency;
  termMonths: number;
  monthsLeft: number;
  daysLeft: number;
  renewalIso: string;
  startIso: string;
  contractPending: boolean;
  contractSigned: boolean;
};

function isContractPending(agency: Agency): boolean {
  const sentAt = agency.softwarePlanRenewalContractSentAt;
  if (!sentAt) return false;
  const signedAt = agency.softwarePlanRenewalContractSignedAt;
  return !signedAt || signedAt < sentAt;
}

function buildRows(): RenewalRow[] {
  return api.agencies
    .list()
    .map((agency) => {
      const daysLeft = daysUntilAgencyRenewal(agency);
      return {
        agency,
        termMonths: agencyPlanTermMonths(agency),
        monthsLeft: monthsUntilAgencyRenewal(agency),
        daysLeft,
        renewalIso: agencyPlanRenewalIso(agency),
        startIso: agencyPlanStartIso(agency),
        contractPending: isContractPending(agency),
        contractSigned: !!agency.softwarePlanRenewalContractSignedAt,
      };
    })
    .sort((a, b) => {
      if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
      return a.agency.name.localeCompare(b.agency.name);
    });
}

export function MasterRenewalsPage() {
  const [rev, setRev] = useState(0);
  const [notice, setNotice] = useState("");
  const rows = useMemo(() => buildRows(), [rev]);
  const dueSoonCount = rows.filter((row) => row.daysLeft <= 90).length;
  const overdueCount = rows.filter((row) => row.daysLeft < 0).length;
  const pendingCount = rows.filter((row) => row.contractPending).length;

  function refresh(message: string) {
    setNotice(message);
    setRev((value) => value + 1);
    window.setTimeout(() => {
      setNotice((current) => (current === message ? "" : current));
    }, 2200);
  }

  function sendRenewal(row: RenewalRow) {
    api.agencies.sendRenewalContract(row.agency.id);
    refresh(`Renewal contract sent to ${row.agency.contactEmail}.`);
  }

  function registerSigned(row: RenewalRow) {
    api.agencies.completeRenewalContractSignature(row.agency.id);
    refresh(`${row.agency.name} was automatically renewed into the next term.`);
  }

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Renewals</h1>
          <p className="mt-1 text-sm text-ink-500">
            Agency software terms sorted from closest renewal to furthest renewal.
          </p>
        </div>
        {notice && (
          <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            {notice}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Renewing within 90 days"
          value={dueSoonCount}
          hint={`${overdueCount} overdue`}
          icon={<Clock3 className="h-5 w-5" />}
        />
        <StatCard
          label="Contracts pending"
          value={pendingCount}
          hint="Sent, waiting on signature"
          icon={<FileSignature className="h-5 w-5" />}
        />
        <StatCard
          label="Agencies tracked"
          value={rows.length}
          hint="Active and inactive terms"
          icon={<RefreshCw className="h-5 w-5" />}
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="p-6 pb-0">
          <CardHeader
            title="Agency renewal queue"
            subtitle="Send a renewal contract to the agency billing contact. When the signed packet returns, the term rolls forward automatically."
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-y border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wider text-ink-500">
                <th className="px-6 py-3">Agency</th>
                <th className="px-6 py-3">Term</th>
                <th className="px-6 py-3">Time left</th>
                <th className="px-6 py-3">Renewal date</th>
                <th className="px-6 py-3">Contract</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => {
                const status = agencyRenewalStatus(row.agency);
                return (
                  <tr key={row.agency.id} className="align-top">
                    <td className="px-6 py-4">
                      <Link
                        to={`/master/agencies/${row.agency.id}`}
                        className="font-semibold text-ink-900 hover:text-gold-700"
                      >
                        {row.agency.name}
                      </Link>
                      <div className="mt-1 text-xs text-ink-500">{row.agency.contactEmail}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-ink-900">{row.termMonths} months</div>
                      <div className="mt-1 text-xs text-ink-500">Started {fmt.date(row.startIso)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-2xl font-semibold text-ink-950">{row.monthsLeft}</div>
                      <div className="text-xs text-ink-500">
                        month{row.monthsLeft === 1 ? "" : "s"} left
                        {row.daysLeft >= 0 ? ` · ${row.daysLeft} days` : ` · ${Math.abs(row.daysLeft)} days overdue`}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-ink-900">{fmt.date(row.renewalIso)}</div>
                      <div className="mt-2">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {row.contractPending ? (
                        <>
                          <Badge tone="warn">Awaiting signature</Badge>
                          <div className="mt-2 text-xs text-ink-500">
                            Sent {fmt.dateTime(row.agency.softwarePlanRenewalContractSentAt)}
                          </div>
                        </>
                      ) : row.contractSigned ? (
                        <>
                          <Badge tone="success">Signed and renewed</Badge>
                          <div className="mt-2 text-xs text-ink-500">
                            Signed {fmt.dateTime(row.agency.softwarePlanRenewalContractSignedAt)}
                          </div>
                        </>
                      ) : (
                        <>
                          <Badge tone="neutral">Not sent</Badge>
                          <div className="mt-2 text-xs text-ink-500">No renewal packet pending.</div>
                        </>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className="btn-outline text-xs" onClick={() => sendRenewal(row)}>
                          <Send className="h-3.5 w-3.5" />
                          {row.contractPending ? "Resend to client" : "Send to client"}
                        </button>
                        {row.contractPending && (
                          <button type="button" className="btn-gold text-xs" onClick={() => registerSigned(row)}>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Register signed
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
