import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Clock3, FileCheck2, Search, ShieldCheck, UserRoundCheck } from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, StatCard } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Document } from "@/types";

type SignatureFilter = "all" | "customer" | "agent" | "both";

type SignedDocumentRow = {
  document: Document;
  agencyId: string;
  agencyName: string;
  clientName: string;
  policyLabel: string;
  signerLabel: string;
  signatureStatus: "Customer" | "Agent" | "Customer + Agent";
  customerSignedAt?: string;
  agentSignedAt?: string;
  latestSignedAt: string;
};

const filters: { value: SignatureFilter; label: string }[] = [
  { value: "all", label: "All signed" },
  { value: "customer", label: "Customer signed" },
  { value: "agent", label: "Agent signed" },
  { value: "both", label: "Both signed" },
];

export function ESignedDocumentsPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SignatureFilter>("all");
  const rows = useMemo(() => buildSignedDocumentRows(), []);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = rows.filter((row) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "customer" && !!row.customerSignedAt) ||
      (filter === "agent" && !!row.agentSignedAt) ||
      (filter === "both" && !!row.customerSignedAt && !!row.agentSignedAt);
    if (!matchesFilter) return false;
    if (!normalizedQuery) return true;
    return [
      row.agencyName,
      row.clientName,
      row.policyLabel,
      row.signerLabel,
      row.signatureStatus,
      row.document.fileName,
      api.helpers.documentDisplayName(row.document),
      row.document.id,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const customerSignatureCount = rows.filter((row) => row.customerSignedAt).length;
  const agentSignatureCount = rows.filter((row) => row.agentSignedAt).length;
  const agencyCount = new Set(rows.map((row) => row.agencyId)).size;

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div>
        <h1 className="font-display text-3xl">E-signed documents</h1>
        <p className="text-ink-500 text-sm mt-1">
          Master audit view of executed e-signatures across every agency.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Signed documents"
          value={rows.length}
          hint={`${agencyCount} agenc${agencyCount === 1 ? "y" : "ies"}`}
          icon={<FileCheck2 className="h-5 w-5" />}
        />
        <StatCard
          label="Customer signatures"
          value={customerSignatureCount}
          hint="Client-side executed copies"
          icon={<UserRoundCheck className="h-5 w-5" />}
        />
        <StatCard
          label="Agent signatures"
          value={agentSignatureCount}
          hint="Staff e-sign approvals"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
      </div>

      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="input pl-11"
              placeholder="Search agency, document, client, policy, signer..."
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={filter === item.value ? "btn-primary" : "btn-outline"}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        {visibleRows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<FileCheck2 className="h-8 w-8" />}
              title="No signed documents found"
              description="Executed customer or agent e-signatures will appear here with agency, signer, and timestamp once documents are signed."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
                  <th className="px-6 py-3">Agency</th>
                  <th className="px-6 py-3">Document</th>
                  <th className="px-6 py-3">Client / policy</th>
                  <th className="px-6 py-3">Signed by</th>
                  <th className="px-6 py-3">Timestamp</th>
                  <th className="px-6 py-3 text-right">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visibleRows.map((row) => (
                  <tr key={row.document.id} className="align-top">
                    <td className="px-6 py-4">
                      <Link
                        to={`/master/agencies/${row.agencyId}`}
                        className="font-semibold text-ink-900 hover:text-gold-700"
                      >
                        {row.agencyName}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-ink-900">{row.document.fileName}</div>
                      <div className="mt-1 text-xs text-ink-500">
                        {api.helpers.documentDisplayName(row.document)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-ink-900">{row.clientName}</div>
                      <div className="mt-1 text-xs text-ink-500">{row.policyLabel}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge tone={row.signatureStatus === "Customer + Agent" ? "gold" : "success"}>
                        {row.signatureStatus}
                      </Badge>
                      <div className="mt-2 text-xs text-ink-500">{row.signerLabel}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 font-medium text-ink-900">
                        <Clock3 className="h-4 w-4 text-gold-600" />
                        {fmt.dateTime(row.latestSignedAt)}
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs text-ink-500">
                        {row.customerSignedAt && <div>Customer: {fmt.dateTime(row.customerSignedAt)}</div>}
                        {row.agentSignedAt && <div>Agent: {fmt.dateTime(row.agentSignedAt)}</div>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="font-mono text-xs text-ink-500">{row.document.id}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function buildSignedDocumentRows(): SignedDocumentRow[] {
  return api.agencies
    .list()
    .flatMap((agency) =>
      api.documents
        .listByTenant(agency.id)
        .filter((document) => document.customerEsignSignedAt || document.agentEsignSignedAt)
        .map((document) => {
          const customer = document.customerId ? api.customers.get(document.customerId) : undefined;
          const policy = document.policyId ? api.policies.get(document.policyId) : undefined;
          const agent = document.agentEsignAssignedToId
            ? api.users.get(document.agentEsignAssignedToId)
            : document.uploadedById
              ? api.users.get(document.uploadedById)
              : undefined;
          const signedDates = [document.customerEsignSignedAt, document.agentEsignSignedAt].filter(
            (date): date is string => !!date
          );
          const latestSignedAt = signedDates.sort((a, b) => (a < b ? 1 : -1))[0];
          const customerSigned = !!document.customerEsignSignedAt;
          const agentSigned = !!document.agentEsignSignedAt;
          const signerLabel =
            customerSigned && agentSigned
              ? `${customer?.name ?? "Customer"} and ${document.agentEsignSignatureName ?? agent?.name ?? "Agent"}`
              : customerSigned
                ? customer?.name ?? "Customer"
                : document.agentEsignSignatureName ?? agent?.name ?? "Agent";
          const signatureStatus: SignedDocumentRow["signatureStatus"] =
            customerSigned && agentSigned ? "Customer + Agent" : customerSigned ? "Customer" : "Agent";

          return {
            document,
            agencyId: agency.id,
            agencyName: agency.name,
            clientName: customer?.name ?? "No client linked",
            policyLabel: policy ? fmt.policyRef(policy) : "No policy linked",
            signerLabel,
            signatureStatus,
            customerSignedAt: document.customerEsignSignedAt,
            agentSignedAt: document.agentEsignSignedAt,
            latestSignedAt,
          };
        })
    )
    .sort((a, b) => (a.latestSignedAt < b.latestSignedAt ? 1 : -1));
}
