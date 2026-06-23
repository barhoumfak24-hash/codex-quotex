import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  Mail,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Wand2,
  X,
} from "lucide-react";
import { AddPolicyModal } from "@/components/policies/AddPolicyModal";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { Modal } from "@/components/ui/Modal";
import { DocumentList } from "@/components/ui/DocumentList";
import { MapLink } from "@/components/ui/MapLink";
import { PolicyStatusBadge, RenewalStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { aiExtractContactFromFile } from "@/lib/ai";
import { matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { useIntegrationNotice } from "@/lib/integrationNotice";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { fileToCommunicationAttachment, formatAttachmentSize } from "@/lib/messageAttachments";
import { buildPolicyAssociatedAddresses } from "@/lib/policyAddresses";
import type {
  Asset,
  CommunicationAttachment,
  Document,
  Policy,
  PolicyParticipant,
  PolicyParty,
} from "@/types";

// =====================================================================
// Employee-side full policy detail. Mirrors CustomerPolicyPage so the
// agent / manager has the same expandable surface the customer sees,
// with the extra context staff need (client back-link, internal
// timeline, download + edit-on-carrier actions inline).
// =====================================================================

type SendContext =
  | { kind: "description" }
  | { kind: "holder_description" }
  | { kind: "documents"; documentIds: string[] }
  | { kind: "holders"; documentIds: string[] };

type HolderFilter =
  | "all"
  | "named_insured"
  | "additional_insured"
  | "lienholder"
  | "mortgagee"
  | "certificate_holder"
  | "missing_email";

type ParticipantFilter = "all" | "driver" | "operator" | "household" | "excluded" | "other";

type PolicyHolderRow = PolicyParty & {
  id: string;
  source: "customer" | "policy";
};

type PolicyParticipantRow = PolicyParticipant & {
  id: string;
  source: "policy" | "legacy_holder";
  sourceIndex?: number;
};

type ClientHolderQuickAdd = PolicyParty & {
  id: string;
  sourcePolicyId: string;
  sourcePolicyLabel: string;
};

type ClientParticipantQuickAdd = {
  id: string;
  name: string;
  relationship?: string;
  sourceLabel: string;
  email?: string;
  phone?: string;
  address?: string;
  participantType?: PolicyParticipant["participantType"];
  status?: PolicyParticipant["status"];
  dateOfBirth?: string;
  licenseState?: string;
  licenseNumber?: string;
  notes?: string;
};

type HolderForm = {
  name: string;
  holderType: NonNullable<PolicyParty["holderType"]>;
  relationship: string;
  email: string;
  phone: string;
  address: string;
  deliveryPreference: NonNullable<PolicyParty["deliveryPreference"]>;
  notes: string;
};

type ParticipantForm = {
  name: string;
  participantType: PolicyParticipant["participantType"];
  relationship: string;
  status: NonNullable<PolicyParticipant["status"]>;
  email: string;
  phone: string;
  dateOfBirth: string;
  licenseState: string;
  licenseNumber: string;
  notes: string;
};

const HOLDER_FILTERS: Array<{ id: HolderFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "named_insured", label: "Named insured" },
  { id: "additional_insured", label: "Additional insured" },
  { id: "lienholder", label: "Lienholder" },
  { id: "mortgagee", label: "Mortgagee" },
  { id: "certificate_holder", label: "Certificate holder" },
  { id: "missing_email", label: "Missing email" },
];

const HOLDER_TYPE_OPTIONS: Array<{ value: HolderForm["holderType"]; label: string }> = [
  { value: "named_insured", label: "Named insured" },
  { value: "additional_insured", label: "Additional insured" },
  { value: "lienholder", label: "Lienholder" },
  { value: "mortgagee", label: "Mortgagee" },
  { value: "certificate_holder", label: "Certificate holder" },
  { value: "beneficiary", label: "Beneficiary" },
  { value: "other", label: "Custom" },
];

const PARTICIPANT_FILTERS: Array<{ id: ParticipantFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "driver", label: "Drivers" },
  { id: "operator", label: "Operators" },
  { id: "household", label: "Household / occupants" },
  { id: "excluded", label: "Excluded" },
  { id: "other", label: "Other" },
];

const PARTICIPANT_TYPE_OPTIONS: Array<{ value: ParticipantForm["participantType"]; label: string }> = [
  { value: "driver", label: "Driver" },
  { value: "excluded_driver", label: "Excluded driver" },
  { value: "operator", label: "Operator" },
  { value: "captain", label: "Captain" },
  { value: "household_member", label: "Household member" },
  { value: "occupant", label: "Occupant" },
  { value: "operations_contact", label: "Operations contact" },
  { value: "other", label: "Custom" },
];

export function EmployeePolicyPage() {
  const { policyId } = useParams();
  const { agency } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const showIntegrationNotice = useIntegrationNotice();
  const [editOpen, setEditOpen] = useState(false);
  const [, setRev] = useState(0);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendContext, setSendContext] = useState<SendContext | null>(null);
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sendExtraAttachments, setSendExtraAttachments] = useState<CommunicationAttachment[]>([]);
  const [sendAttaching, setSendAttaching] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const sendFileInputRef = useRef<HTMLInputElement | null>(null);
  const [documentSendSelecting, setDocumentSendSelecting] = useState(false);
  const [holderDocumentSendSelecting, setHolderDocumentSendSelecting] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedHolderIds, setSelectedHolderIds] = useState<string[]>([]);
  const [holderSearch, setHolderSearch] = useState("");
  const [holderFilter, setHolderFilter] = useState<HolderFilter>("all");
  const [holderAiFilter, setHolderAiFilter] = useState("");
  const [holderModalOpen, setHolderModalOpen] = useState(false);
  const [holderAiText, setHolderAiText] = useState("");
  const [holderAiBusy, setHolderAiBusy] = useState(false);
  const [holderAiFileName, setHolderAiFileName] = useState<string | null>(null);
  const [holderAiSummary, setHolderAiSummary] = useState<string | null>(null);
  const [holderForm, setHolderForm] = useState<HolderForm>(() => emptyHolderForm());
  const [participantSearch, setParticipantSearch] = useState("");
  const [participantFilter, setParticipantFilter] = useState<ParticipantFilter>("all");
  const [participantModalOpen, setParticipantModalOpen] = useState(false);
  const [participantForm, setParticipantForm] = useState<ParticipantForm>(() => emptyParticipantForm());
  // Ensure upcoming renewals on this tenant have their term-bound docs
  // flagged + the renewal activity card present — covers both fresh
  // and stale-localStorage cases so the Update-for-Renewal flow shows
  // up on visit.
  useEffect(() => {
    if (!agency) return;
    api.renewals.ensureActivities(agency.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id]);
  if (!policyId || !agency || !user) return null;
  const policy = api.policies.get(policyId);
  if (!policy || policy.tenantId !== agency.id) {
    return <EmptyState title="Policy not found" />;
  }
  const customer = api.customers.get(policy.customerId);
  // Same visibility gate as the rest of the staff surface — an agent
  // shouldn't reach a policy by URL guess if the parent client isn't
  // in their book.
  if (
    !customer ||
    !api.customers.canSee(customer, { id: user.id, role: user.role })
  ) {
    return <EmptyState title="Policy not found" />;
  }
  const asset = api.assets.get(policy.assetId);
  const carrier = api.carriers.get(policy.carrierId);
  const documents = api.documents.listByEntity({ policyId });
  const sendingDocuments =
    sendContext?.kind === "documents" || sendContext?.kind === "holders"
      ? sendContext.documentIds
          .map((id) => documents.find((d) => d.id === id))
          .filter((d): d is Document => !!d)
      : [];
  // Staff see everything (internal + customer-visible) on the
  // timeline — same as ClientDetailPage's timeline panel.
  const events = api.status.listFor({ policyId });
  const renewedCount: number = 0;

  // `policy` is narrowed by the early return above; alias it to a
  // non-null local so the callbacks below don't trip TS narrowing
  // across function boundaries.
  const livePolicy: Policy = policy;
  const liveCustomer = customer;
  const liveUser = user;
  const policyHolders = buildPolicyHolders(livePolicy, customer);
  const policyParticipants = buildPolicyParticipants(livePolicy);
  const associatedAddresses = buildPolicyAssociatedAddresses({
    asset,
    customerGaragingAddress: customer?.garagingAddress,
    holders: [...(livePolicy.additionalInsureds ?? []), ...(livePolicy.beneficiaries ?? [])],
  });
  const participantCopy = getParticipantCardCopy(livePolicy, asset);
  const filteredPolicyParticipants = filterPolicyParticipants(
    policyParticipants,
    participantSearch,
    participantFilter
  );
  const clientHolderQuickAdds = buildClientHolderQuickAdds(
    api.policies.listByCustomer(liveCustomer.id),
    livePolicy
  );
  const clientParticipantQuickAdds = buildClientParticipantQuickAdds(
    api.policies.listByCustomer(liveCustomer.id),
    livePolicy,
    liveCustomer
  );
  const filteredPolicyHolders = filterPolicyHolders(
    policyHolders,
    holderSearch,
    holderFilter,
    holderAiFilter
  );
  const sendablePolicyHolders = policyHolders.filter(
    (holder) => holder.source === "policy" && !!holder.email?.trim()
  );
  const sendingHolderRecipients =
    sendContext?.kind === "holders" || sendContext?.kind === "holder_description"
      ? sendablePolicyHolders.filter((holder) => selectedHolderIds.includes(holder.id))
      : [];
  const holderSendContext =
    sendContext?.kind === "holders" || sendContext?.kind === "holder_description";
  function handleDownload() {
    const lines = buildPolicySummary({
      policy: livePolicy,
      customerName: customer?.name,
      assetLabel: asset?.label,
      carrierName: carrier?.name,
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `policy-${fmt.policyRef(livePolicy).replace(/[^a-z0-9-]/gi, "_")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Plain-language description rendered in the card; also reused to
  // seed the "Send to client" email draft so the customer gets the
  // exact summary they're being shown on staff side.
  const desc = useMemo(
    () => describePolicy(livePolicy, asset, carrier),
    [livePolicy, asset, carrier]
  );

  function openSendToClient() {
    if (!customer) return;
    const firstName = customer.name.split(/\s+/)[0] || customer.name;
    let lines = [
      `Hi ${firstName},`,
      ``,
      `Here's a quick summary of your ${api.helpers.departmentLabel(livePolicy).toLowerCase()} coverage with us — pulled straight from your policy on file.`,
      ``,
      desc.summary,
      ``,
      `What's covered:`,
      ...desc.coverages.map((c) => `  • ${c}`),
    ];
    if (desc.note) {
      lines.push("", desc.note);
    }
    lines.push(
      "",
      `If anything looks off or you'd like to update limits, add or remove a covered asset, or review options at renewal, just reply to this email and I'll get on it right away.`,
      ``,
      `Thank you for trusting us with your coverage. Please do not hesitate to reach out with any questions.`
    );
    setSendSubject(`Your ${asset?.label ?? "policy"} summary · ${fmt.policyRef(livePolicy)}`);
    lines = buildPolicyOverviewClientMessage({
      policy: livePolicy,
      customerName: customer.name,
      assetLabel: asset?.label,
      carrierName: carrier?.name,
      description: desc,
    });
    setSendBody(lines.join("\n"));
    setSendExtraAttachments([]);
    setSentAt(null);
    setSendContext({ kind: "description" });
    setSendOpen(true);
  }

  function openSendOverviewToHolders() {
    const recipientIds = sendablePolicyHolders.map((holder) => holder.id);
    setSelectedHolderIds(recipientIds);
    const lines = [
      `Hello,`,
      ``,
      `Below is the current policy overview for ${liveCustomer.name}.`,
      ``,
      `Policy overview:`,
      `Policy type: ${api.helpers.departmentLabel(livePolicy)}`,
      `Client: ${liveCustomer.name}`,
      `Asset: ${asset?.label ?? "Not listed"}`,
      `Carrier: ${carrier?.name ?? "Not listed"}`,
      `Policy number: ${fmt.policyRef(livePolicy)}`,
      `Status: ${fmt.titleCase(livePolicy.status)}`,
      `Renewal status: ${fmt.titleCase(livePolicy.renewalStatus)}`,
      `Effective date: ${fmt.date(livePolicy.effectiveDate)}`,
      `Renewal date: ${fmt.date(livePolicy.renewalDate)}`,
      `Premium estimate: ${livePolicy.premiumEstimate ? fmt.money(livePolicy.premiumEstimate) : "Not listed"}`,
      `Final premium: ${livePolicy.finalPremium ? fmt.money(livePolicy.finalPremium) : "Not listed"}`,
      ``,
      desc.summary,
      ``,
      `Coverage overview:`,
      ...desc.coverages.map((coverage) => `- ${coverage}`),
    ];
    if (desc.note) lines.push("", desc.note);
    lines.push(
      ``,
      `Please keep this overview on file. If you need evidence, revised wording, or specific holder documentation, reply to this email and our office will update it.`
    );
    setSendSubject(`Policy overview for ${liveCustomer.name} - ${fmt.policyRef(livePolicy)}`);
    setSendBody(lines.join("\n"));
    setSendExtraAttachments([]);
    setSentAt(null);
    setSendContext({ kind: "holder_description" });
    setSendOpen(true);
  }

  function openSendDocumentsToClient(selectedDocuments: Document[]) {
    if (!customer || selectedDocuments.length === 0) return;
    const firstName = customer.name.split(/\s+/)[0] || customer.name;
    const isSingle = selectedDocuments.length === 1;
    const docLabel = isSingle
      ? api.helpers.documentTypeLabel(String(selectedDocuments[0].type))
      : "Policy documents";
    const documentLines = selectedDocuments.map((document, index) => {
      const label = api.helpers.documentTypeLabel(String(document.type));
      return `${index + 1}. ${document.fileName} (${label})`;
    });
    const lines = [
      `Hi ${firstName},`,
      ``,
      isSingle
        ? `I've sent over the ${docLabel.toLowerCase()} for ${asset?.label ?? "your policy"}.`
        : `I've sent over the selected policy documents for ${asset?.label ?? "your policy"}.`,
      ``,
      isSingle ? `Document: ${selectedDocuments[0].fileName}` : `Documents:`,
      ...(!isSingle ? documentLines : []),
      `Policy: ${fmt.policyRef(livePolicy)}`,
    ];
    if (carrier?.name) lines.push(`Carrier: ${carrier.name}`);
    lines.push(
      ``,
      `Policy overview:`,
      `Policy type: ${api.helpers.departmentLabel(livePolicy)}`,
      `Client: ${customer.name}`,
      `Asset: ${asset?.label ?? "Not listed"}`,
      `Carrier: ${carrier?.name ?? "Not listed"}`,
      `Policy number: ${fmt.policyRef(livePolicy)}`,
      `Status: ${fmt.titleCase(livePolicy.status)}`,
      `Renewal status: ${fmt.titleCase(livePolicy.renewalStatus)}`,
      `Effective date: ${fmt.date(livePolicy.effectiveDate)}`,
      `Renewal date: ${fmt.date(livePolicy.renewalDate)}`,
      `Premium estimate: ${livePolicy.premiumEstimate ? fmt.money(livePolicy.premiumEstimate) : "Not listed"}`,
      `Final premium: ${livePolicy.finalPremium ? fmt.money(livePolicy.finalPremium) : "Not listed"}`,
      ``,
      desc.summary,
      ``,
      `Coverage overview:`,
      ...desc.coverages.map((coverage) => `- ${coverage}`)
    );
    if (desc.note) lines.push("", desc.note);
    lines.push(
      ``,
      `You can view it in your client portal under Documents. If anything looks off or you have questions about this document, just reply here and I'll help right away.`,
      ``,
      `Thank you for trusting us with your coverage.`
    );
    setSendSubject(
      isSingle
        ? `${docLabel}: ${asset?.label ?? fmt.policyRef(livePolicy)}`
        : `Policy documents: ${asset?.label ?? fmt.policyRef(livePolicy)}`
    );
    setSendBody(lines.join("\n"));
    setSendExtraAttachments([]);
    setSentAt(null);
    setSendContext({ kind: "documents", documentIds: selectedDocuments.map((d) => d.id) });
    setSendOpen(true);
  }

  function documentEmailAttachments(selectedDocuments: Document[]): CommunicationAttachment[] {
    return selectedDocuments.map((document) => ({
      id: `att_${document.id}`,
      documentId: document.id,
      fileName: document.fileName.toLowerCase().endsWith(".pdf")
        ? document.fileName
        : `${document.fileName.replace(/\.[^.]+$/, "")}.pdf`,
      fileType: "application/pdf",
      storagePath: document.storagePath,
      description: api.helpers.documentTypeLabel(String(document.type)),
    }));
  }

  async function handleSendAttachmentFiles(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (picked.length === 0) return;
    setSendAttaching(true);
    try {
      const next = await Promise.all(picked.map(fileToCommunicationAttachment));
      setSendExtraAttachments((current) => [...current, ...next]);
      setSentAt(null);
    } finally {
      setSendAttaching(false);
      if (sendFileInputRef.current) sendFileInputRef.current.value = "";
    }
  }

  function removeSendExtraAttachment(id: string) {
    setSendExtraAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setSentAt(null);
  }

  function startDocumentSendSelection() {
    setDocumentSendSelecting(true);
    setHolderDocumentSendSelecting(false);
    setSelectedDocumentIds([]);
  }

  function startHolderDocumentSendSelection() {
    setHolderDocumentSendSelecting(true);
    setDocumentSendSelecting(false);
    setSelectedDocumentIds([]);
    setSelectedHolderIds([]);
  }

  function cancelDocumentSendSelection() {
    setDocumentSendSelecting(false);
    setHolderDocumentSendSelecting(false);
    setSelectedDocumentIds([]);
  }

  function sendSelectedDocuments() {
    const selectedDocuments = selectedDocumentIds
      .map((id) => documents.find((document) => document.id === id))
      .filter((document): document is Document => !!document);
    if (selectedDocuments.length === 0) return;
    openSendDocumentsToClient(selectedDocuments);
    setDocumentSendSelecting(false);
  }

  function sendSelectedDocumentsToHolders() {
    const selectedDocuments = selectedDocumentIds
      .map((id) => documents.find((document) => document.id === id))
      .filter((document): document is Document => !!document);
    if (selectedDocuments.length === 0) return;
    openSendDocumentsToHolders(selectedDocuments);
    setHolderDocumentSendSelecting(false);
  }

  function openSendDocumentsToHolders(selectedDocuments: Document[], recipientIds = sendablePolicyHolders.map((holder) => holder.id)) {
    setSelectedHolderIds(recipientIds);
    const holderLabel =
      sendablePolicyHolders.length === 1
        ? sendablePolicyHolders[0].name
        : `${sendablePolicyHolders.length} policy holders`;
    const documentLines = selectedDocuments.map((document, index) => {
      const label = api.helpers.documentTypeLabel(String(document.type));
      return `${index + 1}. ${document.fileName} (${label})`;
    });
    const lines = [
      `Hello,`,
      ``,
      `Attached are the selected policy documents for ${liveCustomer.name}.`,
      ``,
      `Policy: ${fmt.policyRef(livePolicy)}`,
      `Carrier: ${carrier?.name ?? "Not listed"}`,
      `Client: ${liveCustomer.name}`,
      `Asset: ${asset?.label ?? "Not listed"}`,
      ``,
      `Documents attached:`,
      ...documentLines,
      ``,
      `Please keep these on file for your records. If you need different evidence, revised wording, or a specific certificate holder format, reply to this email and our office will update it.`,
      ``,
      `Thank you.`,
    ];
    setSendSubject(`Policy documents for ${liveCustomer.name} - ${fmt.policyRef(livePolicy)}`);
    setSendBody(lines.join("\n"));
    setSendExtraAttachments([]);
    setSentAt(null);
    setSendContext({ kind: "holders", documentIds: selectedDocuments.map((d) => d.id) });
    setSendOpen(true);
  }

  function openAddHolder() {
    setHolderAiText("");
    setHolderAiFileName(null);
    setHolderAiSummary(null);
    setHolderForm(emptyHolderForm());
    setHolderModalOpen(true);
  }

  function applyAiHolderAutofill() {
    const parsed = parseHolderAiText(holderAiText);
    setHolderForm((current) => ({ ...current, ...parsed }));
    setHolderAiSummary("AI filled the holder fields from the pasted details. Review anything it touched before saving.");
  }

  async function handleHolderFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setHolderAiBusy(true);
    setHolderAiFileName(file.name);
    setHolderAiSummary(null);
    try {
      const extracted = await aiExtractContactFromFile({
        fileName: file.name,
        fileType: file.type,
      });
      const inferredType = inferHolderType(
        [file.name, extracted.name, extracted.summary, extracted.address].filter(Boolean).join(" ")
      );
      setHolderForm((current) => {
        const nextType = inferredType === "other" ? current.holderType : inferredType;
        return {
          ...current,
          name: extracted.name || current.name,
          email: extracted.email || current.email,
          phone: extracted.phone || current.phone,
          address: extracted.address || current.address,
          holderType: nextType,
          relationship: current.relationship || holderTypeLabel(nextType),
          notes: [
            current.notes,
            extracted.summary
              ? `AI extracted from ${file.name}: ${extracted.summary}`
              : `AI extracted holder details from ${file.name}.`,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      });
      setHolderAiSummary(`AI extracted holder details from ${file.name}. Confirm or edit the fields before saving.`);
    } catch {
      setHolderAiSummary(`Could not extract ${file.name}. Paste the holder details below and use Autofill fields.`);
    } finally {
      setHolderAiBusy(false);
    }
  }

  function addHolderToPolicy(holder: PolicyParty, sourceLabel?: string) {
    const holderType = holder.holderType ?? inferHolderType(`${holder.relationship ?? ""} ${holder.name}`);
    const cleanHolder: PolicyParty = {
      name: holder.name.trim(),
      relationship: holder.relationship?.trim() || holderTypeLabel(holderType),
      holderType,
      email: holder.email?.trim() || undefined,
      phone: holder.phone?.trim() || undefined,
      address: holder.address?.trim() || undefined,
      deliveryPreference: holder.deliveryPreference ?? "email",
      notes: holder.notes?.trim() || undefined,
    };
    api.policies.update(livePolicy.id, {
      additionalInsureds: [...(livePolicy.additionalInsureds ?? []), cleanHolder],
    });
    api.status.create({
      tenantId: livePolicy.tenantId,
      source: "agent",
      message: `Policy holder added: ${cleanHolder.name} (${holderLabel(cleanHolder)}).${
        sourceLabel ? ` Quick-added from ${sourceLabel}.` : ""
      }`,
      visibility: "internal",
      customerId: liveCustomer.id,
      assetId: livePolicy.assetId,
      policyId: livePolicy.id,
      createdById: liveUser.id,
    });
    setRev((r) => r + 1);
  }

  function resetHolderModal() {
    setHolderForm(emptyHolderForm());
    setHolderAiText("");
    setHolderAiFileName(null);
    setHolderAiSummary(null);
  }

  function addPolicyHolder() {
    if (!holderForm.name.trim()) return;
    const holder = holderFormToPolicyParty(holderForm);
    addHolderToPolicy(holder);
    setHolderModalOpen(false);
    resetHolderModal();
  }

  function quickAddClientHolder(holder: ClientHolderQuickAdd) {
    addHolderToPolicy(holder, holder.sourcePolicyLabel);
    setHolderModalOpen(false);
    resetHolderModal();
  }

  function deletePolicyHolder(holder: PolicyHolderRow) {
    if (holder.source !== "policy") return;
    if (!confirm(`Delete ${holder.name} from this policy's holder list?`)) return;
    const additionalInsureds = [...(livePolicy.additionalInsureds ?? [])];
    const beneficiaries = [...(livePolicy.beneficiaries ?? [])];
    if (holder.id.startsWith("policy:")) {
      const index = Number(holder.id.split(":")[1]);
      if (!Number.isInteger(index)) return;
      additionalInsureds.splice(index, 1);
    } else if (holder.id.startsWith("beneficiary:")) {
      const index = Number(holder.id.split(":")[1]);
      if (!Number.isInteger(index)) return;
      beneficiaries.splice(index, 1);
    } else {
      return;
    }
    api.policies.update(livePolicy.id, {
      additionalInsureds,
      beneficiaries,
    });
    api.status.create({
      tenantId: livePolicy.tenantId,
      source: "agent",
      message: `Policy holder deleted: ${holder.name} (${holderLabel(holder)}).`,
      visibility: "internal",
      customerId: liveCustomer.id,
      assetId: livePolicy.assetId,
      policyId: livePolicy.id,
      createdById: liveUser.id,
    });
    setSelectedHolderIds((current) => current.filter((id) => id !== holder.id));
    setRev((r) => r + 1);
  }

  function openAddParticipant() {
    setParticipantForm(emptyParticipantForm(preferredParticipantType(livePolicy, asset)));
    setParticipantModalOpen(true);
  }

  function addPolicyParticipant() {
    if (!participantForm.name.trim()) return;
    const participant = participantFormToPolicyParticipant(participantForm, livePolicy.assetId);
    addParticipantToPolicy(participant);
    setParticipantModalOpen(false);
    setParticipantForm(emptyParticipantForm(preferredParticipantType(livePolicy, asset)));
  }

  function addParticipantToPolicy(participant: PolicyParticipant, sourceLabel?: string) {
    api.policies.update(livePolicy.id, {
      participants: [...(livePolicy.participants ?? []), participant],
    });
    api.status.create({
      tenantId: livePolicy.tenantId,
      source: "agent",
      message: `Policy participant added: ${participant.name} (${participantTypeLabel(participant.participantType)}).${
        sourceLabel ? ` Added from contacts on file (${sourceLabel}).` : ""
      }`,
      visibility: "internal",
      customerId: liveCustomer.id,
      assetId: livePolicy.assetId,
      policyId: livePolicy.id,
      createdById: liveUser.id,
    });
    setRev((r) => r + 1);
  }

  function quickAddClientParticipant(contact: ClientParticipantQuickAdd) {
    const participantType = contact.participantType ?? preferredParticipantType(livePolicy, asset);
    addParticipantToPolicy(
      {
        id: createLocalId("participant"),
        participantType,
        name: contact.name,
        relationship: contact.relationship || participantTypeLabel(participantType),
        status: contact.status ?? participantStatusFromType(participantType),
        email: contact.email,
        phone: contact.phone,
        dateOfBirth: contact.dateOfBirth,
        licenseState: contact.licenseState,
        licenseNumber: contact.licenseNumber,
        assignedAssetId: livePolicy.assetId,
        notes: contact.notes,
      },
      contact.sourceLabel
    );
    setParticipantModalOpen(false);
    setParticipantForm(emptyParticipantForm(preferredParticipantType(livePolicy, asset)));
  }

  function deletePolicyParticipant(participant: PolicyParticipantRow) {
    if (!confirm(`Delete ${participant.name} from this policy's participant list?`)) return;
    if (participant.source === "legacy_holder") {
      const additionalInsureds = [...(livePolicy.additionalInsureds ?? [])];
      if (typeof participant.sourceIndex !== "number") return;
      additionalInsureds.splice(participant.sourceIndex, 1);
      api.policies.update(livePolicy.id, { additionalInsureds });
    } else {
      api.policies.update(livePolicy.id, {
        participants: (livePolicy.participants ?? []).filter((row, index) => {
          const rowId = row.id ?? `participant:${index}`;
          return rowId !== participant.id;
        }),
      });
    }
    api.status.create({
      tenantId: livePolicy.tenantId,
      source: "agent",
      message: `Policy participant deleted: ${participant.name} (${participantTypeLabel(participant.participantType)}).`,
      visibility: "internal",
      customerId: liveCustomer.id,
      assetId: livePolicy.assetId,
      policyId: livePolicy.id,
      createdById: liveUser.id,
    });
    setRev((r) => r + 1);
  }

  function sendToClient() {
    if (!customer || !user) return;
    if (sendContext?.kind === "holders" || sendContext?.kind === "holder_description") {
      sendToSelectedHolders();
      return;
    }
    const selectedAttachments =
      sendContext?.kind === "documents"
        ? documentEmailAttachments(
            sendContext.documentIds
              .map((id) => api.documents.get(id))
              .filter((document): document is Document => !!document)
          )
        : [];
    const attachments = [...selectedAttachments, ...sendExtraAttachments];
    const comm = api.communications.create({
      tenantId: livePolicy.tenantId,
      customerId: liveCustomer.id,
      channel: "email",
      direction: "outbound",
      subject: sendSubject.trim() || `Your ${asset?.label ?? "policy"} summary`,
      body: sendBody,
      attachments: attachments.length > 0 ? attachments : undefined,
      createdById: liveUser.id,
    });
    if (sendContext?.kind === "description") {
      api.status.create({
        tenantId: livePolicy.tenantId,
        source: "agent",
        message: `Policy overview sent to client: ${liveCustomer.name} (${fmt.policyRef(livePolicy)}).`,
        visibility: "internal",
        customerId: liveCustomer.id,
        assetId: livePolicy.assetId,
        policyId: livePolicy.id,
        communicationId: comm.id,
        createdById: liveUser.id,
      });
    }
    if (sendContext?.kind === "documents") {
      const sentDocuments = sendContext.documentIds
        .map((id) => api.documents.get(id))
        .filter((document): document is Document => !!document);
      sentDocuments.forEach((document) => {
        api.documents.update(document.id, {
          visibility: "customer_visible",
          status: "approved",
        });
        api.status.create({
          tenantId: livePolicy.tenantId,
          source: "agent",
          message: `Document sent to client: ${document.fileName}.`,
          visibility: "customer_visible",
          customerId: customer.id,
          assetId: document.assetId ?? livePolicy.assetId,
          policyId: livePolicy.id,
          documentId: document.id,
          communicationId: comm.id,
          createdById: user.id,
        });
      });
      setRev((r) => r + 1);
      setSelectedDocumentIds([]);
    }
    setSentAt(new Date().toISOString());
  }

  function sendToSelectedHolders() {
    if (
      !user ||
      (sendContext?.kind !== "holders" && sendContext?.kind !== "holder_description")
    ) {
      return;
    }
    const selectedDocuments =
      sendContext.kind === "holders"
        ? sendContext.documentIds
            .map((id) => api.documents.get(id))
            .filter((document): document is Document => !!document)
        : [];
    const recipients = sendablePolicyHolders.filter((holder) => selectedHolderIds.includes(holder.id));
    if (sendContext.kind === "holders" && selectedDocuments.length === 0) return;
    if (recipients.length === 0) return;
    const attachments = [...documentEmailAttachments(selectedDocuments), ...sendExtraAttachments];
    recipients.forEach((holder) => {
      api.communications.create({
        tenantId: livePolicy.tenantId,
        externalRecipientName: holder.name,
        externalRecipientEmail: holder.email,
        externalRecipientRole: holderLabel(holder),
        channel: "email",
        direction: "outbound",
        subject:
          sendSubject.trim() ||
          (sendContext.kind === "holders"
            ? `Policy documents - ${fmt.policyRef(livePolicy)}`
            : `Policy overview - ${fmt.policyRef(livePolicy)}`),
        body: sendBody,
        attachments: attachments.length > 0 ? attachments : undefined,
        createdById: liveUser.id,
      });
    });
    api.status.create({
      tenantId: livePolicy.tenantId,
      source: "agent",
      message:
        sendContext.kind === "holders"
          ? `Sent ${selectedDocuments.length} policy document${
              selectedDocuments.length === 1 ? "" : "s"
            } to ${recipients.length} holder${recipients.length === 1 ? "" : "s"}: ${recipients
              .map((holder) => holder.name)
              .join(", ")}.`
          : `Sent policy overview to ${recipients.length} holder${
              recipients.length === 1 ? "" : "s"
            }: ${recipients.map((holder) => holder.name).join(", ")}.`,
      visibility: "internal",
      customerId: liveCustomer.id,
      assetId: livePolicy.assetId,
      policyId: livePolicy.id,
      createdById: liveUser.id,
    });
    setSentAt(new Date().toISOString());
    setSelectedDocumentIds([]);
  }

  function handleCarrierView() {
    if (carrier?.agentPortalUrl) {
      window.open(carrier.agentPortalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    showIntegrationNotice({
      feature: "View policy on carrier site",
      title: `${carrier?.name ?? "Carrier"} agent portal not configured`,
      body: `In production, this opens ${
        carrier?.name ?? "the carrier"
      }'s agent sign-in for ${fmt.policyRef(
        livePolicy
      )} so you can view and service the policy directly in the carrier's system. Configure the carrier's agent portal URL under Master → Carriers to enable this link.`,
    });
  }

  function handleClosePolicy() {
    api.policies.close(livePolicy.id, liveUser.id);
    setRev((r) => r + 1);
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        onClick={() => navigate(-1)}
        icon={<ArrowLeft className="h-4 w-4" />}
        className="-ml-2"
      >
        Back
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl">{asset?.label ?? "Policy"}</h1>
          <p className="text-ink-500 text-sm mt-1">
            {carrier?.name ?? "—"} ·{" "}
            <span className="font-mono">{fmt.policyRef(policy)}</span>
          </p>
        </div>
        <div className="flex max-w-3xl flex-wrap items-center justify-end gap-2">
          <div className="contents">
            <span className="inline-flex min-h-7 items-center rounded-md border border-ink-200 bg-ink-50 px-2.5 py-1 text-[11px] font-medium text-ink-700">
            {api.helpers.departmentLabel(policy)}
          </span>
          <PolicyStatusBadge status={policy.status} />
          <RenewalStatusBadge status={policy.renewalStatus} />
          </div>
          <div className="contents">
          <Button
            size="xs"
            to={`/employee/clients/${customer.id}`}
            icon={<User className="h-3.5 w-3.5" />}
            title={`Open ${customer.name}'s client profile`}
          >
            {customer.name}
          </Button>
          <Button
            size="xs"
            variant="primary"
            onClick={() => setEditOpen(true)}
            icon={<Pencil className="h-3.5 w-3.5" />}
          >
            Edit
          </Button>
          <Button
            size="xs"
            onClick={handleDownload}
            icon={<Download className="h-3.5 w-3.5" />}
          >
            Download
          </Button>
          <Button
            size="xs"
            onClick={handleCarrierView}
            icon={<ExternalLink className="h-3.5 w-3.5" />}
          >
            View on carrier
          </Button>
          {livePolicy.status !== "closed" && (
            <Button
              size="xs"
              variant="outline"
              onClick={handleClosePolicy}
              icon={<Archive className="h-3.5 w-3.5" />}
            >
              Close Policy
            </Button>
          )}
          </div>
        </div>
      </div>

      <AddPolicyModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        policy={livePolicy}
        onCreated={() => setRev((r) => r + 1)}
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-ink-900">Policy overview</h3>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                size="xs"
                onClick={openSendOverviewToHolders}
                icon={<Send className="h-3.5 w-3.5" />}
                title="Email this policy overview to selected policy holders"
              >
                Send to holders
              </Button>
              {customer.email ? (
                <Button
                  size="xs"
                  onClick={openSendToClient}
                  icon={<Send className="h-3.5 w-3.5" />}
                  title={`Email this description to ${customer.name}`}
                >
                  Send to client
                </Button>
              ) : null
              }
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-md border border-ink-100 bg-ink-50/40 p-4">
          <dl className="text-sm space-y-2">
            <Row label="Client" value={customer?.name ?? "—"} />
            <Row label="Carrier" value={carrier?.name ?? "—"} />
            <Row label="Asset" value={asset?.label ?? "—"} />
            <Row
              label="Policy number"
              value={<span className="font-mono">{fmt.policyRef(policy)}</span>}
            />
            <Row label="Effective date" value={fmt.date(policy.effectiveDate)} />
            <Row label="Renewal date" value={fmt.date(policy.renewalDate)} />
            <Row
              label="Premium estimate"
              value={policy.premiumEstimate ? fmt.money(policy.premiumEstimate) : "—"}
            />
            <Row
              label="Final premium"
              value={policy.finalPremium ? fmt.money(policy.finalPremium) : "—"}
            />
          </dl>
          {false && (
            <p className="text-[11px] text-emerald-700 mt-2">
              Renewed {renewedCount} document{renewedCount === 1 ? "" : "s"} from current coverage —
              see the Documents card below.
            </p>
          )}
          {!carrier?.agentPortalUrl && (
            <p className="text-[11px] text-ink-400 mt-2">
              No agent portal URL configured for {carrier?.name ?? "this carrier"}. Set
              one under Master → Carriers to enable the deep-link.
            </p>
          )}
          </div>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-ink-700">{desc.summary}</p>
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                <ShieldCheck className="h-3.5 w-3.5 text-gold-600" /> What's covered
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {desc.coverages.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
            {desc.note && <p className="text-[11px] text-ink-400">{desc.note}</p>}
          </div>
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-ink-900">Documents</h3>
            {documents.length > 0 ? (
              <div className="flex flex-nowrap items-center justify-end gap-2">
                {documentSendSelecting || holderDocumentSendSelecting ? (
                  <>
                    <Button variant="outline" size="xs" onClick={cancelDocumentSendSelection}>
                      Cancel
                    </Button>
                    {holderDocumentSendSelecting ? (
                      <Button
                        variant="gold"
                        size="xs"
                        onClick={sendSelectedDocumentsToHolders}
                        disabled={selectedDocumentIds.length === 0}
                      >
                        Select recipients{selectedDocumentIds.length > 0 ? ` (${selectedDocumentIds.length})` : ""}
                      </Button>
                    ) : (
                      <Button
                        variant="gold"
                        size="xs"
                        onClick={sendSelectedDocuments}
                        disabled={selectedDocumentIds.length === 0}
                      >
                        Send selected{selectedDocumentIds.length > 0 ? ` (${selectedDocumentIds.length})` : ""}
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="xs"
                      icon={<Send className="h-3.5 w-3.5" />}
                      onClick={startHolderDocumentSendSelection}
                      title={
                        sendablePolicyHolders.length === 0
                          ? "Choose documents and add holder emails before sending."
                          : "Choose documents and holders before sending."
                      }
                    >
                      Send to holders
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      icon={<Send className="h-3.5 w-3.5" />}
                      onClick={startDocumentSendSelection}
                    >
                      Send to client
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {documents.length === 0 ? (
            <div className="text-sm text-ink-400">No documents on file.</div>
          ) : (
            <DocumentList
              documents={documents}
              uploadedById={user.id}
              onChanged={() => setRev((r) => r + 1)}
              selectionMode={documentSendSelecting || holderDocumentSendSelecting}
              selectedDocumentIds={selectedDocumentIds}
              onSelectionChange={setSelectedDocumentIds}
              collapsePreviousTerms
            />
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Policy holders and policy contacts"
            subtitle="Add, search, and delete named insureds, additional insureds, lienholders, mortgagees, certificate holders, and other document recipients."
            action={
              <Button
                size="xs"
                variant="gold"
                icon={<UserPlus className="h-3.5 w-3.5" />}
                onClick={openAddHolder}
              >
                Add contact
              </Button>
            }
          />
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[18rem] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  className="input min-h-10 pl-9"
                  value={holderSearch}
                  onChange={(event) => setHolderSearch(event.target.value)}
                  placeholder="Search contacts by name, email, role, phone, or address..."
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {HOLDER_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setHolderFilter(filter.id)}
                  className={`btn-outline text-sm ${
                    holderFilter === filter.id ? "!border-ink-900 !bg-ink-900 !text-white" : ""
                  }`}
                >
                  {filter.label}
                </button>
              ))}
              <AiCustomFilterChip
                value={holderAiFilter}
                onChange={setHolderAiFilter}
                placeholder="ex: mortgagees, missing email, Marcus, certificate holders"
                label="AI sort"
                size="md"
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-ink-100">
              <div className="grid grid-cols-[minmax(10rem,1.1fr)_9rem_minmax(12rem,1fr)_7rem_7rem_6.5rem] gap-4 border-b border-ink-100 bg-ink-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
                <div>Name</div>
                <div>Role</div>
                <div>Contact</div>
                <div>Delivery</div>
                <div>Status</div>
                <div className="text-right">Actions</div>
              </div>
              <div className="divide-y divide-ink-100">
                {filteredPolicyHolders.length > 0 ? (
                  filteredPolicyHolders.map((holder) => (
                    <div
                      key={holder.id}
                      className="grid min-h-[5.25rem] grid-cols-[minmax(10rem,1.1fr)_9rem_minmax(12rem,1fr)_7rem_7rem_6.5rem] items-center gap-4 px-4 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink-900">{holder.name}</div>
                        <div className="mt-0.5 truncate text-xs text-ink-500">
                          {holder.relationship || holderLabel(holder)}
                        </div>
                      </div>
                      <div className="text-ink-700">{holderLabel(holder)}</div>
                      <div className="min-w-0 text-xs text-ink-500">
                        <div className="truncate font-medium text-ink-800">{holder.email || "No email on file"}</div>
                        {holder.phone && <div className="truncate">{holder.phone}</div>}
                        {holder.address && (
                          <MapLink
                            address={holder.address}
                            className="mt-0.5 max-w-full text-xs"
                          />
                        )}
                      </div>
                      <div className="capitalize text-ink-700">{holder.deliveryPreference ?? "email"}</div>
                      <div>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            holder.email ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {holder.email ? "Ready" : "Needs email"}
                        </span>
                      </div>
                      <div className="text-right">
                        {holder.source === "policy" ? (
                          <Button
                            size="xs"
                            variant="outline"
                            tone="danger"
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={() => deletePolicyHolder(holder)}
                          >
                            Delete
                          </Button>
                        ) : (
                          <span className="text-xs font-medium text-ink-400">Primary</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-ink-400">
                    No policy contacts match this search or filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title={participantCopy.title}
            subtitle={participantCopy.subtitle}
            action={
              <Button
                size="xs"
                variant="gold"
                icon={<UserPlus className="h-3.5 w-3.5" />}
                onClick={openAddParticipant}
              >
                {participantCopy.buttonLabel}
              </Button>
            }
          />
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[18rem] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  className="input min-h-10 pl-9"
                  value={participantSearch}
                  onChange={(event) => setParticipantSearch(event.target.value)}
                  placeholder="Search participants by name, role, license, phone, or notes..."
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {PARTICIPANT_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setParticipantFilter(filter.id)}
                  className={`btn-outline text-sm ${
                    participantFilter === filter.id ? "!border-ink-900 !bg-ink-900 !text-white" : ""
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="overflow-hidden rounded-lg border border-ink-100">
              <div className="grid grid-cols-[minmax(10rem,1.1fr)_9rem_minmax(14rem,1fr)_7rem_6.5rem] gap-4 border-b border-ink-100 bg-ink-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
                <div>Name</div>
                <div>Role</div>
                <div>Details</div>
                <div>Status</div>
                <div className="text-right">Actions</div>
              </div>
              <div className="divide-y divide-ink-100">
                {filteredPolicyParticipants.length > 0 ? (
                  filteredPolicyParticipants.map((participant) => (
                    <div
                      key={`${participant.source}:${participant.id}`}
                      className="grid min-h-[5.25rem] grid-cols-[minmax(10rem,1.1fr)_9rem_minmax(14rem,1fr)_7rem_6.5rem] items-center gap-4 px-4 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink-900">{participant.name}</div>
                        <div className="mt-0.5 truncate text-xs text-ink-500">
                          {participant.relationship || participantTypeLabel(participant.participantType)}
                        </div>
                      </div>
                      <div className="text-ink-700">{participantTypeLabel(participant.participantType)}</div>
                      <div className="min-w-0 text-xs text-ink-500">
                        {participant.licenseNumber || participant.licenseState ? (
                          <div className="truncate font-medium text-ink-800">
                            License: {[participant.licenseState, participant.licenseNumber].filter(Boolean).join(" ")}
                          </div>
                        ) : (
                          <div className="truncate font-medium text-ink-800">
                            {participant.email || participant.phone || "No contact details required"}
                          </div>
                        )}
                        {participant.phone && <div className="truncate">{participant.phone}</div>}
                        {participant.dateOfBirth && <div className="truncate">DOB: {fmt.date(participant.dateOfBirth)}</div>}
                        {participant.notes && <div className="truncate">{participant.notes}</div>}
                      </div>
                      <div>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            participant.status === "excluded"
                              ? "bg-rose-50 text-rose-700"
                              : participant.status === "inactive"
                              ? "bg-ink-100 text-ink-500"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {participantStatusLabel(participant.status)}
                        </span>
                      </div>
                      <div className="text-right">
                        <Button
                          size="xs"
                          variant="outline"
                          tone="danger"
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={() => deletePolicyParticipant(participant)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-ink-400">
                    No policy participants match this search or filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Associated addresses" />
          {associatedAddresses.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {associatedAddresses.map((item) => (
                <div key={item.id} className="rounded-lg border border-ink-100 bg-ink-50/40 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                    {item.label}
                  </div>
                  <MapLink address={item.address} className="mt-1 max-w-full text-sm" />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-ink-200 bg-ink-50/60 px-3 py-4 text-center text-sm text-ink-400">
              No associated addresses on file.
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Policy remarks" />
          <Timeline events={events} />
        </Card>
      </div>

      {false && asset && (
        <Link
          to="#"
          className="text-sm text-gold-700 inline-flex"
        >
          View asset →
        </Link>
      )}

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title={
          sendContext?.kind === "holders"
            ? "Send documents to holders"
            : sendContext?.kind === "holder_description"
            ? "Send policy overview to holders"
            : sendContext?.kind === "documents"
            ? "Send documents to client"
            : "Send policy description to client"
        }
        size="lg"
      >
        <div className="space-y-4">
          <div className="rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2 text-[11px] text-ink-600 flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-gold-600" />
            <div className="min-w-0">
              {holderSendContext && (
                <div>
                  Sending to selected policy holders. Auto-appends your saved email signature.
                  <div className="mt-0.5 text-ink-500">
                    {sendContext?.kind === "holders"
                      ? "Holder document sends are recorded internally on the policy timeline and do not post as a client-visible message."
                      : "Holder overview sends are recorded internally on the policy timeline and do not post as a client-visible message."}
                  </div>
                </div>
              )}
              {!holderSendContext && (
                <>
              Sending to{" "}
              <span className="font-medium text-ink-900">{customer.name}</span>{" "}
              <span className="text-ink-500">&lt;{customer.email}&gt;</span> · auto-appends your saved email signature.
              {sendContext?.kind === "documents" && sendingDocuments.length > 0 && (
                <div className="mt-0.5 text-ink-500">
                  Sending {sendingDocuments.length} selected document{sendingDocuments.length === 1 ? "" : "s"} also makes them customer-visible.
                </div>
              )}
                </>
              )}
            </div>
          </div>
          {holderSendContext && (
            <div className="rounded-md border border-ink-100 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Holder recipients
                </div>
                <div className="text-[11px] text-ink-400">
                  {sendingHolderRecipients.length} selected
                </div>
              </div>
              {sendablePolicyHolders.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {sendablePolicyHolders.map((holder) => {
                    const checked = selectedHolderIds.includes(holder.id);
                    return (
                      <label
                        key={holder.id}
                        className={`flex min-h-16 cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                          checked ? "border-gold-300 bg-gold-50" : "border-ink-100 bg-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-gold-600"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedHolderIds((current) =>
                              event.target.checked
                                ? Array.from(new Set([...current, holder.id]))
                                : current.filter((id) => id !== holder.id)
                            );
                            setSentAt(null);
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink-900">{holder.name}</span>
                          <span className="block truncate text-xs text-ink-500">
                            {holderLabel(holder)} - {holder.email}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span>Add a policy holder with an email address before sending to holders.</span>
                  <Button
                    size="xs"
                    variant="gold"
                    icon={<UserPlus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setSendOpen(false);
                      openAddHolder();
                    }}
                  >
                    Add holder
                  </Button>
                </div>
              )}
            </div>
          )}
          {(sendContext?.kind === "documents" || sendContext?.kind === "holders") && sendingDocuments.length > 0 && (
            <div className="rounded-md border border-ink-100 bg-white p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                PDF attachments
              </div>
              <ul className="space-y-1.5">
                {documentEmailAttachments(sendingDocuments).map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center justify-between gap-3 rounded-md bg-ink-50 px-2.5 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate font-medium text-ink-800">
                      {attachment.fileName}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                      PDF
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-md border border-ink-100 bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Additional files
              </div>
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={() => sendFileInputRef.current?.click()}
                disabled={sendAttaching || !!sentAt}
                title="Attach a file from your computer"
                aria-label="Attach a file"
              >
                {sendAttaching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                <Paperclip className="h-3.5 w-3.5" />
                Attach file
              </button>
              <input
                ref={sendFileInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={(event) => void handleSendAttachmentFiles(event.target.files)}
              />
            </div>
            {sendExtraAttachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {sendExtraAttachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-ink-50 px-2 py-1 text-[11px] text-ink-700"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 text-ink-400" />
                    <span className="max-w-[16rem] truncate">{attachment.fileName}</span>
                    {attachment.sizeBytes ? (
                      <span className="shrink-0 text-ink-400">{formatAttachmentSize(attachment.sizeBytes)}</span>
                    ) : null}
                    <button
                      type="button"
                      className="text-ink-400 hover:text-rose-600"
                      onClick={() => removeSendExtraAttachment(attachment.id)}
                      disabled={!!sentAt}
                      aria-label={`Remove ${attachment.fileName}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-ink-400">
                Add any supporting file from your computer to include with this email.
              </div>
            )}
          </div>
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              value={sendSubject}
              onChange={(e) => {
                setSendSubject(e.target.value);
                setSentAt(null);
              }}
              disabled={!!sentAt}
            />
          </div>
          <div>
            <label className="label">Message</label>
            <textarea
              className="input min-h-[280px] font-mono text-[13px]"
              value={sendBody}
              onChange={(e) => {
                setSendBody(e.target.value);
                setSentAt(null);
              }}
              disabled={!!sentAt}
            />
            <div className="text-[11px] text-ink-400 mt-1">
              Edit freely — what you see here is what gets sent. Your email signature is added below the body
              automatically when it goes out.
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
            <div className="text-[11px] text-ink-500">
              {sentAt
                ? `Sent ${fmt.relative(sentAt)} — recorded on the client timeline.`
                : sendContext?.kind === "holders"
                ? "Drafted from the selected documents. Sending records an internal policy timeline entry for holder delivery."
                : sendContext?.kind === "holder_description"
                ? "Drafted from the live policy overview. Sending records an internal policy timeline entry for holder delivery."
                : sendContext?.kind === "documents"
                ? "Drafted from the selected documents. Sending shares them to the client portal and records them on the timeline."
                : "Drafted from the live policy description. Edits stay in this modal until you send."}
            </div>
            <div className="flex items-center gap-2">
              {sentAt ? (
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={() => setSendOpen(false)}
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-outline text-sm"
                    onClick={() => setSendOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    onClick={sendToClient}
                    disabled={
                      !sendBody.trim() ||
                      !sendSubject.trim() ||
                      sendAttaching ||
                      (holderSendContext && selectedHolderIds.length === 0)
                    }
                  >
                    <Send className="h-3.5 w-3.5" />{" "}
                    {holderSendContext ? "Send to holders" : "Send email"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={holderModalOpen}
        onClose={() => setHolderModalOpen(false)}
        title="Add policy holder or contact"
        size="lg"
      >
        <div className="space-y-4">
          <div className="rounded-md border border-ink-100 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-ink-900">
                  Contacts on file for this client
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">
                  Quick-add a person or organization already saved on another policy for {liveCustomer.name}.
                </p>
              </div>
              <span className="rounded-full bg-ink-50 px-2.5 py-1 text-xs font-semibold text-ink-500">
                {clientHolderQuickAdds.length} available
              </span>
            </div>
            {clientHolderQuickAdds.length > 0 ? (
              <div className="mt-3 max-h-44 overflow-y-auto rounded-md border border-ink-100">
                <div className="divide-y divide-ink-100">
                  {clientHolderQuickAdds.map((holder) => (
                    <div
                      key={holder.id}
                      className="grid gap-3 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink-900">{holder.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                          <span>{holderLabel(holder)}</span>
                          <span className="text-ink-300">|</span>
                          <span>{holder.sourcePolicyLabel}</span>
                          {holder.email ? (
                            <>
                              <span className="text-ink-300">|</span>
                              <span className="truncate">{holder.email}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        icon={<UserPlus className="h-3.5 w-3.5" />}
                        onClick={() => quickAddClientHolder(holder)}
                      >
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-500">
                No reusable contacts are saved on this client&apos;s other policies yet.
              </div>
            )}
          </div>

          <div className="rounded-md border border-gold-100 bg-gold-50/50 p-3">
            <div className="mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <Sparkles className="h-4 w-4 text-gold-700" />
                AI autofill
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                Choose, drop, or paste holder evidence. AI fills the fields below, and you confirm before adding.
              </p>
            </div>
            <FileDropZone
              title="Choose, drop, or paste a file"
              help="Use a lender letter, certificate request, email screenshot, or copied image."
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
              busy={holderAiBusy}
              busyLabel="Extracting holder details..."
              icon="ai"
              compact
              onFiles={handleHolderFiles}
            />
            <div className="mt-3">
              <label className="label">Or paste holder details</label>
              <textarea
                className="input min-h-24"
                value={holderAiText}
                onChange={(event) => setHolderAiText(event.target.value)}
                placeholder="Example: Add Porsche Financial Services as lienholder. Email insurance@porschefinancial.example, phone 555-801-9110, address PO Box 9110 Atlanta GA. Send renewal docs and ID cards by email."
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-h-5 text-xs text-ink-500">
                {holderAiSummary ||
                  (holderAiFileName ? `Ready to review ${holderAiFileName}.` : "AI-filled values stay editable.")}
              </div>
              <Button
                size="sm"
                variant="gold"
                icon={<Wand2 className="h-3.5 w-3.5" />}
                onClick={applyAiHolderAutofill}
                disabled={!holderAiText.trim()}
              >
                Autofill fields
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Holder name</span>
              <input
                className="input"
                value={holderForm.name}
                onChange={(event) => setHolderForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Bank, spouse, certificate holder..."
              />
            </label>
            <label className="block">
              <span className="label">Role</span>
              <select
                className="input"
                value={holderForm.holderType}
                onChange={(event) => {
                  const holderType = event.target.value as HolderForm["holderType"];
                  setHolderForm((current) => ({
                    ...current,
                    holderType,
                    relationship: holderType === "other" ? "" : holderTypeLabel(holderType),
                  }));
                }}
              >
                {HOLDER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">{holderForm.holderType === "other" ? "Custom role *" : "Relationship / label"}</span>
              <input
                className="input"
                value={holderForm.relationship}
                onChange={(event) => setHolderForm((current) => ({ ...current, relationship: event.target.value }))}
                placeholder={
                  holderForm.holderType === "other"
                    ? "Trustee, property manager, executor..."
                    : "Mortgagee, additional insured, certificate holder..."
                }
              />
              {holderForm.holderType === "other" && (
                <span className="mt-1 block text-[11px] text-ink-500">
                  This custom role is what appears in holder lists, emails, and document recipient records.
                </span>
              )}
            </label>
            <label className="block">
              <span className="label">Email</span>
              <input
                className="input"
                type="email"
                value={holderForm.email}
                onChange={(event) => setHolderForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="recipient@example.com"
              />
            </label>
            <label className="block">
              <span className="label">Phone</span>
              <input
                className="input"
                value={holderForm.phone}
                onChange={(event) => setHolderForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="+1 (555) 000-0000"
              />
            </label>
            <label className="block">
              <span className="label">Delivery</span>
              <select
                className="input"
                value={holderForm.deliveryPreference}
                onChange={(event) =>
                  setHolderForm((current) => ({
                    ...current,
                    deliveryPreference: event.target.value as HolderForm["deliveryPreference"],
                  }))
                }
              >
                <option value="email">Email</option>
                <option value="mail">Mail</option>
                <option value="portal">Portal</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">Address</span>
            <input
              className="input"
              value={holderForm.address}
              onChange={(event) => setHolderForm((current) => ({ ...current, address: event.target.value }))}
              placeholder="Mailing address or evidence holder address"
            />
          </label>
          <label className="block">
            <span className="label">Notes</span>
            <textarea
              className="input min-h-20"
              value={holderForm.notes}
              onChange={(event) => setHolderForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Which documents they should receive, renewal preferences, wording requirements..."
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-4">
            <Button size="sm" variant="outline" onClick={() => setHolderModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="gold"
              icon={<UserPlus className="h-3.5 w-3.5" />}
              onClick={addPolicyHolder}
              disabled={
                !holderForm.name.trim() ||
                (holderForm.holderType === "other" && !holderForm.relationship.trim())
              }
            >
              Add contact
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={participantModalOpen}
        onClose={() => setParticipantModalOpen(false)}
        title="Add policy participant"
        size="lg"
      >
        <div className="space-y-4">
          <div className="rounded-md border border-ink-100 bg-ink-50/50 px-3 py-2 text-sm text-ink-600">
            Participants affect underwriting, rating, eligibility, or scheduled risk details. They are not document
            recipients unless you also add them under Policy holders and policy contacts.
          </div>
          <div className="rounded-md border border-ink-100 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-ink-900">
                  Contacts on file for this client
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">
                  Quick-add a client, holder, contact, driver, or household member already saved for {liveCustomer.name}.
                </p>
              </div>
              <span className="rounded-full bg-ink-50 px-2.5 py-1 text-xs font-semibold text-ink-500">
                {clientParticipantQuickAdds.length} available
              </span>
            </div>
            {clientParticipantQuickAdds.length > 0 ? (
              <div className="mt-3 max-h-44 overflow-y-auto rounded-md border border-ink-100">
                <div className="divide-y divide-ink-100">
                  {clientParticipantQuickAdds.map((contact) => (
                    <div
                      key={contact.id}
                      className="grid gap-3 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink-900">{contact.name}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                          <span>{contact.relationship || participantTypeLabel(contact.participantType)}</span>
                          <span className="text-ink-300">|</span>
                          <span>{contact.sourceLabel}</span>
                          {contact.email ? (
                            <>
                              <span className="text-ink-300">|</span>
                              <span className="truncate">{contact.email}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        icon={<UserPlus className="h-3.5 w-3.5" />}
                        onClick={() => quickAddClientParticipant(contact)}
                      >
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-500">
                No reusable contacts, drivers, or participants are saved for this client yet.
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Name</span>
              <input
                className="input"
                value={participantForm.name}
                onChange={(event) => setParticipantForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Driver, operator, occupant..."
              />
            </label>
            <label className="block">
              <span className="label">Role</span>
              <select
                className="input"
                value={participantForm.participantType}
                onChange={(event) => {
                  const participantType = event.target.value as ParticipantForm["participantType"];
                  setParticipantForm((current) => ({
                    ...current,
                    participantType,
                    relationship:
                      current.relationship && current.relationship !== participantTypeLabel(current.participantType)
                        ? current.relationship
                        : participantTypeLabel(participantType),
                  }));
                }}
              >
                {PARTICIPANT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Relationship / label</span>
              <input
                className="input"
                value={participantForm.relationship}
                onChange={(event) =>
                  setParticipantForm((current) => ({ ...current, relationship: event.target.value }))
                }
                placeholder="Primary driver, household member, captain..."
              />
            </label>
            <label className="block">
              <span className="label">Status</span>
              <select
                className="input"
                value={participantForm.status}
                onChange={(event) =>
                  setParticipantForm((current) => ({
                    ...current,
                    status: event.target.value as ParticipantForm["status"],
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="primary">Primary</option>
                <option value="occasional">Occasional</option>
                <option value="excluded">Excluded</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Date of birth</span>
              <input
                className="input"
                type="date"
                value={participantForm.dateOfBirth}
                onChange={(event) =>
                  setParticipantForm((current) => ({ ...current, dateOfBirth: event.target.value }))
                }
              />
            </label>
            <label className="block">
              <span className="label">Phone</span>
              <input
                className="input"
                value={participantForm.phone}
                onChange={(event) => setParticipantForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="+1 (555) 000-0000"
              />
            </label>
            <label className="block">
              <span className="label">License state</span>
              <input
                className="input"
                value={participantForm.licenseState}
                onChange={(event) =>
                  setParticipantForm((current) => ({ ...current, licenseState: event.target.value.toUpperCase() }))
                }
                placeholder="FL"
                maxLength={2}
              />
            </label>
            <label className="block">
              <span className="label">License number</span>
              <input
                className="input"
                value={participantForm.licenseNumber}
                onChange={(event) =>
                  setParticipantForm((current) => ({ ...current, licenseNumber: event.target.value }))
                }
                placeholder="Optional"
              />
            </label>
          </div>
          <label className="block">
            <span className="label">Email</span>
            <input
              className="input"
              type="email"
              value={participantForm.email}
              onChange={(event) => setParticipantForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="Optional"
            />
          </label>
          <label className="block">
            <span className="label">Notes</span>
            <textarea
              className="input min-h-24"
              value={participantForm.notes}
              onChange={(event) => setParticipantForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Usage, underwriting notes, restrictions, MVR comments, occupancy notes..."
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-4">
            <Button size="sm" variant="outline" onClick={() => setParticipantModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="gold"
              icon={<UserPlus className="h-3.5 w-3.5" />}
              onClick={addPolicyParticipant}
              disabled={!participantForm.name.trim()}
            >
              Add participant
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function emptyHolderForm(): HolderForm {
  return {
    name: "",
    holderType: "additional_insured",
    relationship: holderTypeLabel("additional_insured"),
    email: "",
    phone: "",
    address: "",
    deliveryPreference: "email",
    notes: "",
  };
}

function emptyParticipantForm(
  participantType: PolicyParticipant["participantType"] = "driver"
): ParticipantForm {
  return {
    name: "",
    participantType,
    relationship: participantTypeLabel(participantType),
    status: participantType === "excluded_driver" ? "excluded" : "active",
    email: "",
    phone: "",
    dateOfBirth: "",
    licenseState: "",
    licenseNumber: "",
    notes: "",
  };
}

function holderFormToPolicyParty(form: HolderForm): PolicyParty {
  return {
    name: form.name.trim(),
    holderType: form.holderType,
    relationship: form.relationship.trim() || holderTypeLabel(form.holderType),
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    address: form.address.trim() || undefined,
    deliveryPreference: form.deliveryPreference,
    notes: form.notes.trim() || undefined,
  };
}

function participantFormToPolicyParticipant(
  form: ParticipantForm,
  assignedAssetId?: string
): PolicyParticipant {
  return {
    id: createLocalId("participant"),
    participantType: form.participantType,
    name: form.name.trim(),
    relationship: form.relationship.trim() || participantTypeLabel(form.participantType),
    status: form.status,
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    dateOfBirth: form.dateOfBirth || undefined,
    licenseState: form.licenseState.trim().toUpperCase() || undefined,
    licenseNumber: form.licenseNumber.trim() || undefined,
    assignedAssetId,
    notes: form.notes.trim() || undefined,
  };
}

function buildPolicyHolders(
  policy: Policy,
  customer: { name: string; email?: string; phone?: string }
): PolicyHolderRow[] {
  const primary: PolicyHolderRow = {
    id: "customer:primary",
    source: "customer",
    name: customer.name,
    relationship: "Primary named insured",
    holderType: "named_insured",
    email: customer.email,
    phone: customer.phone,
    deliveryPreference: "portal",
  };
  const policyRows: PolicyHolderRow[] = (policy.additionalInsureds ?? [])
    .map((holder, index) => ({ holder, index }))
    .filter(({ holder }) => !isLegacyPolicyParticipant(holder))
    .map(({ holder, index }) => ({
      ...holder,
      id: `policy:${index}`,
      source: "policy",
      holderType: holder.holderType ?? inferHolderType(`${holder.relationship ?? ""} ${holder.name}`),
      deliveryPreference: holder.deliveryPreference ?? "email",
    }));
  const beneficiaryRows: PolicyHolderRow[] = (policy.beneficiaries ?? []).map((holder, index) => ({
    ...holder,
    id: `beneficiary:${index}`,
    source: "policy",
    holderType: holder.holderType ?? "beneficiary",
    deliveryPreference: holder.deliveryPreference ?? "email",
  }));
  return [primary, ...sortPolicyHoldersByImportance([...policyRows, ...beneficiaryRows])];
}

function buildPolicyParticipants(policy: Policy): PolicyParticipantRow[] {
  const directRows: PolicyParticipantRow[] = (policy.participants ?? []).map((participant, index) => ({
    ...participant,
    id: participant.id ?? `participant:${index}`,
    source: "policy",
    status: participant.status ?? participantStatusFromType(participant.participantType),
  }));
  const legacyRows: PolicyParticipantRow[] = (policy.additionalInsureds ?? [])
    .map((holder, index) => ({ holder, index }))
    .filter(({ holder }) => isLegacyPolicyParticipant(holder))
    .map(({ holder, index }) => ({
      id: `legacy-holder:${index}`,
      source: "legacy_holder",
      sourceIndex: index,
      participantType: inferParticipantType(`${holder.relationship ?? ""} ${holder.name}`),
      name: holder.name,
      relationship: holder.relationship || "Legacy participant",
      status: "active",
      email: holder.email,
      phone: holder.phone,
      notes: holder.notes ?? "Moved out of policy contacts because this is an underwriting participant.",
    }));
  const seen = new Set<string>();
  return [...directRows, ...legacyRows]
    .filter((participant) => {
      const key = `${participant.participantType}:${participant.name}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => participantImportanceRank(a) - participantImportanceRank(b) || a.name.localeCompare(b.name));
}

function buildClientHolderQuickAdds(
  customerPolicies: Policy[],
  currentPolicy: Policy
): ClientHolderQuickAdd[] {
  const currentKeys = new Set(
    [...(currentPolicy.additionalInsureds ?? []), ...(currentPolicy.beneficiaries ?? [])].map(
      policyPartyKey
    )
  );
  const seen = new Set<string>();
  const rows: ClientHolderQuickAdd[] = [];

  customerPolicies
    .filter((policy) => policy.id !== currentPolicy.id)
    .forEach((policy) => {
      const sourcePolicyLabel = `Policy ${fmt.policyRef(policy)}`;
      [...(policy.additionalInsureds ?? []), ...(policy.beneficiaries ?? [])].forEach(
        (holder, index) => {
          if (isLegacyPolicyParticipant(holder)) return;
          const normalized: ClientHolderQuickAdd = {
            ...holder,
            holderType: holder.holderType ?? inferHolderType(`${holder.relationship ?? ""} ${holder.name}`),
            relationship:
              holder.relationship ??
              holderTypeLabel(
                holder.holderType ?? inferHolderType(`${holder.relationship ?? ""} ${holder.name}`)
              ),
            deliveryPreference: holder.deliveryPreference ?? "email",
            id: `quick:${policy.id}:${index}:${policyPartyKey(holder)}`,
            sourcePolicyId: policy.id,
            sourcePolicyLabel,
          };
          const key = policyPartyKey(normalized);
          if (currentKeys.has(key) || seen.has(key)) return;
          seen.add(key);
          rows.push(normalized);
        }
      );
      (policy.participants ?? []).forEach((participant, index) => {
        const normalized: ClientHolderQuickAdd = {
          name: participant.name,
          relationship: participant.relationship || participantTypeLabel(participant.participantType),
          holderType: "other",
          email: participant.email,
          phone: participant.phone,
          deliveryPreference: "email",
          notes: participant.notes,
          id: `quick-participant:${policy.id}:${index}:${participant.name}`,
          sourcePolicyId: policy.id,
          sourcePolicyLabel,
        };
        const key = policyPartyKey(normalized);
        if (currentKeys.has(key) || seen.has(key)) return;
        seen.add(key);
        rows.push(normalized);
      });
    });

  return sortPolicyHoldersByImportance(rows);
}

function buildClientParticipantQuickAdds(
  customerPolicies: Policy[],
  currentPolicy: Policy,
  customer: { id: string; name: string; email?: string; phone?: string }
): ClientParticipantQuickAdd[] {
  const currentParticipantKeys = new Set(
    (currentPolicy.participants ?? []).map((participant) =>
      contactQuickAddKey({
        name: participant.name,
        email: participant.email,
        phone: participant.phone,
        relationship: participant.relationship,
      })
    )
  );
  const currentParticipantNames = new Set(
    (currentPolicy.participants ?? []).map((participant) => participant.name.trim().toLowerCase())
  );
  const rows: ClientParticipantQuickAdd[] = [];
  const seen = new Set<string>();

  function push(row: Omit<ClientParticipantQuickAdd, "id">) {
    const key = contactQuickAddKey(row);
    const nameKey = row.name.trim().toLowerCase();
    if (!nameKey || currentParticipantNames.has(nameKey) || currentParticipantKeys.has(key) || seen.has(key)) return;
    seen.add(key);
    rows.push({
      ...row,
      id: `participant-quick:${rows.length}:${key}`,
    });
  }

  push({
    name: customer.name,
    relationship: "Primary client",
    sourceLabel: "Client profile",
    email: customer.email,
    phone: customer.phone,
  });

  customerPolicies.forEach((policy) => {
    const sourceLabel = policy.id === currentPolicy.id ? "This policy" : `Policy ${fmt.policyRef(policy)}`;
    [...(policy.additionalInsureds ?? []), ...(policy.beneficiaries ?? [])].forEach((holder) => {
      push({
        name: holder.name,
        relationship: holder.relationship || holderTypeLabel(holder.holderType),
        sourceLabel,
        email: holder.email,
        phone: holder.phone,
        address: holder.address,
        participantType: isLegacyPolicyParticipant(holder)
          ? inferParticipantType(`${holder.relationship ?? ""} ${holder.name}`)
          : undefined,
        notes: holder.notes,
      });
    });
    (policy.participants ?? []).forEach((participant) => {
      push({
        name: participant.name,
        relationship: participant.relationship || participantTypeLabel(participant.participantType),
        sourceLabel,
        email: participant.email,
        phone: participant.phone,
        participantType: participant.participantType,
        status: participant.status,
        dateOfBirth: participant.dateOfBirth,
        licenseState: participant.licenseState,
        licenseNumber: participant.licenseNumber,
        notes: participant.notes,
      });
    });
  });

  return rows.sort((a, b) => {
    const aRank = a.participantType ? participantImportanceRank(a as Pick<PolicyParticipant, "participantType" | "status">) : 10;
    const bRank = b.participantType ? participantImportanceRank(b as Pick<PolicyParticipant, "participantType" | "status">) : 10;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name);
  });
}

function contactQuickAddKey(
  contact: Pick<ClientParticipantQuickAdd, "name" | "email" | "phone" | "relationship">
): string {
  return [contact.name, contact.email, contact.phone, contact.relationship]
    .map((value) => (value ?? "").trim().toLowerCase())
    .join("|");
}

function policyPartyKey(holder: PolicyParty): string {
  const holderType = holder.holderType ?? inferHolderType(`${holder.relationship ?? ""} ${holder.name}`);
  return [
    holder.name,
    holder.email,
    holder.phone,
    holder.address,
    holderType,
    holder.relationship || holderTypeLabel(holderType),
  ]
    .map((value) => (value ?? "").trim().toLowerCase())
    .join("|");
}

function sortPolicyHoldersByImportance<T extends Pick<PolicyParty, "holderType"> & { name: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const rank = holderImportanceRank(a) - holderImportanceRank(b);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}

function holderImportanceRank(holder: Pick<PolicyParty, "holderType">): number {
  const type = holder.holderType ?? "other";
  const index = HOLDER_TYPE_OPTIONS.findIndex((option) => option.value === type);
  return index === -1 ? HOLDER_TYPE_OPTIONS.length : index;
}

function filterPolicyHolders(
  rows: PolicyHolderRow[],
  search: string,
  filter: HolderFilter,
  aiFilter: string
): PolicyHolderRow[] {
  const searchTerm = search.trim().toLowerCase();
  const aiTerm = aiFilter.trim().toLowerCase();
  return rows.filter((holder) => {
    const haystack = holderSearchText(holder);
    if (searchTerm && !haystack.includes(searchTerm)) return false;
    if (filter === "missing_email" && holder.email?.trim()) return false;
    if (filter !== "all" && filter !== "missing_email" && holder.holderType !== filter) return false;
    if (aiTerm && !matchesHolderAiFilter(holder, aiTerm, haystack)) return false;
    return true;
  });
}

function holderSearchText(holder: PolicyHolderRow): string {
  return [
    holder.name,
    holder.relationship,
    holderTypeLabel(holder.holderType),
    holder.email,
    holder.phone,
    holder.address,
    holder.notes,
    holder.deliveryPreference,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesHolderAiFilter(holder: PolicyHolderRow, filter: string, haystack: string): boolean {
  return matchesAiCustomFilter(filter, {
    text: [haystack],
    flags: {
      missing: !holder.email?.trim(),
      missingEmail: !holder.email?.trim(),
      mortgagee: holder.holderType === "mortgagee",
      lienholder: holder.holderType === "lienholder",
      certificateHolder: holder.holderType === "certificate_holder",
      additionalInsured: holder.holderType === "additional_insured",
      namedInsured: holder.holderType === "named_insured",
      beneficiary: holder.holderType === "beneficiary",
      active: true,
    },
  });
}

function filterPolicyParticipants(
  rows: PolicyParticipantRow[],
  search: string,
  filter: ParticipantFilter
): PolicyParticipantRow[] {
  const searchTerm = search.trim().toLowerCase();
  return rows.filter((participant) => {
    const haystack = participantSearchText(participant);
    if (searchTerm && !haystack.includes(searchTerm)) return false;
    if (filter === "driver") return participant.participantType === "driver" || participant.participantType === "excluded_driver";
    if (filter === "operator") return participant.participantType === "operator" || participant.participantType === "captain";
    if (filter === "household") {
      return participant.participantType === "household_member" || participant.participantType === "occupant";
    }
    if (filter === "excluded") return participant.status === "excluded" || participant.participantType === "excluded_driver";
    if (filter === "other") return participant.participantType === "operations_contact" || participant.participantType === "other";
    return true;
  });
}

function participantSearchText(participant: PolicyParticipantRow): string {
  return [
    participant.name,
    participant.relationship,
    participantTypeLabel(participant.participantType),
    participantStatusLabel(participant.status),
    participant.email,
    participant.phone,
    participant.dateOfBirth,
    participant.licenseState,
    participant.licenseNumber,
    participant.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function participantTypeLabel(type?: PolicyParticipant["participantType"]): string {
  const map: Record<PolicyParticipant["participantType"], string> = {
    driver: "Driver",
    excluded_driver: "Excluded driver",
    operator: "Operator",
    household_member: "Household member",
    occupant: "Occupant",
    captain: "Captain",
    operations_contact: "Operations contact",
    other: "Custom",
  };
  return type ? map[type] : "Custom";
}

function participantStatusLabel(status?: PolicyParticipant["status"]): string {
  const map: Record<NonNullable<PolicyParticipant["status"]>, string> = {
    active: "Active",
    primary: "Primary",
    occasional: "Occasional",
    excluded: "Excluded",
    inactive: "Inactive",
  };
  return status ? map[status] : "Active";
}

function participantStatusFromType(type: PolicyParticipant["participantType"]): NonNullable<PolicyParticipant["status"]> {
  return type === "excluded_driver" ? "excluded" : "active";
}

function participantImportanceRank(participant: Pick<PolicyParticipant, "participantType" | "status">): number {
  if (participant.status === "primary") return 0;
  const ranks: Record<PolicyParticipant["participantType"], number> = {
    driver: 1,
    operator: 2,
    captain: 3,
    household_member: 4,
    occupant: 5,
    operations_contact: 6,
    excluded_driver: 7,
    other: 8,
  };
  return ranks[participant.participantType] ?? 9;
}

function isLegacyPolicyParticipant(holder: PolicyParty): boolean {
  const text = `${holder.holderType ?? ""} ${holder.relationship ?? ""} ${holder.notes ?? ""}`.toLowerCase();
  return holder.holderType === "listed_driver" || /\blisted driver\b|\bexcluded driver\b|\bdriver\b/.test(text);
}

function inferParticipantType(raw: string): PolicyParticipant["participantType"] {
  const text = raw.toLowerCase();
  if (/\bexcluded driver\b/.test(text)) return "excluded_driver";
  if (/\bdriver\b/.test(text)) return "driver";
  if (/\bcaptain\b/.test(text)) return "captain";
  if (/\boperator\b/.test(text)) return "operator";
  if (/\bhousehold\b/.test(text)) return "household_member";
  if (/\boccupant\b/.test(text)) return "occupant";
  if (/\boperations?\b|\bcontact\b/.test(text)) return "operations_contact";
  return "other";
}

function preferredParticipantType(
  policy: Policy,
  asset?: import("@/types").Asset
): PolicyParticipant["participantType"] {
  const text = `${asset?.type ?? ""} ${asset?.label ?? ""} ${policy.policyNumber ?? ""}`.toLowerCase();
  if (/\byacht|boat|marine|vessel\b/.test(text)) return "operator";
  if (/\bhome|property|estate|residence\b/.test(text)) return "household_member";
  if (policy.department === "commercial") return "operations_contact";
  return "driver";
}

function getParticipantCardCopy(
  policy: Policy,
  asset?: import("@/types").Asset
): { title: string; subtitle: string; buttonLabel: string } {
  const preferred = preferredParticipantType(policy, asset);
  if (preferred === "operator") {
    return {
      title: "Policy participants",
      subtitle:
        "Track operators, captains, and other underwriting participants. They are not document recipients unless added as contacts.",
      buttonLabel: "Add operator",
    };
  }
  if (preferred === "household_member") {
    return {
      title: "Policy participants",
      subtitle:
        "Track household members, occupants, and other underwriting participants. They are not policy holders unless added as contacts.",
      buttonLabel: "Add participant",
    };
  }
  if (preferred === "operations_contact") {
    return {
      title: "Policy participants",
      subtitle:
        "Track operations contacts, scheduled drivers, and other underwriting participants separate from legal holders.",
      buttonLabel: "Add participant",
    };
  }
  return {
    title: "Policy participants",
    subtitle:
      "Track drivers and other underwriting participants. They are not policy holders or document recipients unless added as contacts.",
    buttonLabel: "Add contact",
  };
}

function holderLabel(holder: Pick<PolicyParty, "holderType" | "relationship">): string {
  return holder.relationship?.trim() || holderTypeLabel(holder.holderType);
}

function holderTypeLabel(type?: PolicyParty["holderType"]): string {
  const map: Record<NonNullable<PolicyParty["holderType"]>, string> = {
    named_insured: "Named insured",
    additional_insured: "Additional insured",
    listed_driver: "Listed driver",
    lienholder: "Lienholder",
    mortgagee: "Mortgagee",
    certificate_holder: "Certificate holder",
    beneficiary: "Beneficiary",
    other: "Custom",
  };
  return type ? map[type] : "Custom";
}

function inferHolderType(raw: string): NonNullable<PolicyParty["holderType"]> {
  const text = raw.toLowerCase();
  if (/\bmortgage|mortgagee|escrow/.test(text)) return "mortgagee";
  if (/\blien|lease|leasing|finance|financial/.test(text)) return "lienholder";
  if (/\bcertificate|coi|evidence holder/.test(text)) return "certificate_holder";
  if (/\bbeneficiar/.test(text)) return "beneficiary";
  if (/\bnamed insured|primary insured/.test(text)) return "named_insured";
  if (/\badditional/.test(text)) return "additional_insured";
  return "other";
}

function parseHolderAiText(raw: string): Partial<HolderForm> {
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone = raw.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? "";
  const holderType = inferHolderType(raw);
  const name = extractHolderName(raw, holderType);
  const address =
    raw.match(/\baddress(?:\s+is|:)?\s*([^.\n]+)/i)?.[1]?.trim() ??
    raw.match(/\b(?:po box|p\.o\. box|[0-9]{2,6}\s+[A-Za-z0-9 .'-]+(?:street|st|avenue|ave|road|rd|way|drive|dr|lane|ln|blvd|boulevard)[^.\n]*)/i)?.[0]?.trim() ??
    "";
  return {
    name,
    holderType,
    relationship: holderTypeLabel(holderType),
    email,
    phone,
    address,
    deliveryPreference: raw.toLowerCase().includes("mail") && !email ? "mail" : "email",
    notes: raw.trim(),
  };
}

function extractHolderName(raw: string, holderType: NonNullable<PolicyParty["holderType"]>): string {
  const typeWords = HOLDER_TYPE_OPTIONS.map((option) => option.label.toLowerCase().replace(/\s+/g, "\\s+")).join("|");
  const addMatch = raw.match(new RegExp(`add\\s+(.+?)\\s+as\\s+(?:a\\s+|an\\s+|the\\s+)?(${typeWords})`, "i"));
  if (addMatch?.[1]) return cleanupHolderName(addMatch[1]);
  const roleMatch = raw.match(new RegExp(`^(.+?)\\s+(?:is|as)\\s+(?:a\\s+|an\\s+|the\\s+)?(${typeWords})`, "i"));
  if (roleMatch?.[1]) return cleanupHolderName(roleMatch[1]);
  const firstLine = raw
    .split(/[\n.]/)[0]
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "")
    .trim();
  const withoutLead = firstLine.replace(/^(add|holder|recipient|send to)\s+/i, "");
  const roleLabel = holderTypeLabel(holderType);
  return cleanupHolderName(withoutLead || roleLabel);
}

function cleanupHolderName(value: string): string {
  return value
    .replace(/\b(email|phone|address|send|documents?|policy|holder)\b.*$/i, "")
    .replace(/[,;:]+$/g, "")
    .trim();
}

function createLocalId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Synthesize a plain-language description of the policy + what's
// covered. Uses the policy's own coverage schedule when present;
// otherwise falls back to a sensible default coverage list for the
// asset type so the card always reads usefully.
function describePolicy(
  policy: Policy,
  asset?: Asset,
  carrier?: import("@/types").Carrier
): { summary: string; coverages: string[]; note?: string } {
  const line = api.helpers.departmentLabel(policy);
  const assetType = asset ? api.helpers.assetTypeLabel(asset.type) : "asset";
  const carrierName = carrier?.name ?? "the carrier";
  const premium = policy.finalPremium ?? policy.premiumEstimate;
  const freqLabel = policy.paymentFrequency
    ? ` Premiums are billed ${policy.paymentFrequency.replace(/_/g, "-")}.`
    : "";

  const summary =
    `This is a ${line} policy${
      asset ? ` covering ${asset.label} (${assetType})` : ""
    }, underwritten by ${carrierName}. ` +
    `It took effect ${fmt.date(policy.effectiveDate)} and renews ${fmt.date(
      policy.renewalDate
    )}.` +
    (premium ? ` The current premium is ${fmt.money(premium)}.` : "") +
    freqLabel;

  // Prefer the policy's own coverage schedule when it has one.
  if (policy.coverages && policy.coverages.length > 0) {
    const coverages = policy.coverages.map((c) => {
      const bits: string[] = [];
      if (c.limit) bits.push(`limit ${fmt.money(c.limit)}`);
      if (c.deductible) bits.push(`deductible ${fmt.money(c.deductible)}`);
      return bits.length ? `${c.name} — ${bits.join(", ")}` : c.name;
    });
    return { summary, coverages };
  }

  const defaults: Record<string, string[]> = {
    coastal_home: [
      "Dwelling & other structures",
      "Personal property",
      "Loss of use",
      "Personal liability",
      "Windstorm / hurricane",
    ],
    luxury_vehicle: [
      "Bodily injury & property damage liability",
      "Comprehensive",
      "Collision",
      "Uninsured / underinsured motorist",
      "Roadside assistance",
    ],
    yacht: [
      "Hull (physical damage)",
      "Protection & indemnity liability",
      "Personal effects",
      "Towing & assistance",
    ],
    jewelry: [
      "All-risk scheduled coverage",
      "Worldwide protection",
      "Mysterious disappearance",
      "Pairs & sets",
    ],
    umbrella_liability: [
      "Excess personal liability",
      "Excess auto liability",
      "Worldwide coverage",
      "Legal defense costs",
    ],
    full_portfolio: [
      "Bundled property",
      "Auto",
      "Umbrella liability",
      "Scheduled valuables",
    ],
    other: ["Core coverage per the policy schedule"],
  };
  const coverages = asset ? defaults[asset.type] ?? defaults.other : defaults.other;
  return {
    summary,
    coverages,
    note: "Coverage shown is a standard outline for this line — see the carrier's declarations page for exact limits and deductibles.",
  };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-ink-700">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900 text-right">{value}</dd>
    </div>
  );
}

function buildPolicySummary(input: {
  policy: Policy;
  customerName?: string;
  assetLabel?: string;
  carrierName?: string;
}): string[] {
  const { policy: p, customerName, assetLabel, carrierName } = input;
  return [
    `POLICY SUMMARY`,
    `=============`,
    ``,
    `Policy number  : ${fmt.policyRef(p)}`,
    `Client         : ${customerName ?? "—"}`,
    `Asset          : ${assetLabel ?? "—"}`,
    `Carrier        : ${carrierName ?? "—"}`,
    `Status         : ${p.status}`,
    `Renewal status : ${p.renewalStatus}`,
    `Effective date : ${fmt.date(p.effectiveDate)}`,
    `Renewal date   : ${fmt.date(p.renewalDate)}`,
    `Premium est.   : ${p.premiumEstimate ? fmt.money(p.premiumEstimate) : "—"}`,
    `Final premium  : ${p.finalPremium ? fmt.money(p.finalPremium) : "—"}`,
    ``,
    `Generated by Quotex. For an official carrier-issued PDF, open this policy`,
    `on the carrier's agent portal.`,
  ];
}

function buildPolicyOverviewClientMessage(input: {
  policy: Policy;
  customerName: string;
  assetLabel?: string;
  carrierName?: string;
  description: ReturnType<typeof describePolicy>;
}): string[] {
  const { policy, customerName, assetLabel, carrierName, description } = input;
  const firstName = customerName.split(/\s+/)[0] || customerName;
  const lines = [
    `Hi ${firstName},`,
    ``,
    `Here is the full policy overview we currently have on file for you.`,
    ``,
    `Policy overview:`,
    `Policy type: ${api.helpers.departmentLabel(policy)}`,
    `Client: ${customerName}`,
    `Carrier: ${carrierName ?? "Not listed"}`,
    `Asset: ${assetLabel ?? "Not listed"}`,
    `Policy number: ${fmt.policyRef(policy)}`,
    `Status: ${fmt.titleCase(policy.status)}`,
    `Renewal status: ${fmt.titleCase(policy.renewalStatus)}`,
    `Effective date: ${fmt.date(policy.effectiveDate)}`,
    `Renewal date: ${fmt.date(policy.renewalDate)}`,
    `Premium estimate: ${policy.premiumEstimate ? fmt.money(policy.premiumEstimate) : "Not listed"}`,
    `Final premium: ${policy.finalPremium ? fmt.money(policy.finalPremium) : "Not listed"}`,
    ``,
    `Policy description:`,
    description.summary,
    ``,
    `What's covered:`,
    ...description.coverages.map((coverage) => `- ${coverage}`),
  ];
  if (description.note) lines.push("", description.note);
  lines.push(
    "",
    `If anything looks off or you'd like to update limits, add or remove a covered asset, or review options at renewal, just reply to this email and I'll get on it right away.`,
    ``,
    `Thank you for trusting us with your coverage. Please do not hesitate to reach out with any questions.`
  );
  return lines;
}
