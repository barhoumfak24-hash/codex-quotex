import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Clock3, FileCheck2, Search, ShieldCheck, UserRoundCheck } from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Badge } from "@/components/ui/Badge";
import { Card, EmptyState, StatCard } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import {
  REMOTE_SIGNING_PACKET_PREFIX,
  REQUIRED_CHECKOUT_FORMS,
  readSharedRemoteSigningPacket,
  writeRemoteSigningPacket,
  type RemoteCheckoutPacket,
} from "@/pages/transactions/TransactionSitePage";
import type { Document, SoftwareSale, SoftwareSaleSignedAgreement } from "@/types";

type SignatureFilter = "all" | "customer" | "agent" | "both";

type SignedDocumentRow = {
  id: string;
  auditId: string;
  fileName: string;
  displayName: string;
  sourceLabel: string;
  agencyId?: string;
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
const MASTER_PLAN_BUILDER_DRAFT_KEY = "quotex_master_plan_builder:draft";

export function ESignedDocumentsPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SignatureFilter>("all");
  const [syncRevision, setSyncRevision] = useState(0);
  const rows = useMemo(() => buildSignedDocumentRows(), [syncRevision]);

  useEffect(() => {
    let cancelled = false;

    const syncSubmittedSigningPackets = async () => {
      const packetCandidates = signingPacketCandidates();
      let changed = false;

      for (const [packetId, hintedSale] of packetCandidates) {
        const packet = await readSharedRemoteSigningPacket(packetId);
        if (!packet || cancelled || !isCompletedSigningPacket(packet)) continue;
        writeRemoteSigningPacket(packet);
        const sale =
          (packet.saleId ? api.softwareSales.get(packet.saleId) : undefined) ??
          hintedSale ??
          recoverSoftwareSaleFromCompletedPacket(packet);
        if (!sale) continue;
        const signedAgreements = signedAgreementsFromPacket(packet);
        const signedAtValues = signedAgreements.map((agreement) => agreement.signedAt).sort();
        const signedAt = signedAtValues[signedAtValues.length - 1];
        const signedAgreementNames = signedAgreements.map((agreement) => agreement.title);
        const currentSale = api.softwareSales.get(sale.id) ?? sale;
        const needsUpdate =
          currentSale.signingPacketId !== packet.id ||
          currentSale.signedAt !== signedAt ||
          currentSale.signedPacketSubmittedAt !== packet.submittedAt ||
          signedAgreementNames.length !== (currentSale.signedAgreementNames ?? []).length ||
          signedAgreementNames.some((title, index) => title !== currentSale.signedAgreementNames?.[index]);

        if (!needsUpdate) continue;
        const updated = api.softwareSales.update(currentSale.id, {
          signingPacketId: packet.id,
          signedAgreementNames,
          signedAgreements,
          signedByName: signedAgreements[0]?.signedByName,
          signedByEmail: signedAgreements[0]?.signedByEmail,
          signedAt,
          signedPacketSubmittedAt: packet.submittedAt,
          signedPacketSubmittedByName: packet.submittedByName ?? signedAgreements[0]?.signedByName,
          signedPacketSubmittedByEmail: packet.submittedByEmail ?? signedAgreements[0]?.signedByEmail,
          invoiceEmailSentAt: packet.invoiceEmailSentAt,
          invoiceEmailStatus: packet.invoiceEmailStatus,
          invoiceEmailProvider: packet.invoiceEmailProvider,
          invoiceEmailError: packet.invoiceEmailError,
          status: packet.invoiceEmailStatus === "sent" ? "provisioning" : currentSale.status,
        });
        changed = changed || Boolean(updated);
      }

      if (changed && !cancelled) setSyncRevision((current) => current + 1);
    };

    void syncSubmittedSigningPackets();
    const interval = window.setInterval(() => void syncSubmittedSigningPackets(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);
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
      row.sourceLabel,
      row.fileName,
      row.displayName,
      row.auditId,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const customerSignatureCount = rows.filter((row) => row.customerSignedAt).length;
  const agentSignatureCount = rows.filter((row) => row.agentSignedAt).length;
  const agencyCount = new Set(rows.map((row) => row.agencyId ?? row.agencyName)).size;

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
                  <tr key={row.id} className="align-top">
                    <td className="px-6 py-4">
                      {row.agencyId ? (
                        <Link
                          to={`/master/agencies/${row.agencyId}`}
                          className="font-semibold text-ink-900 hover:text-gold-700"
                        >
                          {row.agencyName}
                        </Link>
                      ) : (
                        <span className="font-semibold text-ink-900">{row.agencyName}</span>
                      )}
                      <div className="mt-1 text-xs text-ink-500">{row.sourceLabel}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-ink-900">{row.fileName}</div>
                      <div className="mt-1 text-xs text-ink-500">
                        {row.displayName}
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
                      <div className="font-mono text-xs text-ink-500">{row.auditId}</div>
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
  const documentRows = api.agencies
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
            id: `document:${document.id}`,
            auditId: document.id,
            fileName: document.fileName,
            displayName: api.helpers.documentDisplayName(document),
            sourceLabel: "Agency document",
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
    );
  const softwareSaleRows = buildSoftwareSaleSignedRows();

  return [...documentRows, ...softwareSaleRows]
    .sort((a, b) => (a.latestSignedAt < b.latestSignedAt ? 1 : -1));
}

function buildSoftwareSaleSignedRows(): SignedDocumentRow[] {
  const agenciesByName = new Map(api.agencies.list().map((agency) => [normalizeAgencyName(agency.name), agency]));

  return api.softwareSales.list().flatMap((sale) => {
    const signedAgreements = softwareSaleSignedAgreements(sale);
    if (signedAgreements.length === 0) return [];

    const agency = agenciesByName.get(normalizeAgencyName(sale.agencyName));
    return signedAgreements.map((agreement) => {
      const signedAt = agreement.signedAt || sale.signedAt || sale.signedPacketSubmittedAt || sale.updatedAt;
      return {
        id: `software-sale:${sale.id}:${agreement.id}`,
        auditId: sale.id,
        fileName: agreement.title,
        displayName: [agreement.summary, agreement.version ? `Version ${agreement.version}` : "", "Software sale packet"]
          .filter(Boolean)
          .join(" - "),
        sourceLabel: "Software sale packet",
        agencyId: agency?.id,
        agencyName: sale.agencyName,
        clientName: sale.contactName,
        policyLabel: `${fmt.titleCase(sale.tier)} plan - ${sale.seats} user${sale.seats === 1 ? "" : "s"}`,
        signerLabel: `${agreement.signedByName} (${agreement.signedByEmail})`,
        signatureStatus: "Customer" as const,
        customerSignedAt: signedAt,
        latestSignedAt: signedAt,
      };
    });
  });
}

function softwareSaleSignedAgreements(sale: SoftwareSale): SoftwareSaleSignedAgreement[] {
  if (sale.signedAgreements?.length) return sale.signedAgreements;
  const signedAt = sale.signedAt ?? sale.signedPacketSubmittedAt;
  if (!signedAt || !sale.signedAgreementNames?.length) return [];

  return sale.signedAgreementNames.map((title, index) => ({
    id: `legacy-${index + 1}`,
    title,
    signedAt,
    signedByName: sale.signedByName ?? sale.signedPacketSubmittedByName ?? sale.contactName,
    signedByEmail: sale.signedByEmail ?? sale.signedPacketSubmittedByEmail ?? sale.email,
    signatureMethod: "typed_name_with_checkbox",
  }));
}

function signingPacketCandidates(): Map<string, SoftwareSale | null> {
  const candidates = new Map<string, SoftwareSale | null>();
  for (const sale of api.softwareSales.list()) {
    if (sale.signingPacketId) candidates.set(sale.signingPacketId, sale);
  }
  for (const packetId of locallyKnownSigningPacketIds()) {
    if (!candidates.has(packetId)) candidates.set(packetId, null);
  }
  return candidates;
}

function locallyKnownSigningPacketIds(): string[] {
  if (typeof localStorage === "undefined") return [];
  const packetIds = new Set<string>();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(REMOTE_SIGNING_PACKET_PREFIX)) {
      const packetId = key.slice(REMOTE_SIGNING_PACKET_PREFIX.length);
      if (packetId) packetIds.add(packetId);
    }
  }
  try {
    const draft = JSON.parse(localStorage.getItem(MASTER_PLAN_BUILDER_DRAFT_KEY) ?? "{}") as {
      packetId?: string | null;
    };
    if (draft.packetId) packetIds.add(draft.packetId);
  } catch {
    // Ignore malformed browser cache; normal sale rows still drive the page.
  }
  return Array.from(packetIds);
}

function recoverSoftwareSaleFromCompletedPacket(packet: RemoteCheckoutPacket): SoftwareSale | null {
  try {
    return api.softwareSales.create({
      agencyName: packet.agencyName,
      contactName: packet.contactName,
      email: packet.email,
      phone: packet.phone,
      website: packet.website,
      tier: packet.tier ?? billingTierForSeats(packet.seats),
      seats: packet.seats,
      estimatedMonthly: packet.estimatedMonthly,
      setupFee: packet.setupFee ?? 0,
      websiteAppAddOn: packet.websiteAppAddOn,
      websiteAppAddOnMonthly: packet.websiteAppAddOnMonthly,
      termMonths: packet.termMonths,
      termDiscountPercent: packet.termDiscountPercent,
      termDiscountMonthly: packet.termDiscountMonthly,
      monthlyBeforeTermDiscount: packet.monthlyBeforeTermDiscount,
      standardEstimatedMonthly: packet.standardEstimatedMonthly,
      customMonthlyPriceUsd: packet.customMonthlyPriceUsd,
      customMonthlyPriceReason: packet.customMonthlyPriceReason,
      source: packet.source ?? "master_portal",
      paymentMode: packet.paymentMode ?? "stripe_checkout",
      notes: `Recovered from completed e-sign packet ${packet.id}.`,
      signingPacketId: packet.id,
      stripeCheckoutSessionId: packet.stripeCheckoutSessionId,
      invoiceEmailSentAt: packet.invoiceEmailSentAt,
      invoiceEmailStatus: packet.invoiceEmailStatus,
      invoiceEmailProvider: packet.invoiceEmailProvider,
      invoiceEmailError: packet.invoiceEmailError,
      status: packet.invoiceEmailStatus === "sent" ? "provisioning" : "checkout_pending",
    });
  } catch {
    return null;
  }
}

function signedAgreementsFromPacket(packet: RemoteCheckoutPacket): SoftwareSaleSignedAgreement[] {
  return REQUIRED_CHECKOUT_FORMS.map((requiredForm) => {
    const signature = packet.signatures[requiredForm.id];
    return {
      id: requiredForm.id,
      title: requiredForm.title,
      summary: requiredForm.summary,
      version: requiredForm.version,
      viewedAt: signature?.viewedAt,
      signedAt: signature?.signedAt ?? packet.submittedAt ?? new Date().toISOString(),
      signedByName: signature?.signerName?.trim() || packet.contactName,
      signedByEmail: signature?.signedByEmail || packet.email,
      signatureStatement: requiredForm.signatureStatement,
      electronicRecordConsent: requiredForm.id === "electronic-records-consent",
      signatureMethod: "typed_name_with_checkbox",
      signerUserAgent: signature?.signerUserAgent,
    };
  });
}

function isCompletedSigningPacket(packet: RemoteCheckoutPacket) {
  return Boolean(
    packet.submittedAt &&
      REQUIRED_CHECKOUT_FORMS.every((requiredForm) => packet.signatures[requiredForm.id]?.signedAt)
  );
}

function normalizeAgencyName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function billingTierForSeats(seats: number): SoftwareSale["tier"] {
  if (seats <= 10) return "minimum";
  if (seats <= 25) return "mid";
  return "ultra";
}
