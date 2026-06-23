import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Archive, ArrowLeft, Building2, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Download, Eye, FileText, KeyRound, LifeBuoy, Loader2, Lock, Mail, Megaphone, MessageSquare, Pencil, Plus, Search, Send, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { AddPolicyModal } from "@/components/policies/AddPolicyModal";
import { PolicyActions } from "@/components/policies/PolicyActions";
import { ClientBillingCard } from "@/components/billing/ClientBillingCard";
import { ContactMessageThread } from "@/components/messages/ContactMessageThread";
import { ClientQuotingCard } from "@/components/quoting/ClientQuotingCard";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ImportanceIcon } from "@/components/tasks/ImportancePicker";
import { CreateActivityModal } from "@/components/tasks/CreateActivityModal";
import { ContactRouteButton } from "@/components/routing/ContactRouteButton";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import { DocumentList } from "@/components/ui/DocumentList";
import { DocumentUploader } from "@/components/ui/DocumentUploader";
import { DocumentTemplateFieldsEditor } from "@/components/ui/DocumentTemplateFields";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { MapLink } from "@/components/ui/MapLink";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { useIntegrationNotice } from "@/lib/integrationNotice";
import { api } from "@/lib/api";
import { aiExtractPolicyFromFile } from "@/lib/ai";
import { isRoutingManagerRole } from "@/lib/roles";
import { buildDocumentTemplateFields, documentTypeLabelForTemplate } from "@/lib/documentTemplateFields";
import { fmt } from "@/lib/format";
import { subscribeToDbChanges } from "@/lib/db";
import { downloadContactDossier } from "@/lib/contactDossier";
import {
  buildLossRunEmailBody,
  buildLossRunReport,
  downloadLossRunPdf,
  lossRunAttachment,
  lossRunSubject,
} from "@/lib/lossRuns";
import type { Asset, Document, MarketingCampaign, MarketingMessage, NoteAttachment, Policy, PolicyParty, TemplateFieldMap } from "@/types";

type RenewalAiField = "policyId" | "renewalDate";
type ClaimStatus = "opened" | "in_review" | "closed";
type ClaimAiField = "policyId" | "status" | "externalClaimNumber" | "carrierClaimsUrl";
type LossHistoryAiField = "policyId" | "status" | "externalClaimNumber" | "openedAt" | "lossDescription";

function uniqueStaffIds(ids: Array<string | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => !!id)));
}

function generateManagerVerificationCode(): string {
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return String(values[0] % 1000000).padStart(6, "0");
  }
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

function profileValue(value?: string | null): string {
  const clean = value?.trim();
  return clean ? clean : "-";
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function joinedValue(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

export function ClientDetailPage() {
  const { customerId } = useParams();
  const { agency } = useTenant();
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  // Hash-based deep-link from elsewhere in the app. We wait one tick
  // so the page is mounted, then scroll the anchor into view.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [location.hash]);
  const showIntegrationNotice = useIntegrationNotice();
  // Look up the customer up front so we can seed controlled state with
  // its addresses before any conditional returns.
  const customerForInit = customerId ? api.customers.get(customerId) : undefined;
  const [, setRev] = useState(0);
  // Profile-card lock pattern mirrors CustomerSettingsPage: the
  // contact-info inputs (email, phone, mailing) are
  // read-only by default. Click "Edit profile" to unlock; Save
  // persists + re-locks; Cancel reverts + re-locks. The Assigned
  // Agent select is intentionally outside this lock — it's
  // manager-only and editable inline at all times.
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  // Inline custom-message composer state. Email/SMS in the page
  // header open the composer here with this client pre-selected
  // and the right channel pre-picked. Keeps the agent on the
  // client detail page (and the Clients category) rather than
  // jumping to /employee/marketing.
  const [email, setEmail] = useState(customerForInit?.email ?? "");
  const [phone, setPhone] = useState(customerForInit?.phone ?? "");
  const [lineOfBusiness, setLineOfBusiness] = useState<"personal" | "commercial">(
    customerForInit?.lineOfBusiness ?? "personal"
  );
  const [businessName, setBusinessName] = useState(customerForInit?.businessName ?? "");
  const [mailingAddress, setMailingAddress] = useState(customerForInit?.mailingAddress ?? "");
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>(
    uniqueStaffIds([customerForInit?.assignedAgentId, ...(customerForInit?.additionalAgentIds ?? [])])
  );
  const [assignedCsrIds, setAssignedCsrIds] = useState<string[]>(
    uniqueStaffIds([customerForInit?.assignedCsrId, ...(customerForInit?.additionalCsrIds ?? [])])
  );
  useEffect(() => {
    if (editingProfile) return;
    setAssignedAgentIds(uniqueStaffIds([customerForInit?.assignedAgentId, ...(customerForInit?.additionalAgentIds ?? [])]));
    setAssignedCsrIds(uniqueStaffIds([customerForInit?.assignedCsrId, ...(customerForInit?.additionalCsrIds ?? [])]));
  }, [
    customerForInit?.assignedAgentId,
    customerForInit?.additionalAgentIds,
    customerForInit?.assignedCsrId,
    customerForInit?.additionalCsrIds,
    editingProfile,
  ]);
  const [editingOperations, setEditingOperations] = useState(false);
  const [operationsDescription, setOperationsDescription] = useState(
    customerForInit?.operationsDescription ?? ""
  );
  const [operationsSaved, setOperationsSaved] = useState(false);
  const [operationsAiBusy, setOperationsAiBusy] = useState(false);
  const [operationsAiFileName, setOperationsAiFileName] = useState<string | null>(null);
  const [operationsAiFileType, setOperationsAiFileType] = useState<string | null>(null);
  const [operationsAiSummary, setOperationsAiSummary] = useState<string | null>(null);
  const [addPolicyOpen, setAddPolicyOpen] = useState(false);
  const [previousPoliciesOpen, setPreviousPoliciesOpen] = useState(false);
  const [policyRetrieveBusy, setPolicyRetrieveBusy] = useState(false);
  const [policyRetrieveNotice, setPolicyRetrieveNotice] = useState<string | null>(null);
  const [addClaimOpen, setAddClaimOpen] = useState(false);
  const [lossRunsOpen, setLossRunsOpen] = useState(false);
  const [claimCheckBusy, setClaimCheckBusy] = useState(false);
  const [claimCheckNotice, setClaimCheckNotice] = useState<string | null>(null);
  const [createActivityOpen, setCreateActivityOpen] = useState(false);
  const [previewTemplateOpen, setPreviewTemplateOpen] = useState(false);
  const [documentsUploaderOpen, setDocumentsUploaderOpen] = useState(false);
  const [fullProfileOpen, setFullProfileOpen] = useState(false);
  const [encryptedInfoOpen, setEncryptedInfoOpen] = useState(false);
  const [encryptedAccessGranted, setEncryptedAccessGranted] = useState(false);
  const [managerVerificationCode, setManagerVerificationCode] = useState("");
  const [managerVerificationError, setManagerVerificationError] = useState<string | null>(null);
  const [generatedManagerCode, setGeneratedManagerCode] = useState<string | null>(null);
  if (!customerId) {
    return (
      <EmptyState
        title="Client link is missing"
        description="Open a client from the Clients category so the software can load the right record."
        action={<Button onClick={() => nav("/employee/clients")}>Back to clients</Button>}
      />
    );
  }
  if (!agency || !user) {
    return (
      <EmptyState
        title="Loading client workspace"
        description="Your session is being restored. If this stays here, return to the Clients category and reopen the client."
        action={<Button onClick={() => nav("/employee/clients")}>Back to clients</Button>}
      />
    );
  }
  const customer = customerForInit;
  if (!customer || customer.tenantId !== agency.id) {
    return <EmptyState title="Client not found" />;
  }
  if (!api.customers.canSee(customer, { id: user.id, role: user.role })) {
    return (
      <EmptyState
        title="Client not available"
        description="This profile is not assigned to your role. Managers can route it from the Activity Center."
        action={<Button onClick={() => nav("/employee/clients")}>Back to clients</Button>}
      />
    );
  }
  const activeAgency = agency;
  const activeUser = user;
  const activeCustomer = customer;
  const canManageRouting = isRoutingManagerRole(user.role);
  const canViewEncryptedInfo = canManageRouting;
  const agentOptions = api.users
    .list(agency.id)
    .filter((u) => u.role === "agent" || u.role === "manager");
  const csrOptions = api.users.list(agency.id).filter((u) => u.role === "csr");
  const assignedAgentNames = assignedAgentIds
    .map((id) => api.users.get(id)?.name)
    .filter((name): name is string => !!name);
  const assignedCsrNames = assignedCsrIds
    .map((id) => api.users.get(id)?.name)
    .filter((name): name is string => !!name);
  const assignedAgentId = assignedAgentIds[0] ?? "";
  const assignedCsrId = assignedCsrIds[0] ?? "";
  function setAssignedAgentId(id: string) {
    setAssignedAgentIds((current) => {
      const rest = current.filter((item) => item !== id);
      return id ? [id, ...rest] : [];
    });
  }
  function setAssignedCsrId(id: string) {
    setAssignedCsrIds((current) => {
      const rest = current.filter((item) => item !== id);
      return id ? [id, ...rest] : [];
    });
  }
  function toggleProfileAgent(id: string) {
    if (!editingProfile || !canManageRouting) return;
    setAssignedAgentIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }
  function toggleProfileCsr(id: string) {
    if (!editingProfile || !canManageRouting) return;
    setAssignedCsrIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }
  const assets = api.assets.listByCustomer(customer.id);
  const policies = api.policies.listByCustomer(customer.id);
  const activePolicies = policies.filter((p) => p.status !== "closed");
  const previousPolicies = policies
    .filter((p) => p.status === "closed")
    .sort((a, b) => ((a.closedAt ?? a.createdAt) < (b.closedAt ?? b.createdAt) ? 1 : -1));
  const policyIds = new Set(policies.map((p) => p.id));
  const upcomingRenewals = api.renewals
    .listByTenant(agency.id)
    .filter((r) => policyIds.has(r.policyId) && r.status === "upcoming")
    .sort((a, b) => (a.renewalDate < b.renewalDate ? -1 : 1));
  const claims = api.claims.listByCustomer(customer.id);
  const docs = api.documents.listByEntity({ customerId: customer.id });
  const events = api.customers.fullHistory(customer.id);
  const openActivities = api.tasks
    .listOpen(agency.id)
    .filter((t) => t.customerId === customer.id);
  const resolvedActivities = api.tasks
    .listCompleted(agency.id)
    .filter((t) => t.customerId === customer.id);
  const refresh = () => setRev((r) => r + 1);
  useEffect(() => subscribeToDbChanges(refresh), []);
  function handleCarrierPolicyRetrieve() {
    setPolicyRetrieveBusy(true);
    setPolicyRetrieveNotice(null);
    try {
      const out = api.policies.retrieveFromCarrier({
        tenantId: activeAgency.id,
        customerId: activeCustomer.id,
        createdById: activeUser.id,
      });
      setPolicyRetrieveNotice(out.summary);
      refresh();
    } finally {
      setPolicyRetrieveBusy(false);
    }
  }

  function handleCarrierClaimCheck() {
    setClaimCheckBusy(true);
    setClaimCheckNotice(null);
    try {
      const out = api.claims.checkForCarrierClaims({
        tenantId: activeAgency.id,
        customerId: activeCustomer.id,
        createdById: activeUser.id,
      });
      setClaimCheckNotice(out.summary);
      refresh();
    } finally {
      setClaimCheckBusy(false);
    }
  }

  function scrollToDocumentsUploader() {
    setDocumentsUploaderOpen(true);
    window.setTimeout(() => {
      document.getElementById("client-doc-uploader")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 60);
  }

  function openEncryptedInformation() {
    if (!canViewEncryptedInfo) return;
    setGeneratedManagerCode(generateManagerVerificationCode());
    setManagerVerificationCode("");
    setManagerVerificationError(null);
    setEncryptedAccessGranted(false);
    setEncryptedInfoOpen(true);
  }

  function closeEncryptedInformation() {
    setEncryptedInfoOpen(false);
    setEncryptedAccessGranted(false);
    setManagerVerificationCode("");
    setManagerVerificationError(null);
    setGeneratedManagerCode(null);
  }

  function verifyEncryptedInformation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!generatedManagerCode || managerVerificationCode.trim() !== generatedManagerCode) {
      setManagerVerificationError("The verification code does not match.");
      return;
    }
    setEncryptedAccessGranted(true);
    setManagerVerificationError(null);
  }

  async function handleOperationsFile(files: File[]) {
    const file = files[0];
    if (!file) return;
    setOperationsAiBusy(true);
    setOperationsAiFileName(file.name);
    setOperationsAiFileType(file.type || "application/octet-stream");
    try {
      const out = await aiExtractPolicyFromFile({
        fileName: file.name,
        fileType: file.type,
        carrierNames: carrierNamesForPolicies(policies),
      });
      const summary = out.summary?.trim() || `Operations information extracted from ${file.name}.`;
      const business = businessName.trim() || activeCustomer.businessName || activeCustomer.name;
      setOperationsDescription((current) =>
        current.trim()
          ? current
          : `${business} operations summary: ${summary}`
      );
      setOperationsAiSummary(
        `${summary} AI drafted the operations description from the uploaded material. Review and edit before saving.`
      );
    } finally {
      setOperationsAiBusy(false);
    }
  }

  function clearOperationsFile() {
    setOperationsAiFileName(null);
    setOperationsAiFileType(null);
    setOperationsAiSummary(null);
  }

  function saveOperationsDescription() {
    const next = operationsDescription.trim();
    api.customers.update(activeCustomer.id, {
      operationsDescription: next || undefined,
    });
    if (operationsAiFileName) {
      const sourceDocument = api.documents.create({
        tenantId: activeAgency.id,
        uploadedById: activeUser.id,
        fileName: operationsAiFileName,
        fileType: operationsAiFileType || "application/octet-stream",
        documentName: "Description of operations source",
        type: "other",
        visibility: "employee_only",
        status: "approved",
        customerId: activeCustomer.id,
      });
      api.status.create({
        tenantId: activeAgency.id,
        source: "agent",
        message: `Commercial description of operations updated from ${operationsAiFileName}.`,
        visibility: "internal",
        customerId: activeCustomer.id,
        documentId: sourceDocument.id,
        createdById: activeUser.id,
      });
    } else {
      api.status.create({
        tenantId: activeAgency.id,
        source: "agent",
        message: "Commercial description of operations updated manually.",
        visibility: "internal",
        customerId: activeCustomer.id,
        createdById: activeUser.id,
      });
    }
    setEditingOperations(false);
    setOperationsSaved(true);
    clearOperationsFile();
    window.setTimeout(() => setOperationsSaved(false), 2000);
    refresh();
  }

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={() => nav(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">
            {customer.lineOfBusiness === "commercial" && customer.businessName ? customer.businessName : customer.name}
          </h1>
          {customer.lineOfBusiness === "commercial" && customer.businessName ? (
            <div className="mt-1 text-sm font-semibold text-ink-800">{customer.name}</div>
          ) : (
            customer.businessName && (
              <div className="mt-1 text-sm font-semibold text-ink-800">{customer.businessName}</div>
            )
          )}
          <p className="text-ink-500 text-sm mt-1">{customer.email} · {customer.phone ?? "—"}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <ContactRouteButton
            kind="client"
            contact={customer}
            tenantId={agency.id}
            viewer={user}
            onChanged={refresh}
          />
          <Button
            variant="outline"
            size="sm"
            icon={<Download className="h-4 w-4" />}
            onClick={() => downloadContactDossier({ kind: "client", id: customer.id })}
            title="Download a print-ready PDF dossier with this client's full record"
          >
            Download client information
          </Button>
          <Button
            variant="ghost"
            size="sm"
            tone="danger"
            icon={<Archive className="h-4 w-4" />}
            onClick={() => {
              if (!confirm(`Archive ${customer.name}? You can unarchive from Archive.`)) return;
              api.customers.archive(customer.id);
              nav("/employee/clients");
            }}
          >
            Archive client
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader
            title="Profile"
            action={
              <div className="flex flex-wrap justify-end gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  icon={<Eye className="h-3.5 w-3.5" />}
                  onClick={() => setFullProfileOpen(true)}
                >
                  View full profile
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  onClick={openEncryptedInformation}
                  disabled={!canViewEncryptedInfo}
                  title={
                    canViewEncryptedInfo
                      ? "Manager verification required"
                      : "Only managers can view encrypted information."
                  }
                >
                  See encrypted information
                </Button>
              </div>
            }
            subtitle={
              editingProfile
                ? "Editing — save your changes to re-lock the form."
                : "Locked. Tap Edit profile below to make changes — saving re-locks the form automatically."
            }
          />
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (lineOfBusiness === "commercial" && !businessName.trim()) return;
              const [primaryAgentId, ...additionalAgentIds] = assignedAgentIds;
              const [primaryCsrId, ...additionalCsrIds] = assignedCsrIds;
              api.customers.update(customer.id, {
                email,
                phone,
                lineOfBusiness,
                businessName: lineOfBusiness === "commercial" ? businessName.trim() : undefined,
                mailingAddress,
                ...(canManageRouting
                  ? {
                      assignedAgentId: primaryAgentId || undefined,
                      additionalAgentIds: additionalAgentIds.length > 0 ? additionalAgentIds : undefined,
                      assignedCsrId: primaryCsrId || undefined,
                      additionalCsrIds: additionalCsrIds.length > 0 ? additionalCsrIds : undefined,
                    }
                  : {}),
              });
              setEditingProfile(false);
              setProfileSaved(true);
              window.setTimeout(() => setProfileSaved(false), 2000);
              refresh();
            }}
          >
            <div>
              <label className="label">Client line</label>
              <select
                className="input"
                value={lineOfBusiness}
                onChange={(e) => setLineOfBusiness(e.target.value as "personal" | "commercial")}
                disabled={!editingProfile}
                aria-readonly={!editingProfile}
              >
                <option value="personal">Personal lines</option>
                <option value="commercial">Commercial lines</option>
              </select>
            </div>
            {lineOfBusiness === "commercial" && (
              <div>
                <label className="label">Business name</label>
                <input
                  className={`input ${
                    editingProfile && !businessName.trim()
                      ? "border-alert-ring ring-1 ring-alert-ring focus:border-alert focus:ring-alert-ring"
                      : ""
                  }`}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  disabled={!editingProfile}
                  readOnly={!editingProfile}
                  required
                />
                {editingProfile && !businessName.trim() && (
                  <div className="mt-1 text-[11px] text-alert">
                    Business name is required for commercial-lines clients.
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!editingProfile}
                readOnly={!editingProfile}
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={!editingProfile}
                readOnly={!editingProfile}
              />
            </div>
            <div>
              <label className="label">Mailing address</label>
              {editingProfile ? (
                <AddressAutocomplete
                  value={mailingAddress}
                  onChange={setMailingAddress}
                />
              ) : (
                <MapLink address={mailingAddress} variant="field" />
              )}
            </div>
            <div>
              <label className="label flex items-center gap-1.5">
                Assigned agents
                {assignedAgentIds.length === 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-alert font-semibold">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-alert" />
                    {canManageRouting ? "needs assignment" : "unassigned"}
                  </span>
                )}
                {!canManageRouting && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                    <Lock className="h-3 w-3" /> manager only
                  </span>
                )}
              </label>
              {canManageRouting ? (
                <select
                  className={`input ${
                    assignedAgentIds.length === 0
                      ? "text-alert font-semibold border-alert-ring ring-1 ring-alert-ring focus:ring-alert-ring focus:border-alert"
                      : ""
                  }`}
                  value={assignedAgentId}
                  onChange={(e) => setAssignedAgentId(e.target.value)}
                  disabled={!editingProfile}
                  aria-readonly={!editingProfile}
                >
                  <option value="">— Unassigned —</option>
                  {agentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : (
                // Disabled <select> — visibly a form control but truly
                // non-interactive. Agents see who the client is assigned
                // to but cannot change it. We still flag "Unassigned" in
                // red so the agent has the same situational awareness as
                // the manager — they just can't fix it.
                <select
                  className={`input cursor-not-allowed appearance-none ${
                    assignedAgentIds.length === 0
                      ? "bg-alert-soft text-alert font-semibold border-alert-ring"
                      : "bg-ink-100 text-ink-500"
                  }`}
                  disabled
                  value={assignedAgentId}
                  title="Only a manager can change the assigned agent."
                  aria-readonly="true"
                >
                  <option value="">Unassigned</option>
                  {agentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="label flex items-center gap-1.5">
                Assigned CSRs
                {!canManageRouting && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                    <Lock className="h-3 w-3" /> manager only
                  </span>
                )}
              </label>
              {canManageRouting ? (
                <select
                  className="input"
                  value={assignedCsrId}
                  onChange={(e) => setAssignedCsrId(e.target.value)}
                  disabled={!editingProfile}
                  aria-readonly={!editingProfile}
                >
                  <option value="">No CSR assigned</option>
                  {csrOptions.map((csr) => (
                    <option key={csr.id} value={csr.id}>
                      {csr.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className="input cursor-not-allowed appearance-none bg-ink-100 text-ink-500"
                  disabled
                  value={assignedCsrId}
                  title="Only a manager can change the assigned CSR."
                  aria-readonly="true"
                >
                  <option value="">No CSR assigned</option>
                  {csrOptions.map((csr) => (
                    <option key={csr.id} value={csr.id}>
                      {csr.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {canManageRouting && editingProfile && (
              <div className="rounded-md border border-ink-200 bg-ink-50 p-3">
                <div className="label">Assigned team</div>
                <div className="grid gap-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-500">
                      Agents
                    </div>
                    <div className="max-h-36 overflow-y-auto rounded-md border border-ink-100 bg-white divide-y divide-ink-100">
                      {agentOptions.map((agent) => (
                        <label key={agent.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={assignedAgentIds.includes(agent.id)}
                            onChange={() => toggleProfileAgent(agent.id)}
                          />
                          <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                          {assignedAgentIds[0] === agent.id && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              Primary
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-500">
                      CSRs
                    </div>
                    <div className="max-h-36 overflow-y-auto rounded-md border border-ink-100 bg-white divide-y divide-ink-100">
                      {csrOptions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-ink-500">No CSRs are active for this agency.</div>
                      ) : (
                        csrOptions.map((csr) => (
                          <label key={csr.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              checked={assignedCsrIds.includes(csr.id)}
                              onChange={() => toggleProfileCsr(csr.id)}
                            />
                            <span className="min-w-0 flex-1 truncate">{csr.name}</span>
                            {assignedCsrIds[0] === csr.id && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                Primary
                              </span>
                            )}
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!editingProfile && (assignedAgentNames.length > 1 || assignedCsrNames.length > 1) && (
              <div className="rounded-md border border-ink-100 bg-ink-50 p-3 text-xs text-ink-600">
                {assignedAgentNames.length > 1 && (
                  <div>
                    <span className="font-semibold text-ink-700">Agent team:</span>{" "}
                    {assignedAgentNames.join(", ")}
                  </div>
                )}
                {assignedCsrNames.length > 1 && (
                  <div className={assignedAgentNames.length > 1 ? "mt-1" : ""}>
                    <span className="font-semibold text-ink-700">CSR team:</span>{" "}
                    {assignedCsrNames.join(", ")}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {!editingProfile ? (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setEditingProfile(true)}
                >
                  <Pencil className="h-4 w-4" /> Edit profile
                </button>
              ) : (
                <>
                  <button
                    className="btn-primary"
                    type="submit"
                    disabled={lineOfBusiness === "commercial" && !businessName.trim()}
                  >
                    Save changes
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      // Revert local form state to the persisted
                      // customer record and re-lock.
                      setLineOfBusiness(customer.lineOfBusiness ?? "personal");
                      setBusinessName(customer.businessName ?? "");
                      setEmail(customer.email);
                      setPhone(customer.phone ?? "");
                      setMailingAddress(customer.mailingAddress ?? "");
                      setAssignedAgentIds(uniqueStaffIds([customer.assignedAgentId, ...(customer.additionalAgentIds ?? [])]));
                      setAssignedCsrIds(uniqueStaffIds([customer.assignedCsrId, ...(customer.additionalCsrIds ?? [])]));
                      setEditingProfile(false);
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
              {profileSaved && (
                <span className="text-sm text-emerald-600">Saved — locked again.</span>
              )}
            </div>
          </form>
        </Card>

        {lineOfBusiness === "commercial" && (
          <Card>
            <CardHeader
              title="Description of operations"
              subtitle={
                editingOperations
                  ? "Editing. Enter operations manually or upload source material for AI to draft it."
                  : "Locked. Used for commercial quoting, carrier submissions, and underwriting context."
              }
            />
            <div className="space-y-4">
              {editingOperations && (
                <AiDocumentInsert
                  aiBusy={operationsAiBusy}
                  aiFileName={operationsAiFileName}
                  aiSummary={operationsAiSummary}
                  idleTitle="Upload operations source"
                  idleHelp="Drop an application, website printout, certificate request, loss run, carrier email, or pasted image. AI drafts the operations description below."
                  busyLabel="Reading operations material..."
                  confirmLabel="the file will attach to this commercial client record"
                  onFile={handleOperationsFile}
                  onClear={clearOperationsFile}
                />
              )}

              <div>
                <label className="label">
                  Operations description {operationsAiFileName && <AiTag />}
                </label>
                {editingOperations ? (
                  <textarea
                    className="input min-h-[150px]"
                    value={operationsDescription}
                    onChange={(event) => setOperationsDescription(event.target.value)}
                    placeholder="Describe what the business does, where it operates, revenue drivers, employee/contractor exposure, premises, vehicles/equipment, and any unusual hazards."
                  />
                ) : operationsDescription.trim() ? (
                  <div className="min-h-[150px] rounded-md border border-ink-100 bg-ink-50/60 p-3 text-sm leading-6 text-ink-700 whitespace-pre-wrap">
                    {operationsDescription}
                  </div>
                ) : (
                  <div className="min-h-[150px] rounded-md border border-dashed border-ink-200 bg-ink-50/40 p-4 text-sm leading-6 text-ink-500">
                    No description of operations is on file yet. Add this before commercial carrier
                    submissions so applications and supplementals have the right context.
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
                {!editingOperations ? (
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      setOperationsDescription(customer.operationsDescription ?? "");
                      setOperationsSaved(false);
                      setEditingOperations(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> Edit operations
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={saveOperationsDescription}
                    >
                      Save operations
                    </button>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => {
                        setOperationsDescription(customer.operationsDescription ?? "");
                        clearOperationsFile();
                        setEditingOperations(false);
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {operationsSaved && (
                  <span className="text-sm text-emerald-600">Saved - locked again.</span>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Assets" />
          {assets.length === 0 ? (
            <div className="text-sm text-ink-400">No assets.</div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {assets.map((a) => (
                <li
                  key={a.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.label}</div>
                    <div className="text-xs text-ink-500">
                      {api.helpers.assetTypeLabel(a.type)} · {fmt.money(a.estimatedValue)}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    to={`/employee/clients/${customer.id}/assets/${a.id}`}
                    className="shrink-0"
                  >
                    View
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <ExpandableCard
          id="messages-thread"
          title="Messages"
          subtitle="Chronological thread with this client. Reply right here."
          action={
            <Link
              to={`/employee/messages?contact=client:${customer.id}`}
              className="btn-outline text-xs inline-flex"
            >
              Open
            </Link>
          }
        >
          {(expanded) => (
            <ContactMessageThread
              tenantId={agency.id}
              userId={user.id}
              contactKind="client"
              contactId={customer.id}
              onChanged={refresh}
              fillHeight={expanded}
            />
          )}
        </ExpandableCard>

        <div className="lg:col-span-3">
          <ClientQuotingCard
            tenantId={agency.id}
            userId={user.id}
            customer={customer}
            onChanged={refresh}
          />
        </div>

        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h3 className="text-lg font-semibold text-ink-900">Policies</h3>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button
                size="xs"
                variant="outline"
                className="whitespace-nowrap"
                onClick={() => setPreviousPoliciesOpen(true)}
                icon={<Archive className="h-3.5 w-3.5" />}
              >
                Previous Policies
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="whitespace-nowrap"
                onClick={handleCarrierPolicyRetrieve}
                disabled={policyRetrieveBusy || activePolicies.length === 0}
                title={activePolicies.length === 0 ? "Add an active policy before retrieving carrier policy data" : "Retrieve current policy data from carrier portals"}
                icon={policyRetrieveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              >
                Retrieve policy
              </Button>
              <Button
                size="xs"
                className="whitespace-nowrap"
                onClick={() => setAddPolicyOpen(true)}
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                Add policy
              </Button>
            </div>
          </div>
          <AddPolicyModal
            open={addPolicyOpen}
            onClose={() => setAddPolicyOpen(false)}
            customerId={customer.id}
            onCreated={refresh}
          />
          <PreviousPoliciesModal
            open={previousPoliciesOpen}
            onClose={() => setPreviousPoliciesOpen(false)}
            policies={previousPolicies}
          />
          {policyRetrieveNotice && (
            <div className="mb-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700">
              {policyRetrieveNotice}
            </div>
          )}
          {activePolicies.length === 0 ? (
            <div className="text-sm text-ink-400">No active policies.</div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {activePolicies.map((p) => {
                const asset = api.assets.get(p.assetId);
                const carrier = api.carriers.get(p.carrierId);
                const upcomingRenewal = upcomingRenewals.find((r) => r.policyId === p.id);
                return (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm font-semibold text-ink-900">
                        {fmt.policyRef(p)}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-500">
                        {carrier?.name ?? "Carrier"} - {asset?.label ?? "Assets listed on policy"} - {api.helpers.departmentLabel(p)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2">
                      {p.renewalStatus === "not_renewed" ? (
                        <Badge tone="error">Non-renewed</Badge>
                      ) : (
                        upcomingRenewal && <Badge tone="warn">Renewal soon</Badge>
                      )}
                      <PolicyStatusBadge status={p.status} />
                      <PolicyActions policy={p} size="xs" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <ContactActivitiesCard
          title="Open activities and quote flows"
          openActivities={openActivities}
          resolvedActivities={resolvedActivities}
          emptyHint="No open activities for this client right now."
          onCreate={() => setCreateActivityOpen(true)}
          className="lg:row-span-3"
        />

        <Card id="claims" className="lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h3 className="text-lg font-semibold text-ink-900">Claims</h3>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button
                size="xs"
                variant="outline"
                className="whitespace-nowrap"
                onClick={() => setLossRunsOpen(true)}
                icon={<ClipboardList className="h-3.5 w-3.5" />}
              >
                Previous Loss Runs
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="whitespace-nowrap"
                onClick={handleCarrierClaimCheck}
                disabled={claimCheckBusy || policies.length === 0}
                title={policies.length === 0 ? "Add a policy before retrieving carrier claims" : "Retrieve claim activity from carrier portals"}
                icon={claimCheckBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              >
                Retrieve claim
              </Button>
              <Button
                size="xs"
                className="whitespace-nowrap"
                onClick={() => setAddClaimOpen(true)}
                disabled={policies.length === 0}
                title={policies.length === 0 ? "Add a policy before adding a claim" : "Add a claim for this client"}
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                Add claim
              </Button>
            </div>
          </div>
          <AddClaimModal
            open={addClaimOpen}
            onClose={() => setAddClaimOpen(false)}
            tenantId={agency.id}
            customerId={customer.id}
            userId={user.id}
            policies={policies}
            assets={assets}
            onCreated={refresh}
          />
          <PreviousLossRunsModal
            open={lossRunsOpen}
            onClose={() => setLossRunsOpen(false)}
            customerId={customer.id}
            userId={user.id}
            onChanged={refresh}
          />
          {claimCheckNotice && (
            <div className="mb-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700">
              {claimCheckNotice}
            </div>
          )}
          {claims.length === 0 ? (
            <div className="text-sm text-ink-400">No claims.</div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {claims.map((c) => {
                const carrier = api.carriers.get(c.carrierId);
                const policy = policies.find((p) => p.id === c.policyId) ?? api.policies.get(c.policyId);
                const asset = policy ? api.assets.get(policy.assetId) : undefined;
                const statusTone: "success" | "info" | "warn" =
                  c.status === "closed" ? "success" : c.status === "in_review" ? "info" : "warn";
                const statusLabel =
                  c.status === "closed" ? "Closed" : c.status === "in_review" ? "In review" : "Open";
                return (
                  <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm font-semibold text-ink-900">
                        {c.externalClaimNumber ? `Claim #${c.externalClaimNumber}` : fmt.policyRef(policy)}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-500">
                        {carrier?.name ?? "Carrier"} - {policy ? fmt.policyRef(policy) : "Policy pending"} - {asset?.label ?? "Asset not recorded"}
                        {c.closedAt ? ` - closed ${fmt.relative(c.closedAt)}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2">
                      <Badge tone={statusTone}>{statusLabel}</Badge>
                      <Button size="xs" to={`/employee/claims?claim=${c.id}`} title="Open claim details">
                        Open
                      </Button>
                    </div>
                    <div className="hidden">
                      <div className="font-medium truncate">{carrier?.name ?? "—"}</div>
                      <div className="text-xs text-ink-500 capitalize">
                        {c.status.replace("_", " ")}
                        {c.closedAt && ` · closed ${fmt.relative(c.closedAt)}`}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <ClientBillingCard
          customerId={customer.id}
          tenantId={agency.id}
          userId={user.id}
          onChanged={refresh}
          className="lg:col-span-2"
        />

        <Card className="lg:col-span-3">
          <CardHeader
            title="Documents"
            subtitle="Upload proof of insurance, policy docs, appraisals, and inspections. Mark as customer-visible to share with the client."
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="gold"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={scrollToDocumentsUploader}
                >
                  Upload document
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  onClick={() => setPreviewTemplateOpen(true)}
                >
                  Preview template
                </Button>
              </div>
            }
          />
          <MissingDocsAi
            customerId={customer.id}
            tenantId={agency.id}
            uploadedById={user.id}
            uploaderOpen={documentsUploaderOpen}
            onUploaderOpenChange={setDocumentsUploaderOpen}
            onUploaded={refresh}
          />
          <AcordDocumentsAiPanel
            customerId={customer.id}
            tenantId={agency.id}
            uploadedById={user.id}
            onFilled={refresh}
          />
          <CollapsibleDocumentList
            documents={docs}
            policies={policies}
            uploadedById={user.id}
            onChanged={refresh}
          />
        </Card>

        <FilledTemplatePreviewModal
          open={previewTemplateOpen}
          onClose={() => setPreviewTemplateOpen(false)}
          tenantId={agency.id}
          customerId={customer.id}
          uploadedById={user.id}
          onSaved={refresh}
        />

        <CreateActivityModal
          open={createActivityOpen}
          onClose={() => setCreateActivityOpen(false)}
          tenantId={agency.id}
          viewer={{ id: user.id, role: user.role }}
          fixedContact={{ kind: "customer", id: customer.id, name: customer.name }}
          onCreated={refresh}
        />

        <CollapsibleTimelineCard
          tenantId={agency.id}
          customerId={customer.id}
          createdById={user.id}
          events={events}
          onAdded={refresh}
        />

        <CollapsibleCampaignsCard
          tenantId={agency.id}
          customerId={customer.id}
        />
      </div>

      {assets[0] && (
        <Link to={`/customer/assets/${assets[0].id}`} className="text-xs text-ink-400">
          Asset deep-link (customer view)
        </Link>
      )}

      <Modal
        open={fullProfileOpen}
        onClose={() => setFullProfileOpen(false)}
        title="Full client profile"
        size="xl"
      >
        <div className="space-y-5">
          <ProfileDetailSection title="Client information">
            <ProfileDetailGrid>
              <ProfileDetailRow label="Client name" value={profileValue(customer.name)} />
              <ProfileDetailRow label="Business name" value={profileValue(customer.businessName)} />
              <ProfileDetailRow
                label="Client line"
                value={customer.lineOfBusiness === "commercial" ? "Commercial lines" : "Personal lines"}
              />
              <ProfileDetailRow label="Client code" value={profileValue(customer.clientCode)} />
              <ProfileDetailRow label="Email" value={profileValue(customer.email)} />
              <ProfileDetailRow label="Phone" value={profileValue(customer.phone)} />
              <ProfileDetailRow label="Mailing address" value={profileValue(customer.mailingAddress)} />
              <ProfileDetailRow label="Created" value={fmt.dateTime(customer.createdAt)} />
            </ProfileDetailGrid>
          </ProfileDetailSection>

          {customer.lineOfBusiness === "commercial" && (
            <ProfileDetailSection title="Commercial profile">
              <div className="rounded-md border border-ink-100 bg-ink-50/60 p-3 text-sm leading-6 text-ink-700 whitespace-pre-wrap">
                {profileValue(customer.operationsDescription)}
              </div>
            </ProfileDetailSection>
          )}

          <ProfileDetailSection title="Assigned team">
            <ProfileDetailGrid>
              <ProfileDetailRow label="Agents" value={joinedValue(assignedAgentNames)} />
              <ProfileDetailRow label="CSRs" value={joinedValue(assignedCsrNames)} />
            </ProfileDetailGrid>
          </ProfileDetailSection>

          <ProfileDetailSection title="Portfolio summary">
            <ProfileDetailGrid>
              <ProfileDetailRow label="Assets" value={assets.length} />
              <ProfileDetailRow label="Active policies" value={activePolicies.length} />
              <ProfileDetailRow label="Previous policies" value={previousPolicies.length} />
              <ProfileDetailRow label="Claims" value={claims.length} />
              <ProfileDetailRow label="Documents" value={docs.length} />
              <ProfileDetailRow label="Open activities" value={openActivities.length} />
            </ProfileDetailGrid>
          </ProfileDetailSection>

          <ProfileDetailSection title="Policies">
            {policies.length === 0 ? (
              <div className="text-sm text-ink-500">No policies are attached to this client.</div>
            ) : (
              <div className="divide-y divide-ink-100 rounded-md border border-ink-100">
                {policies.map((policy) => {
                  const carrier = api.carriers.get(policy.carrierId);
                  const asset = api.assets.get(policy.assetId);
                  return (
                    <div key={policy.id} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink-900">{fmt.policyRef(policy)}</div>
                        <div className="text-ink-500">
                          {carrier?.name ?? "Carrier pending"} - {asset?.label ?? "No asset linked"}
                        </div>
                      </div>
                      <div className="text-ink-500 sm:text-right">{fmt.titleCase(policy.status)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </ProfileDetailSection>

          <ProfileDetailSection title="Additional contacts">
            {customer.additionalContacts && customer.additionalContacts.length > 0 ? (
              <div className="divide-y divide-ink-100 rounded-md border border-ink-100">
                {customer.additionalContacts.map((contact, index) => (
                  <div key={`${contact.name}-${index}`} className="px-3 py-2 text-sm">
                    <div className="font-semibold text-ink-900">{profileValue(contact.name)}</div>
                    <div className="text-ink-500">
                      {profileValue(contact.relation)} - {profileValue(contact.phone)} - {profileValue(contact.email)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-ink-500">No additional contacts on file.</div>
            )}
          </ProfileDetailSection>

          <ProfileDetailSection title="Consent and portal status">
            <ProfileDetailGrid>
              <ProfileDetailRow label="Email marketing opt-in" value={yesNo(customer.marketingOptInEmail)} />
              <ProfileDetailRow label="SMS marketing opt-in" value={yesNo(customer.marketingOptInSms)} />
              <ProfileDetailRow label="Terms accepted" value={fmt.dateTime(customer.termsAcceptedAt)} />
              <ProfileDetailRow label="Terms version" value={profileValue(customer.termsVersion)} />
              <ProfileDetailRow label="Email consent" value={fmt.dateTime(customer.emailConsentAt)} />
              <ProfileDetailRow label="SMS consent" value={fmt.dateTime(customer.smsConsentAt)} />
            </ProfileDetailGrid>
          </ProfileDetailSection>
        </div>
      </Modal>

      <Modal
        open={encryptedInfoOpen}
        onClose={closeEncryptedInformation}
        title="Encrypted information"
        size="lg"
      >
        {!canViewEncryptedInfo ? (
          <div className="rounded-md border border-alert-ring bg-alert-soft p-4 text-sm text-alert">
            Only managers can access encrypted client information.
          </div>
        ) : encryptedAccessGranted ? (
          <div className="space-y-5">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              Manager verification complete.
            </div>
            <ProfileDetailSection title="Protected identifiers">
              <ProfileDetailGrid>
                <ProfileDetailRow label="Agency UUID" value={agency.id} mono />
                <ProfileDetailRow label="Client UUID" value={customer.id} mono />
                <ProfileDetailRow label="Portal user UUID" value={profileValue(customer.userId)} mono />
                <ProfileDetailRow label="Branch UUID" value={profileValue(customer.branchId)} mono />
                <ProfileDetailRow label="Assigned agent UUIDs" value={joinedValue(assignedAgentIds)} mono />
                <ProfileDetailRow label="Assigned CSR UUIDs" value={joinedValue(assignedCsrIds)} mono />
              </ProfileDetailGrid>
            </ProfileDetailSection>
            <ProfileDetailSection title="Protected consent trail">
              <ProfileDetailGrid>
                <ProfileDetailRow label="Terms accepted at" value={fmt.dateTime(customer.termsAcceptedAt)} />
                <ProfileDetailRow label="Terms version" value={profileValue(customer.termsVersion)} />
                <ProfileDetailRow label="Email consent at" value={fmt.dateTime(customer.emailConsentAt)} />
                <ProfileDetailRow label="SMS consent at" value={fmt.dateTime(customer.smsConsentAt)} />
              </ProfileDetailGrid>
            </ProfileDetailSection>
            <ProfileDetailSection title="Protected data scopes">
              <ProfileDetailGrid>
                <ProfileDetailRow label="Message thread scope" value={`client:${customer.id}`} mono />
                <ProfileDetailRow label="Document scope" value={`tenant:${agency.id} / client:${customer.id}`} mono />
                <ProfileDetailRow label="Routing scope" value={joinedValue([customer.assignedAgentId, customer.assignedCsrId].filter((id): id is string => !!id))} mono />
              </ProfileDetailGrid>
            </ProfileDetailSection>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={verifyEncryptedInformation}>
            <div className="rounded-md border border-gold-200 bg-gold-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                <KeyRound className="h-4 w-4 text-gold-700" />
                Manager 2FA required
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                Enter the one-time verification code for this manager session before protected client identifiers and encrypted data scopes are shown.
              </p>
              {generatedManagerCode && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-gold-200 bg-white px-3 py-2 text-sm">
                  <span className="text-ink-500">Verification code</span>
                  <span className="font-mono text-base font-semibold tracking-[0.25em] text-ink-900">
                    {generatedManagerCode}
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="label">2FA code</label>
              <input
                className={`input ${managerVerificationError ? "border-alert-ring ring-1 ring-alert-ring" : ""}`}
                value={managerVerificationCode}
                onChange={(event) => {
                  setManagerVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setManagerVerificationError(null);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter 6-digit code"
              />
              {managerVerificationError && (
                <div className="mt-1 text-xs font-semibold text-alert">{managerVerificationError}</div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-4">
              <Button variant="outline" onClick={closeEncryptedInformation}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={managerVerificationCode.length !== 6}>
                Verify and view
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function ProfileDetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{title}</h4>
      {children}
    </section>
  );
}

function ProfileDetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2">{children}</div>;
}

function ProfileDetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/60 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</div>
      <div className={`mt-1 break-words text-sm text-ink-900 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function AddRenewalModal({
  open,
  onClose,
  tenantId,
  userId,
  policies,
  assets,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  userId: string;
  policies: Policy[];
  assets: Asset[];
  onCreated: () => void;
}) {
  const [policyId, setPolicyId] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFileName, setAiFileName] = useState<string | null>(null);
  const [aiFileType, setAiFileType] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [enriched, setEnriched] = useState<Set<RenewalAiField>>(new Set());
  const selectedPolicy = policies.find((p) => p.id === policyId);
  const selectedAsset = selectedPolicy
    ? assets.find((a) => a.id === selectedPolicy.assetId)
    : undefined;

  useEffect(() => {
    if (!open) return;
    const first = policies[0];
    setPolicyId(first?.id ?? "");
    setRenewalDate(defaultRenewalDate(first));
    setAiBusy(false);
    setAiFileName(null);
    setAiFileType(null);
    setAiSummary(null);
    setEnriched(new Set());
  }, [open, policies]);

  async function handleAiFile(files: File[]) {
    const file = files[0];
    if (!file) return;
    setAiBusy(true);
    setAiFileName(file.name);
    setAiFileType(file.type || "application/octet-stream");
    try {
      const out = await aiExtractPolicyFromFile({
        fileName: file.name,
        fileType: file.type,
        carrierNames: carrierNamesForPolicies(policies),
      });
      const filled = new Set<RenewalAiField>();
      const matched = matchPolicyFromAi(out, policies);
      if (matched) {
        setPolicyId(matched.id);
        filled.add("policyId");
      }
      if (out.renewalDate) {
        setRenewalDate(out.renewalDate);
        filled.add("renewalDate");
      }
      setAiSummary(out.summary);
      setEnriched(filled);
    } finally {
      setAiBusy(false);
    }
  }

  function clearAiFile() {
    setAiFileName(null);
    setAiFileType(null);
    setAiSummary(null);
    setEnriched(new Set());
  }

  function submit() {
    if (!selectedPolicy || !renewalDate) return;
    const iso = dateInputToIso(renewalDate);
    const renewal = api.renewals.create({
      tenantId,
      policyId: selectedPolicy.id,
      renewalDate: iso,
      status: "upcoming",
      agentId: userId,
    });
    api.policies.update(selectedPolicy.id, {
      renewalDate: iso,
      renewalStatus: "upcoming",
    });
    if (aiFileName) {
      api.documents.create({
        tenantId,
        uploadedById: userId,
        fileName: aiFileName,
        fileType: aiFileType || "application/octet-stream",
        type: "endorsement_document",
        visibility: "customer_visible",
        status: "approved",
        customerId: selectedPolicy.customerId,
        policyId: selectedPolicy.id,
        assetId: selectedPolicy.assetId,
      });
    }
    api.status.create({
      tenantId,
      source: "agent",
      message: `Renewal added: ${selectedAsset?.label ?? fmt.policyRef(selectedPolicy)} renews ${fmt.date(iso)}.`,
      visibility: "internal",
      customerId: selectedPolicy.customerId,
      policyId: selectedPolicy.id,
      assetId: selectedPolicy.assetId,
      renewalId: renewal.id,
      createdById: userId,
    });
    onCreated();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add renewal" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Create a renewal row for this client's existing policy. Upcoming renewals also create the Activity Center follow-up and flag renewal documents.
        </p>
        <AiDocumentInsert
          aiBusy={aiBusy}
          aiFileName={aiFileName}
          aiSummary={aiSummary}
          idleTitle="Insert from renewal document"
          idleHelp="Drop a renewal packet, declarations page, or carrier notice. AI fills the policy and renewal date below."
          busyLabel="Reading the renewal document..."
          confirmLabel="the file will attach to this renewal's policy"
          onFile={handleAiFile}
          onClear={clearAiFile}
        />
        <div>
          <label className="label">
            Policy * {enriched.has("policyId") && <AiTag />}
          </label>
          <select
            className="input"
            value={policyId}
            onChange={(e) => {
              const nextId = e.target.value;
              const nextPolicy = policies.find((p) => p.id === nextId);
              setPolicyId(nextId);
              setRenewalDate(defaultRenewalDate(nextPolicy));
            }}
          >
            <option value="">— Pick a policy —</option>
            {policies.map((p) => {
              const asset = assets.find((a) => a.id === p.assetId);
              return (
                <option key={p.id} value={p.id}>
                  {asset?.label ?? fmt.policyRef(p)} · {fmt.policyRef(p)}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className="label">
            Renewal date * {enriched.has("renewalDate") && <AiTag />}
          </label>
          <input
            className="input"
            type="date"
            value={renewalDate}
            onChange={(e) => setRenewalDate(e.target.value)}
          />
        </div>
        {selectedPolicy && (
          <div className="rounded-md border border-ink-100 bg-ink-50/60 p-3 text-xs text-ink-600">
            <CalendarClock className="mr-1 inline h-3.5 w-3.5 text-gold-600" />
            This updates {selectedAsset?.label ?? "the policy"} to show the new renewal date on policy detail pages.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-ink-100">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={!selectedPolicy || !renewalDate}
          >
            <Plus className="h-3.5 w-3.5" /> Add renewal
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PreviousPoliciesModal({
  open,
  onClose,
  policies,
}: {
  open: boolean;
  onClose: () => void;
  policies: Policy[];
}) {
  return (
    <Modal open={open} onClose={onClose} title="Previous policies" size="lg">
      {policies.length === 0 ? (
        <EmptyState
          title="No previous policies"
          description="Closed policies will appear here after staff moves them out of the active policy list."
        />
      ) : (
        <ul className="divide-y divide-ink-100">
          {policies.map((policy) => {
            const carrier = api.carriers.get(policy.carrierId);
            const asset = api.assets.get(policy.assetId);
            return (
              <li
                key={policy.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-4"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-semibold text-ink-900">
                    {fmt.policyRef(policy)}
                  </div>
                  <div className="mt-1 truncate text-xs text-ink-500">
                    {carrier?.name ?? "Carrier"} - {asset?.label ?? "Assets listed on policy"} -{" "}
                    {api.helpers.departmentLabel(policy)}
                  </div>
                  <div className="mt-1 text-xs text-ink-400">
                    Closed {fmt.dateTime(policy.closedAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  {policy.renewalStatus === "not_renewed" && <Badge tone="error">Non-renewed</Badge>}
                  <PolicyStatusBadge status={policy.status} />
                  <Button size="xs" to={`/employee/policies/${policy.id}`} title="Open previous policy">
                    Open
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

type LossRunSendMode = "holders" | "carriers";

type LossRunRecipient = {
  id: string;
  name: string;
  email: string;
  detail: string;
  policyId?: string;
  carrierContactId?: string;
  externalRole?: string;
};

function PreviousLossRunsModal({
  open,
  onClose,
  customerId,
  userId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  userId: string;
  onChanged: () => void;
}) {
  const report = open ? buildLossRunReport(customerId) : null;
  const [sendMode, setSendMode] = useState<LossRunSendMode | null>(null);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingLossHistory, setAddingLossHistory] = useState(false);
  const [lossPolicyId, setLossPolicyId] = useState("");
  const [lossStatus, setLossStatus] = useState<ClaimStatus>("closed");
  const [lossOpenedDate, setLossOpenedDate] = useState("");
  const [lossClosedDate, setLossClosedDate] = useState("");
  const [lossClaimNumber, setLossClaimNumber] = useState("");
  const [lossAmount, setLossAmount] = useState("");
  const [lossDescription, setLossDescription] = useState("");
  const [lossAiBusy, setLossAiBusy] = useState(false);
  const [lossAiFileName, setLossAiFileName] = useState<string | null>(null);
  const [lossAiFileType, setLossAiFileType] = useState<string | null>(null);
  const [lossAiSummary, setLossAiSummary] = useState<string | null>(null);
  const [lossEnriched, setLossEnriched] = useState<Set<LossHistoryAiField>>(new Set());

  const holderRecipients = report ? buildLossRunHolderRecipients(report.customer.id) : [];
  const carrierRecipients = report ? buildLossRunCarrierRecipients(report.customer.tenantId, report.rows) : [];
  const policies = open ? api.policies.listByCustomer(customerId) : [];
  const assets = open ? api.assets.listByCustomer(customerId) : [];
  const selectedLossPolicy = policies.find((policy) => policy.id === lossPolicyId);
  const selectedLossCarrier = selectedLossPolicy ? api.carriers.get(selectedLossPolicy.carrierId) : undefined;
  const selectedLossAsset = selectedLossPolicy
    ? assets.find((asset) => asset.id === selectedLossPolicy.assetId)
    : undefined;
  const activeRecipients = sendMode === "holders" ? holderRecipients : sendMode === "carriers" ? carrierRecipients : [];
  const selectedRecipients = activeRecipients.filter((recipient) => selectedRecipientIds.includes(recipient.id));

  useEffect(() => {
    if (!open) return;
    const firstPolicy = api.policies.listByCustomer(customerId)[0];
    const today = new Date().toISOString().slice(0, 10);
    setSendMode(null);
    setSelectedRecipientIds([]);
    setNotice(null);
    setAddingLossHistory(false);
    setLossPolicyId(firstPolicy?.id ?? "");
    setLossStatus("closed");
    setLossOpenedDate(today);
    setLossClosedDate(today);
    setLossClaimNumber("");
    setLossAmount("");
    setLossDescription("");
    setLossAiBusy(false);
    setLossAiFileName(null);
    setLossAiFileType(null);
    setLossAiSummary(null);
    setLossEnriched(new Set());
  }, [open, customerId]);

  if (!report) {
    return (
      <Modal open={open} onClose={onClose} title="Previous Loss Runs" size="lg">
        <div className="text-sm text-ink-500">Client loss-runs record could not be loaded.</div>
      </Modal>
    );
  }
  const lossRun = report;

  function startRecipientSend(mode: LossRunSendMode) {
    const recipients = mode === "holders" ? holderRecipients : carrierRecipients;
    setSendMode(mode);
    setSelectedRecipientIds(recipients.map((recipient) => recipient.id));
    setNotice(null);
  }

  function sendToClient() {
    api.communications.create({
      tenantId: lossRun.customer.tenantId,
      customerId: lossRun.customer.id,
      channel: "email",
      direction: "outbound",
      subject: lossRunSubject(lossRun),
      body: buildLossRunEmailBody(lossRun, "client"),
      attachments: [lossRunAttachment(lossRun)],
      createdById: userId,
    });
    api.status.create({
      tenantId: lossRun.customer.tenantId,
      source: "agent",
      message: `Previous loss-runs PDF sent to ${lossRun.customer.name}.`,
      visibility: "internal",
      customerId: lossRun.customer.id,
      createdById: userId,
    });
    setNotice(`Sent loss-runs PDF to ${lossRun.customer.name}.`);
    onChanged();
  }

  function sendToSelectedRecipients() {
    if (!sendMode || selectedRecipients.length === 0) return;
    const body = buildLossRunEmailBody(lossRun, sendMode === "holders" ? "holders" : "carriers");
    const subject = lossRunSubject(lossRun);
    const attachment = lossRunAttachment(lossRun);

    selectedRecipients.forEach((recipient) => {
      api.communications.create({
        tenantId: lossRun.customer.tenantId,
        carrierContactId: recipient.carrierContactId,
        externalRecipientName: recipient.carrierContactId ? undefined : recipient.name,
        externalRecipientEmail: recipient.carrierContactId ? undefined : recipient.email,
        externalRecipientRole: recipient.carrierContactId ? undefined : recipient.externalRole,
        channel: "email",
        direction: "outbound",
        subject,
        body,
        attachments: [attachment],
        createdById: userId,
      });
    });

    api.status.create({
      tenantId: lossRun.customer.tenantId,
      source: "agent",
      message: `Previous loss-runs PDF sent to ${selectedRecipients.length} ${
        sendMode === "holders" ? "policy holder" : "carrier"
      } recipient${selectedRecipients.length === 1 ? "" : "s"}.`,
      visibility: "internal",
      customerId: lossRun.customer.id,
      createdById: userId,
    });
    setNotice(
      `Sent to ${selectedRecipients.length} ${sendMode === "holders" ? "holder" : "carrier"} recipient${
        selectedRecipients.length === 1 ? "" : "s"
      }.`
    );
    setSendMode(null);
    setSelectedRecipientIds([]);
    onChanged();
  }

  function handleDownloadPdf() {
    downloadLossRunPdf(lossRun.customer.id);
    api.status.create({
      tenantId: lossRun.customer.tenantId,
      source: "agent",
      message: `Previous loss-runs PDF downloaded for ${lossRun.customer.name}.`,
      visibility: "internal",
      customerId: lossRun.customer.id,
      createdById: userId,
    });
    onChanged();
  }

  async function handleLossHistoryFile(files: File[]) {
    const file = files[0];
    if (!file) return;
    setLossAiBusy(true);
    setLossAiFileName(file.name);
    setLossAiFileType(file.type || "application/octet-stream");
    try {
      const out = await aiExtractPolicyFromFile({
        fileName: file.name,
        fileType: file.type,
        carrierNames: carrierNamesForPolicies(policies),
      });
      const filled = new Set<LossHistoryAiField>();
      const matched = matchPolicyFromAi(out, policies);
      if (matched) {
        setLossPolicyId(matched.id);
        filled.add("policyId");
      }
      const inferredStatus = inferClaimStatusFromFileName(file.name);
      setLossStatus(inferredStatus);
      filled.add("status");
      const claimNumber = inferClaimNumberFromFileName(file.name);
      if (claimNumber) {
        setLossClaimNumber(claimNumber);
        filled.add("externalClaimNumber");
      }
      const inferredDate = inferDateFromFileName(file.name);
      if (inferredDate) {
        setLossOpenedDate(inferredDate);
        if (inferredStatus === "closed") setLossClosedDate(inferredDate);
        filled.add("openedAt");
      }
      const summary = out.summary || `Loss-history details inferred from ${file.name}.`;
      setLossDescription(summary);
      filled.add("lossDescription");
      setLossAiSummary(
        `${summary} AI matched the file to the closest policy, inferred the claim status, and filled any claim number/date it could read from the file name.`
      );
      setLossEnriched(filled);
    } finally {
      setLossAiBusy(false);
    }
  }

  function clearLossHistoryFile() {
    setLossAiFileName(null);
    setLossAiFileType(null);
    setLossAiSummary(null);
    setLossEnriched(new Set());
  }

  function saveLossHistory() {
    if (!selectedLossPolicy || !lossOpenedDate) return;
    const parsedAmount = parseMoneyInput(lossAmount);
    const openedAt = dateInputToIso(lossOpenedDate);
    const closedAt =
      lossStatus === "closed"
        ? dateInputToIso(lossClosedDate || lossOpenedDate)
        : undefined;
    const claim = api.claims.create({
      tenantId: lossRun.customer.tenantId,
      customerId: lossRun.customer.id,
      policyId: selectedLossPolicy.id,
      carrierId: selectedLossPolicy.carrierId,
      carrierClaimsUrl: selectedLossCarrier?.claimsUrl,
      externalClaimNumber: lossClaimNumber.trim() || undefined,
      lossDescription: lossDescription.trim() || undefined,
      lossAmountUsd: parsedAmount,
      status: lossStatus,
      closedAt,
    });
    api.claims.update(claim.id, { openedAt, closedAt });
    if (lossAiFileName) {
      api.documents.create({
        tenantId: lossRun.customer.tenantId,
        uploadedById: userId,
        fileName: lossAiFileName,
        fileType: lossAiFileType || "application/octet-stream",
        type: "claim_document",
        visibility: "employee_only",
        status: "approved",
        customerId: lossRun.customer.id,
        policyId: selectedLossPolicy.id,
        assetId: selectedLossPolicy.assetId,
        claimId: claim.id,
      });
    }
    if (lossDescription.trim() || lossAiFileName || parsedAmount != null) {
      api.notes.create({
        tenantId: lossRun.customer.tenantId,
        authorId: userId,
        customerId: lossRun.customer.id,
        visibility: "internal",
        body: [
          `Loss history added for ${fmt.policyRef(selectedLossPolicy)}.`,
          lossClaimNumber.trim() ? `Claim #: ${lossClaimNumber.trim()}.` : "",
          parsedAmount != null ? `Amount: ${fmt.money(parsedAmount)}.` : "",
          lossDescription.trim() ? `Details: ${lossDescription.trim()}` : "",
          lossAiFileName ? `Source file: ${lossAiFileName}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        attachments: lossAiFileName
          ? [
              {
                id: `loss_history_upload_${Date.now()}`,
                fileName: lossAiFileName,
                fileType: lossAiFileType || "application/octet-stream",
                aiSummary: lossAiSummary ?? `Loss history source file: ${lossAiFileName}`,
                addedAt: new Date().toISOString(),
              },
            ]
          : undefined,
      });
    }
    api.status.create({
      tenantId: lossRun.customer.tenantId,
      source: "agent",
      message: `Loss history added for ${lossRun.customer.name} on ${fmt.policyRef(selectedLossPolicy)}${
        lossClaimNumber.trim() ? ` (claim #${lossClaimNumber.trim()})` : ""
      }.`,
      visibility: "internal",
      customerId: lossRun.customer.id,
      policyId: selectedLossPolicy.id,
      assetId: selectedLossPolicy.assetId,
      claimId: claim.id,
      createdById: userId,
    });
    setAddingLossHistory(false);
    setNotice("Loss history added and included in the previous loss-runs report.");
    onChanged();
  }

  return (
    <Modal open={open} onClose={onClose} title="Previous Loss Runs" size="xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-ink-100 bg-ink-50/50 p-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-gold-700">
              Loss history
            </div>
            <h3 className="mt-1 text-xl font-semibold text-ink-900">{lossRun.customer.name}</h3>
            <p className="mt-1 max-w-2xl text-sm text-ink-500">
              Generated from all recorded claim activity on this client. Use this for a clean agency-side loss-run
              summary, then reconcile against official carrier-issued loss runs when required.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <LossRunStat label="Total" value={lossRun.rows.length} />
            <LossRunStat label="Open" value={lossRun.openCount} />
            <LossRunStat label="Review" value={lossRun.inReviewCount} />
            <LossRunStat label="Closed" value={lossRun.closedCount} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={addingLossHistory ? "gold" : "outline"}
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setAddingLossHistory((current) => !current);
              setSendMode(null);
              setNotice(null);
            }}
          >
            Add loss history
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<Send className="h-3.5 w-3.5" />}
            onClick={sendToClient}
          >
            Send to client
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<Users className="h-3.5 w-3.5" />}
            onClick={() => startRecipientSend("holders")}
          >
            Send to holders
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<Building2 className="h-3.5 w-3.5" />}
            onClick={() => startRecipientSend("carriers")}
          >
            Send to carrier
          </Button>
          <Button
            size="sm"
            variant="gold"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={handleDownloadPdf}
          >
            Download PDF
          </Button>
        </div>

        {addingLossHistory && (
          <div className="rounded-lg border border-gold-200 bg-gold-50/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gold-700">
                  Add loss history
                </div>
                <p className="mt-1 max-w-2xl text-sm text-ink-600">
                  Enter a historical loss manually, or drop a loss run, claim notice, carrier packet,
                  or pasted screenshot and let AI fill what it can. Review everything before saving.
                </p>
              </div>
              <Button size="xs" variant="outline" icon={<X className="h-3.5 w-3.5" />} onClick={() => setAddingLossHistory(false)}>
                Close
              </Button>
            </div>

            <div className="mt-4">
              <AiDocumentInsert
                aiBusy={lossAiBusy}
                aiFileName={lossAiFileName}
                aiSummary={lossAiSummary}
                idleTitle="Insert from loss document"
                idleHelp="Drop a prior loss run, claim notice, carrier email PDF, or pasted image. AI fills policy, claim number, status, date, and summary where possible."
                busyLabel="Reading the loss-history document..."
                confirmLabel="the file will attach to this historical loss"
                onFile={handleLossHistoryFile}
                onClear={clearLossHistoryFile}
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="label">
                  Policy * {lossEnriched.has("policyId") && <AiTag />}
                </label>
                <select className="input" value={lossPolicyId} onChange={(event) => setLossPolicyId(event.target.value)}>
                  <option value="">- Pick a policy -</option>
                  {policies.map((policy) => {
                    const carrier = api.carriers.get(policy.carrierId);
                    const asset = assets.find((row) => row.id === policy.assetId);
                    return (
                      <option key={policy.id} value={policy.id}>
                        {fmt.policyRef(policy)} - {asset?.label ?? "Asset"} - {carrier?.name ?? "Carrier"}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="label">
                  Loss status {lossEnriched.has("status") && <AiTag />}
                </label>
                <select
                  className="input"
                  value={lossStatus}
                  onChange={(event) => setLossStatus(event.target.value as ClaimStatus)}
                >
                  <option value="opened">Opened</option>
                  <option value="in_review">In review</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className="label">
                  Claim number {lossEnriched.has("externalClaimNumber") && <AiTag />}
                </label>
                <input
                  className="input"
                  value={lossClaimNumber}
                  onChange={(event) => setLossClaimNumber(event.target.value)}
                  placeholder="Optional carrier claim #"
                />
              </div>
              <div>
                <label className="label">
                  Loss date * {lossEnriched.has("openedAt") && <AiTag />}
                </label>
                <input
                  type="date"
                  className="input"
                  value={lossOpenedDate}
                  onChange={(event) => setLossOpenedDate(event.target.value)}
                />
              </div>
              <div>
                <label className="label">Closed date</label>
                <input
                  type="date"
                  className="input"
                  value={lossClosedDate}
                  onChange={(event) => setLossClosedDate(event.target.value)}
                  disabled={lossStatus !== "closed"}
                />
              </div>
              <div>
                <label className="label">Loss amount</label>
                <input
                  className="input"
                  value={lossAmount}
                  onChange={(event) => setLossAmount(event.target.value)}
                  placeholder="e.g. 12500"
                />
              </div>
              <div className="rounded-md border border-ink-100 bg-white/70 p-3 text-xs text-ink-600">
                <LifeBuoy className="mr-1 inline h-3.5 w-3.5 text-gold-600" />
                {selectedLossPolicy
                  ? `${selectedLossCarrier?.name ?? "Carrier"} - ${selectedLossAsset?.label ?? fmt.policyRef(selectedLossPolicy)}`
                  : "Pick a policy to attach this historical loss."}
              </div>
              <div className="md:col-span-2">
                <label className="label">
                  Loss description {lossEnriched.has("lossDescription") && <AiTag />}
                </label>
                <textarea
                  className="input min-h-[86px]"
                  value={lossDescription}
                  onChange={(event) => setLossDescription(event.target.value)}
                  placeholder="Cause of loss, payout/reserve notes, whether the file is closed, and any underwriting context."
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-gold-100 pt-3">
              <Button size="sm" variant="outline" onClick={() => setAddingLossHistory(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="gold"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={saveLossHistory}
                disabled={!selectedLossPolicy || !lossOpenedDate}
              >
                Add to loss runs
              </Button>
            </div>
          </div>
        )}

        {notice && (
          <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        )}

        {sendMode && (
          <div className="rounded-lg border border-ink-100 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  {sendMode === "holders" ? "Select holder recipients" : "Select carrier recipients"}
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  The PDF loss-run summary is attached to every selected recipient.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setSelectedRecipientIds(activeRecipients.map((recipient) => recipient.id))}
                >
                  Select all
                </Button>
                <Button size="xs" variant="outline" onClick={() => setSelectedRecipientIds([])}>
                  Clear
                </Button>
              </div>
            </div>
            {activeRecipients.length === 0 ? (
              <div className="mt-3 rounded-md border border-dashed border-ink-200 px-3 py-4 text-sm text-ink-500">
                No eligible {sendMode === "holders" ? "policy holders" : "carrier recipients"} with an email address are on file.
              </div>
            ) : (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {activeRecipients.map((recipient) => {
                  const checked = selectedRecipientIds.includes(recipient.id);
                  return (
                    <label
                      key={recipient.id}
                      className={`flex min-h-[4.25rem] cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm ${
                        checked ? "border-gold-300 bg-gold-50" : "border-ink-100 bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-gold-600"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedRecipientIds((current) =>
                            event.target.checked
                              ? Array.from(new Set([...current, recipient.id]))
                              : current.filter((id) => id !== recipient.id)
                          );
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">{recipient.name}</span>
                        <span className="block truncate text-xs text-ink-500">{recipient.email}</span>
                        <span className="block truncate text-xs text-ink-400">{recipient.detail}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 pt-3">
              <Button size="sm" variant="outline" onClick={() => setSendMode(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="gold"
                onClick={sendToSelectedRecipients}
                disabled={selectedRecipients.length === 0}
              >
                Send selected{selectedRecipients.length > 0 ? ` (${selectedRecipients.length})` : ""}
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-ink-100">
          <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_7rem_7rem_7rem] gap-4 border-b border-ink-100 bg-ink-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
            <div>Claim</div>
            <div>Policy</div>
            <div>Carrier / asset</div>
            <div>Opened</div>
            <div>Closed</div>
            <div>Status</div>
          </div>
          <div className="divide-y divide-ink-100">
            {lossRun.rows.length > 0 ? (
              lossRun.rows.map((row) => (
                <div
                  key={row.claim.id}
                  className="grid min-h-[4.75rem] grid-cols-[minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_7rem_7rem_7rem] items-center gap-4 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink-900">{row.claimNumber}</div>
                    <div className="mt-0.5 truncate text-xs text-ink-500">{row.lossDescription}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-semibold text-ink-900">{row.policyRef}</div>
                    <div className="mt-0.5 truncate text-xs text-ink-500">{row.lineOfBusiness}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink-900">{row.carrier?.name ?? "Carrier not recorded"}</div>
                    <div className="mt-0.5 truncate text-xs text-ink-500">
                      {row.assetLabel} - {row.lossAmountLabel}
                    </div>
                  </div>
                  <div className="text-xs text-ink-600">{row.openedDate}</div>
                  <div className="text-xs text-ink-600">{row.closedDate}</div>
                  <div>
                    <Badge tone={row.claim.status === "closed" ? "success" : row.claim.status === "in_review" ? "info" : "warn"}>
                      {row.statusLabel}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-ink-400">
                No recorded claims or losses are currently on file.
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LossRunStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16 rounded-md border border-ink-100 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function buildLossRunHolderRecipients(customerId: string): LossRunRecipient[] {
  const seen = new Set<string>();
  return api.policies
    .listByCustomer(customerId)
    .flatMap((policy) =>
      (policy.additionalInsureds ?? [])
        .filter((holder) => !!holder.email?.trim())
        .map((holder, index) => {
          const email = holder.email!.trim();
          const id = `holder_${policy.id}_${index}_${email.toLowerCase()}`;
          return {
            id,
            name: holder.name,
            email,
            detail: `${holderPartyLabel(holder)} - ${fmt.policyRef(policy)}`,
            policyId: policy.id,
            externalRole: holderPartyLabel(holder),
          };
        })
    )
    .filter((recipient) => {
      const key = `${recipient.email.toLowerCase()}_${recipient.policyId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildLossRunCarrierRecipients(
  tenantId: string,
  rows: NonNullable<ReturnType<typeof buildLossRunReport>>["rows"]
): LossRunRecipient[] {
  const carriers = new Map<string, NonNullable<(typeof rows)[number]["carrier"]>>();
  rows.forEach((row) => {
    if (row.carrier) carriers.set(row.carrier.id, row.carrier);
  });

  return Array.from(carriers.values()).flatMap<LossRunRecipient>((carrier) => {
    const contacts = api.carrierContacts
      .listForCarrier(tenantId, carrier.id)
      .filter((contact) => contact.position === "claims_rep" || contact.position === "adjuster");
    if (contacts.length > 0) {
      return contacts.map<LossRunRecipient>((contact) => ({
        id: `carrier_contact_${contact.id}`,
        name: contact.name,
        email: contact.email,
        detail: `${carrier.name} - ${fmt.titleCase(contact.position.replace(/_/g, " "))}`,
        carrierContactId: contact.id,
      }));
    }
    const fallbackEmail = carrier.billingEmail?.trim() || `claims@${carrier.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`;
    return [
      {
        id: `carrier_fallback_${carrier.id}`,
        name: `${carrier.name} claims desk`,
        email: fallbackEmail,
        detail: "Carrier claims desk",
        externalRole: "Carrier claims desk",
      },
    ];
  });
}

function holderPartyLabel(holder: PolicyParty): string {
  if (holder.relationship?.trim()) return holder.relationship.trim();
  if (!holder.holderType) return "Policy holder";
  return fmt.titleCase(holder.holderType.replace(/_/g, " "));
}

function AddClaimModal({
  open,
  onClose,
  tenantId,
  customerId,
  userId,
  policies,
  assets,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  customerId: string;
  userId: string;
  policies: Policy[];
  assets: Asset[];
  onCreated: () => void;
}) {
  const [policyId, setPolicyId] = useState("");
  const [status, setStatus] = useState<ClaimStatus>("opened");
  const [externalClaimNumber, setExternalClaimNumber] = useState("");
  const [carrierClaimsUrl, setCarrierClaimsUrl] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFileName, setAiFileName] = useState<string | null>(null);
  const [aiFileType, setAiFileType] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [enriched, setEnriched] = useState<Set<ClaimAiField>>(new Set());
  const selectedPolicy = policies.find((p) => p.id === policyId);
  const selectedCarrier = selectedPolicy ? api.carriers.get(selectedPolicy.carrierId) : undefined;
  const selectedAsset = selectedPolicy
    ? assets.find((a) => a.id === selectedPolicy.assetId)
    : undefined;

  useEffect(() => {
    if (!open) return;
    const first = policies[0];
    const carrier = first ? api.carriers.get(first.carrierId) : undefined;
    setPolicyId(first?.id ?? "");
    setStatus("opened");
    setExternalClaimNumber("");
    setCarrierClaimsUrl(carrier?.claimsUrl ?? "");
    setAiBusy(false);
    setAiFileName(null);
    setAiFileType(null);
    setAiSummary(null);
    setEnriched(new Set());
  }, [open, policies]);

  async function handleAiFile(files: File[]) {
    const file = files[0];
    if (!file) return;
    setAiBusy(true);
    setAiFileName(file.name);
    setAiFileType(file.type || "application/octet-stream");
    try {
      const out = await aiExtractPolicyFromFile({
        fileName: file.name,
        fileType: file.type,
        carrierNames: carrierNamesForPolicies(policies),
      });
      const filled = new Set<ClaimAiField>();
      const matched = matchPolicyFromAi(out, policies);
      if (matched) {
        setPolicyId(matched.id);
        filled.add("policyId");
        const carrier = api.carriers.get(matched.carrierId);
        if (carrier?.claimsUrl) {
          setCarrierClaimsUrl(carrier.claimsUrl);
          filled.add("carrierClaimsUrl");
        }
      }
      const nextStatus = inferClaimStatusFromFileName(file.name);
      setStatus(nextStatus);
      filled.add("status");
      const claimNumber = inferClaimNumberFromFileName(file.name);
      if (claimNumber) {
        setExternalClaimNumber(claimNumber);
        filled.add("externalClaimNumber");
      }
      setAiSummary(
        `${out.summary} Claim intake fields were inferred from the uploaded file name and carrier match. Confirm before saving.`
      );
      setEnriched(filled);
    } finally {
      setAiBusy(false);
    }
  }

  function clearAiFile() {
    setAiFileName(null);
    setAiFileType(null);
    setAiSummary(null);
    setEnriched(new Set());
  }

  function submit() {
    if (!selectedPolicy) return;
    const claim = api.claims.create({
      tenantId,
      customerId,
      policyId: selectedPolicy.id,
      carrierId: selectedPolicy.carrierId,
      carrierClaimsUrl: carrierClaimsUrl.trim() || selectedCarrier?.claimsUrl,
      externalClaimNumber: externalClaimNumber.trim() || undefined,
      status,
      closedAt: status === "closed" ? new Date().toISOString() : undefined,
    });
    if (aiFileName) {
      api.documents.create({
        tenantId,
        uploadedById: userId,
        fileName: aiFileName,
        fileType: aiFileType || "application/octet-stream",
        type: "claim_document",
        visibility: "customer_visible",
        status: "approved",
        customerId,
        policyId: selectedPolicy.id,
        assetId: selectedPolicy.assetId,
        claimId: claim.id,
      });
    }
    api.status.create({
      tenantId,
      source: "agent",
      message: `Claim added for ${selectedAsset?.label ?? fmt.policyRef(selectedPolicy)} with ${selectedCarrier?.name ?? "the carrier"}${
        externalClaimNumber.trim() ? ` (claim #${externalClaimNumber.trim()})` : ""
      }.`,
      visibility: "customer_visible",
      customerId,
      policyId: selectedPolicy.id,
      assetId: selectedPolicy.assetId,
      claimId: claim.id,
      createdById: userId,
    });
    onCreated();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add claim" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Open a claim record against one of this client's policies. Open claims immediately count toward the client alert path until closed.
        </p>
        <AiDocumentInsert
          aiBusy={aiBusy}
          aiFileName={aiFileName}
          aiSummary={aiSummary}
          idleTitle="Insert from claim document"
          idleHelp="Drop a claim notice, loss run, or carrier claim packet. AI fills the policy, status, claim number, and carrier link below."
          busyLabel="Reading the claim document..."
          confirmLabel="the file will attach to this claim"
          onFile={handleAiFile}
          onClear={clearAiFile}
        />
        <div>
          <label className="label">
            Policy * {enriched.has("policyId") && <AiTag />}
          </label>
          <select
            className="input"
            value={policyId}
            onChange={(e) => {
              const nextId = e.target.value;
              const nextPolicy = policies.find((p) => p.id === nextId);
              const carrier = nextPolicy ? api.carriers.get(nextPolicy.carrierId) : undefined;
              setPolicyId(nextId);
              setCarrierClaimsUrl(carrier?.claimsUrl ?? "");
            }}
          >
            <option value="">— Pick a policy —</option>
            {policies.map((p) => {
              const asset = assets.find((a) => a.id === p.assetId);
              const carrier = api.carriers.get(p.carrierId);
              return (
                <option key={p.id} value={p.id}>
                  {asset?.label ?? fmt.policyRef(p)} · {carrier?.name ?? "Carrier"} · {fmt.policyRef(p)}
                </option>
              );
            })}
          </select>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">
              Claim status {enriched.has("status") && <AiTag />}
            </label>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as ClaimStatus)}
            >
              <option value="opened">Opened</option>
              <option value="in_review">In review</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="label">
              Claim number {enriched.has("externalClaimNumber") && <AiTag />}
            </label>
            <input
              className="input"
              value={externalClaimNumber}
              onChange={(e) => setExternalClaimNumber(e.target.value)}
              placeholder="Optional carrier claim #"
            />
          </div>
        </div>
        <div>
          <label className="label">
            Carrier claims URL {enriched.has("carrierClaimsUrl") && <AiTag />}
          </label>
          <input
            className="input"
            value={carrierClaimsUrl}
            onChange={(e) => setCarrierClaimsUrl(e.target.value)}
            placeholder="Optional carrier claim portal link"
          />
        </div>
        {selectedPolicy && (
          <div className="rounded-md border border-ink-100 bg-ink-50/60 p-3 text-xs text-ink-600">
            <LifeBuoy className="mr-1 inline h-3.5 w-3.5 text-gold-600" />
            {selectedCarrier?.name ?? "Carrier"} claim for {selectedAsset?.label ?? "this policy"}.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-ink-100">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={!selectedPolicy}
          >
            <Plus className="h-3.5 w-3.5" /> Add claim
          </button>
        </div>
      </div>
    </Modal>
  );
}

function dateInputToIso(value: string): string {
  return new Date(`${value}T12:00:00`).toISOString();
}

function isoToDateInput(value?: string): string {
  return value ? value.slice(0, 10) : "";
}

function defaultRenewalDate(policy?: Policy): string {
  if (policy?.renewalDate) return isoToDateInput(policy.renewalDate);
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function AiDocumentInsert({
  aiBusy,
  aiFileName,
  aiSummary,
  idleTitle,
  idleHelp,
  busyLabel,
  confirmLabel,
  onFile,
  onClear,
}: {
  aiBusy: boolean;
  aiFileName: string | null;
  aiSummary: string | null;
  idleTitle: string;
  idleHelp: string;
  busyLabel: string;
  confirmLabel: string;
  onFile: (files: File[]) => void;
  onClear: () => void;
}) {
  if (aiBusy) {
    return (
      <div className="block border-2 border-dashed border-gold-300 rounded-lg p-4 text-center bg-ink-50/40">
        <Loader2 className="h-5 w-5 mx-auto text-gold-600 animate-spin" />
        <div className="mt-2 text-sm text-ink-700">{busyLabel}</div>
      </div>
    );
  }

  if (aiFileName) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-start gap-1.5 min-w-0">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="min-w-0">
              Read from <strong className="break-all">{aiFileName}</strong>. Confirm or edit the
              fields below before saving; {confirmLabel}.
              {aiSummary && (
                <span className="block mt-1 text-emerald-800/80 text-xs">{aiSummary}</span>
              )}
            </span>
          </span>
          <button
            type="button"
            className="text-emerald-700 hover:text-emerald-900 p-0.5 shrink-0"
            onClick={onClear}
            title="Remove the uploaded document"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <FileDropZone
      title={idleTitle}
      help={`${idleHelp} You can also paste a copied image or screenshot.`}
      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
      busy={aiBusy}
      busyLabel={busyLabel}
      icon="ai"
      onFiles={onFile}
    />
  );
}

function AiTag() {
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
      <Sparkles className="h-3 w-3" /> AI
    </span>
  );
}

function carrierNamesForPolicies(policies: Policy[]): string[] {
  return Array.from(
    new Set(
      policies
        .map((p) => api.carriers.get(p.carrierId)?.name)
        .filter((name): name is string => !!name)
    )
  );
}

function matchPolicyFromAi(
  out: { policyNumber?: string; carrierName?: string },
  policies: Policy[]
): Policy | undefined {
  const policyNumber = normalizeMatch(out.policyNumber);
  if (policyNumber) {
    const exact = policies.find((p) => normalizeMatch(p.policyNumber) === policyNumber);
    if (exact) return exact;
  }

  const carrierName = normalizeMatch(out.carrierName);
  if (carrierName) {
    return policies.find((p) => {
      const policyCarrier = normalizeMatch(api.carriers.get(p.carrierId)?.name);
      return !!policyCarrier && (policyCarrier.includes(carrierName) || carrierName.includes(policyCarrier));
    });
  }

  return undefined;
}

function normalizeMatch(value?: string): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inferClaimStatusFromFileName(fileName: string): ClaimStatus {
  const text = fileName.toLowerCase();
  if (/(closed|settled|paid|resolved)/.test(text)) return "closed";
  if (/(review|adjuster|investigat|pending)/.test(text)) return "in_review";
  return "opened";
}

function inferClaimNumberFromFileName(fileName: string): string | undefined {
  const base = fileName.replace(/\.[^.]+$/, "");
  const labeled = base.match(/(?:claim|clm|loss)[\s_-]*(?:no|num|number|#)?[\s_-]*([a-z0-9][a-z0-9_-]{3,})/i);
  const loose = base.match(/\b([a-z]{2,5}[\s_-]?\d{4,}(?:[\s_-]?\d+)?)\b/i);
  const raw = labeled?.[1] ?? loose?.[1];
  return raw ? raw.replace(/[\s_]+/g, "-").toUpperCase() : undefined;
}

function inferDateFromFileName(fileName: string): string | undefined {
  const base = fileName.replace(/\.[^.]+$/, "");
  const iso = base.match(/\b(20\d{2})[-_](0?[1-9]|1[0-2])[-_](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }
  const us = base.match(/\b(0?[1-9]|1[0-2])[-_](0?[1-9]|[12]\d|3[01])[-_](20\d{2})\b/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  return undefined;
}

function parseMoneyInput(value: string): number | undefined {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

// Collapsed-by-default card listing every marketing campaign this
// customer has received from the agency. A customer "received" a
// CustomMessage when:
//   • audience === "all_clients", OR
//   • audience === "selected" AND customer.id ∈ selectedCustomerIds, OR
//   • audience === "filter" AND filter.audienceType ≠ "prospects"
// AND the message has actually been delivered (sentCount > 0 — covers
// both one-shot sends and recurring batches that have run at least
// once). Cancelled and not-yet-sent scheduled drafts are excluded.
//
// Each row is itself expandable: click to reveal the campaign's
// subject + body so the agent can see exactly what the client got.
function CollapsibleCampaignsCard({
  tenantId,
  customerId,
}: {
  tenantId: string;
  customerId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openMsgId, setOpenMsgId] = useState<string | null>(null);
  const customRows = api.customMessages
    .listByTenant(tenantId)
    .filter((m) => {
      if (m.sentCount === 0 && !m.lastSentAt) return false;
      if (m.status === "cancelled") return false;
      if (m.audience === "all_prospects") return false;
      if (m.audience === "all_clients") return true;
      if (m.audience === "selected") return m.selectedCustomerIds.includes(customerId);
      if (m.audience === "filter") {
        const at = m.filter?.audienceType;
        return at === "clients" || at === "both";
      }
      return false;
    })
    .map((m) => ({
      id: `custom:${m.id}`,
      channel: m.channel as string,
      subject: m.subject?.trim() || firstLine(m.body) || "(no subject)",
      body: m.body,
      attachments: m.attachments,
      audience: m.audience,
      filter: m.filter,
      audienceLabel:
        m.audience === "all_clients"
          ? "All clients"
          : m.audience === "selected"
          ? "Selected clients"
          : m.audience === "filter"
          ? `Filtered (${m.filter?.audienceType ?? "-"})`
          : "-",
      recurrence: m.recurrence,
      lastSentAt: m.lastSentAt,
      createdAt: m.createdAt,
      when: m.lastSentAt ?? m.createdAt,
      sourceLabel: "Email",
    }));
  const campaigns = api.marketing.listCampaigns(tenantId);
  const directMarketingRows = api.marketing
    .listMessages(tenantId)
    .filter((m) => m.customerId === customerId && marketingMessageWasReceived(m))
    .map((m) => {
      const campaign = campaigns.find((c) => c.id === m.campaignId);
      return {
        id: `marketing:${m.id}`,
        channel: "email" as string,
        subject: m.subject?.trim() || campaign?.name || firstLine(m.content) || "(no subject)",
        body: m.content,
        attachments: [] as { fileName: string; fileType?: string; documentId?: string; sizeBytes?: number }[],
        audience: "selected" as const,
        filter: undefined,
        audienceLabel: campaign?.name ? `AI campaign - ${campaign.name}` : "AI campaign",
        recurrence: campaign?.recurrence ?? "none",
        lastSentAt: m.sentAt,
        createdAt: m.createdAt,
        when: m.sentAt ?? m.createdAt,
        sourceLabel: "Email",
        campaignId: m.campaignId,
      };
    });
  const campaignsWithReceiptRows = new Set(directMarketingRows.map((row) => row.campaignId));
  const legacyAiCampaignRows = campaigns
    .filter((campaign) => campaign.status !== "draft" && campaign.status !== "scheduled")
    .filter((campaign) => !campaignsWithReceiptRows.has(campaign.id))
    .filter((campaign) => campaignTargetsCustomer(campaign, customerId))
    .map((campaign) => {
      const audienceFilter = campaign.audienceFilter as {
        brief?: string;
        attachments?: { fileName: string; fileType?: string; description?: string }[];
        includeAllClients?: boolean;
      };
      return {
        id: `campaign:${campaign.id}`,
        channel: "email" as string,
        subject: campaign.name,
        body: audienceFilter.brief ?? campaign.name,
        attachments: audienceFilter.attachments ?? [],
        audience: audienceFilter.includeAllClients ? ("all_clients" as const) : ("selected" as const),
        filter: undefined,
        audienceLabel: audienceFilter.includeAllClients ? "All clients" : "Selected clients",
        recurrence: campaign.recurrence ?? "none",
        lastSentAt: campaign.createdAt,
        createdAt: campaign.createdAt,
        when: campaign.createdAt,
        sourceLabel: "Email",
      };
    });
  const received = [...customRows, ...directMarketingRows, ...legacyAiCampaignRows].sort((a, b) =>
    a.when < b.when ? 1 : -1
  );

  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Marketing campaigns received"
        subtitle="Every promotional touch — newsletters, seasonal nudges, renewal-window reminders — the AI marketing pipeline has sent this client. Read-only audit log; click a row to read the exact copy the client got."
      />
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-ink-100 bg-ink-50/40 hover:bg-ink-50 text-sm"
      >
        <span className="inline-flex items-center gap-1.5 text-ink-800">
          <Megaphone className="h-3.5 w-3.5 text-gold-600" />
          <span className="font-medium">
            {received.length} campaign{received.length === 1 ? "" : "s"} received
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-ink-500">
          {expanded ? "Hide" : "Show"}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {expanded && (
        <div
          className={`mt-3 ${
            received.length > 5 ? "max-h-[22rem] dropdown-scroll-y" : ""
          }`}
        >
          {received.length === 0 ? (
            <EmptyState
              title="No campaigns received yet"
              description="When a manager fires a Draft Campaign or one of the agency's recurring AI nudges runs against this client's segment, it will show up here."
            />
          ) : (
            <ul className="divide-y divide-ink-100 border border-ink-100 rounded-md">
              {received.map((m) => {
                const isOpen = openMsgId === m.id;
                const channelIcon = m.channel === "sms" ? MessageSquare : Mail;
                const ChannelIcon = channelIcon;
                const when = m.lastSentAt ?? m.createdAt;
                const audienceLabel =
                  m.audience === "all_clients"
                    ? "All clients"
                    : m.audience === "selected"
                    ? "Selected clients"
                    : m.audience === "filter"
                    ? `Filtered (${m.filter?.audienceType ?? "—"}${m.filter?.assetType ? ` · ${api.helpers.assetTypeLabel(m.filter.assetType)}` : ""})`
                    : "—";
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setOpenMsgId((cur) => (cur === m.id ? null : m.id))}
                      className="w-full flex items-start justify-between gap-3 px-3 py-2.5 hover:bg-ink-50/50 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              m.channel === "sms"
                                ? "bg-blue-50 text-blue-700 border border-blue-100"
                                : "bg-gold-50 text-gold-800 border border-gold-100"
                            }`}
                          >
                            <ChannelIcon className="h-3 w-3" />
                            {m.channel}
                          </span>
                          {m.recurrence !== "none" && (
                            <span className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                              · {m.recurrence}
                            </span>
                          )}
                          <span className="text-[10px] uppercase tracking-wider text-ink-400 font-medium">
                            · {audienceLabel}
                          </span>
                        </div>
                        <div className="text-sm font-medium text-ink-900 mt-1 truncate">
                          {m.subject?.trim() || firstLine(m.body) || "(no subject)"}
                        </div>
                        <div className="text-[11px] text-ink-500 mt-0.5">
                          Sent {fmt.dateTime(when)} · {fmt.relative(when)}
                        </div>
                      </div>
                      <span className="text-ink-400 mt-1">
                        {isOpen ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 pt-1 bg-ink-50/30 border-t border-ink-100">
                        {m.subject?.trim() && m.channel === "email" && (
                          <div className="text-[11px] text-ink-500 mb-1.5">
                            <span className="font-semibold uppercase tracking-wider">Subject:</span>{" "}
                            {m.subject}
                          </div>
                        )}
                        <div className="text-[13px] text-ink-800 whitespace-pre-wrap leading-relaxed">
                          {m.body}
                        </div>
                        {m.attachments.length > 0 && (
                          <div className="mt-2 text-[11px] text-ink-500">
                            <span className="font-semibold uppercase tracking-wider">
                              Attachments:
                            </span>{" "}
                            {m.attachments.map((a) => a.fileName).join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function firstLine(s: string): string {
  return s.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function marketingMessageWasReceived(message: MarketingMessage): boolean {
  return ["sent", "delivered", "opened", "clicked", "replied"].includes(
    message.deliveryStatus
  );
}

function campaignTargetsCustomer(campaign: MarketingCampaign, customerId: string): boolean {
  const audienceFilter = campaign.audienceFilter as {
    includeAllClients?: boolean;
    customerIds?: string[];
  };
  return !!audienceFilter.includeAllClients || (audienceFilter.customerIds ?? []).includes(customerId);
}

// Collapsed-by-default wrapper around the client remarks card.
// Same Show/Hide control pattern as the documents and open-activities
// cards above so a client profile reads as a list of section headers
// the agent expands as needed.
function CollapsibleTimelineCard({
  tenantId,
  customerId,
  createdById,
  events,
  onAdded,
}: {
  tenantId: string;
  customerId: string;
  createdById: string;
  events: import("@/types").StatusEvent[];
  onAdded: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Client remarks"
        subtitle="Renewal reminders, files uploaded, emails / SMS sent, and your own time-stamped remarks all flow into the feed below."
      />
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-ink-100 bg-ink-50/40 hover:bg-ink-50 text-sm"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium text-ink-800">
            {events.length} remark{events.length === 1 ? "" : "s"}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-ink-500">
          {expanded ? "Hide" : "Show"}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-4">
          <CustomNoteInput
            tenantId={tenantId}
            customerId={customerId}
            createdById={createdById}
            onAdded={onAdded}
          />
          <Timeline events={events} searchable />
        </div>
      )}
    </Card>
  );
}

// Inline form for agents / managers to drop a time-stamped note
// straight onto the client's activity timeline. Internally writes
// through api.notes.create, which auto-emits a matching
// internal-visibility status event so the note shows up in the
// activity report without a separate "notes" UI.
const TEXT_PREVIEW_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".eml", ".log"];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readAsTextPreview(file: File): Promise<string | undefined> {
  const lowerName = file.name.toLowerCase();
  const shouldRead =
    file.type.startsWith("text/") ||
    TEXT_PREVIEW_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (!shouldRead) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(0, 900));
    reader.onerror = () => resolve(undefined);
    reader.readAsText(file);
  });
}

function summarizeRemarkUpload(
  file: File,
  textPreview?: string,
  displayName = file.name || "Pasted image"
): string {
  const kind = file.type.startsWith("image/")
    ? "image or pasted screenshot"
    : file.type.includes("pdf")
    ? "PDF"
    : "file";
  const firstLine = textPreview?.split(/\r?\n/).find((line) => line.trim())?.trim();
  if (firstLine) {
    return `${displayName}: AI found readable text starting with "${firstLine.slice(0, 140)}".`;
  }
  return `${displayName}: AI captured this ${kind} for review and linked it to the timestamped client remark.`;
}

function buildAiRemarkDraft(attachments: NoteAttachment[]): string {
  if (attachments.length === 0) return "";
  return [
    "AI-generated note from uploaded material:",
    ...attachments.map((attachment) => `- ${attachment.aiSummary}`),
  ].join("\n");
}

function formatNoteFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function buildRemarkAttachment(file: File, index: number): Promise<NoteAttachment> {
  const [dataUrl, textPreview] = await Promise.all([
    readAsDataUrl(file),
    readAsTextPreview(file),
  ]);
  const fileName = file.name || `pasted-image-${index + 1}.png`;
  return {
    id: `note_upload_${Date.now()}_${index}_${fileName.replace(/[^a-z0-9]+/gi, "_")}`,
    fileName,
    fileType: file.type,
    sizeBytes: file.size,
    dataUrl,
    textPreview,
    aiSummary: summarizeRemarkUpload(file, textPreview, fileName),
    addedAt: new Date().toISOString(),
  };
}

function CustomNoteInput({
  tenantId,
  customerId,
  createdById,
  onAdded,
}: {
  tenantId: string;
  customerId: string;
  createdById: string;
  onAdded: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  // Re-tick once a minute so the "will be stamped at … " preview
  // stays accurate while the form sits open. Avoids the user typing
  // for 5 minutes and seeing a stale time.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const previewTimestamp = fmt.dateTime(new Date().toISOString());

  async function handleNoteFiles(files: File[]) {
    if (files.length === 0) return;
    setUploadBusy(true);
    try {
      const next = await Promise.all(files.map((file, index) => buildRemarkAttachment(file, index)));
      const all = [...attachments, ...next];
      setAttachments(all);
      setBody((current) => {
        if (!current.trim()) return buildAiRemarkDraft(all);
        const addedSummary = next
          .map((attachment) => `- ${attachment.aiSummary}`)
          .join("\n");
        return `${current.trimEnd()}\n\nAI upload summary:\n${addedSummary}`;
      });
    } finally {
      setUploadBusy(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function handleAdd() {
    const trimmed = body.trim() || buildAiRemarkDraft(attachments).trim();
    if (!trimmed && attachments.length === 0) return;
    setBusy(true);
    try {
      api.notes.create({
        tenantId,
        customerId,
        authorId: createdById,
        body: trimmed,
        visibility: "internal",
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      setBody("");
      setAttachments([]);
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3">
      <label className="label">Add a time-stamped note</label>
      <textarea
        className="input min-h-[64px]"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="e.g. Called client to confirm hurricane prep checklist. Will follow up next week."
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleAdd();
          }
        }}
      />
      <div className="mt-2">
        <FileDropZone
          title="Upload or paste files for AI note"
          help="Drop documents, photos, screenshots, or paste a copied image. AI drafts the note from the uploaded material."
          accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json,.eml"
          multiple
          compact
          busy={uploadBusy}
          busyLabel="Analyzing uploads..."
          icon="ai"
          onFiles={handleNoteFiles}
        />
      </div>
      {attachments.length > 0 && (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="rounded-md border border-ink-100 bg-white p-2 text-xs text-ink-600"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-semibold text-ink-900">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-gold-700" />
                    <span className="truncate">{attachment.fileName}</span>
                  </div>
                  <div className="mt-1 text-ink-500">
                    {attachment.fileType || "Uploaded file"}
                    {attachment.sizeBytes ? ` · ${formatNoteFileSize(attachment.sizeBytes)}` : ""}
                  </div>
                  <div className="mt-1 line-clamp-2">{attachment.aiSummary}</div>
                </div>
                <button
                  type="button"
                  className="rounded p-1 text-ink-400 hover:bg-ink-50 hover:text-rose-600"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.fileName}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-ink-500">
        <span>
          Internal — the customer doesn't see this. Notes are{" "}
          <strong className="text-ink-700">permanent and timestamped</strong>; once added they
          can't be edited or deleted. Will be stamped {previewTimestamp}.
        </span>
        <button
          type="button"
          className="btn-primary text-xs whitespace-nowrap"
          onClick={handleAdd}
          disabled={busy || uploadBusy || (body.trim().length === 0 && attachments.length === 0)}
        >
          Add note
        </button>
      </div>
    </div>
  );
}

// One activity row inside the ContactActivitiesCard.
function ActivityRow({
  task,
  resolved,
}: {
  task: import("@/types").Task;
  resolved?: boolean;
}) {
  const navigate = useNavigate();
  const status = api.tasks.statusOf(task);
  const sev = task.severity ?? "info";
  const sevClass =
    sev === "urgent"
      ? "bg-alert-soft text-alert border-alert-ring"
      : sev === "warning"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-yellow-50 text-yellow-700 border-yellow-200";
  const statusLabel = resolved
    ? task.completedAt
      ? `Resolved ${fmt.relative(task.completedAt)}`
      : "Resolved"
    : status === "in_progress"
    ? "In progress"
    : status === "snoozed"
    ? "Snoozed"
    : "To do";
  // Status pill tint: blue for in-progress, red for to-do, amber for
  // snoozed, neutral once resolved.
  const statusClass = resolved
    ? "bg-ink-50 text-ink-500 border-ink-200"
    : status === "in_progress"
    ? "bg-blue-50 text-blue-700 border-blue-200"
    : status === "snoozed"
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <li className="py-2.5 flex items-start justify-between gap-2">
      <div className="min-w-0 flex items-start gap-2">
        <ImportanceIcon importance={sev} className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div
            className={`text-sm font-semibold truncate ${
              resolved ? "text-ink-600" : "text-ink-900"
            }`}
          >
            {task.title}
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {!resolved && (
              <span
                className={`inline-block rounded px-1.5 py-0.5 border text-[9px] uppercase tracking-wider font-semibold ${sevClass}`}
              >
                {sev}
              </span>
            )}
            <span
              className={`inline-block rounded px-1.5 py-0.5 border text-[9px] uppercase tracking-wider font-semibold ${statusClass}`}
            >
              {statusLabel}
            </span>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="btn-outline text-[11px] !px-2.5 !py-1 whitespace-nowrap shrink-0"
        onClick={() => navigate(`/employee/tasks?focus=${encodeURIComponent(task.id)}`)}
      >
        View
      </button>
    </li>
  );
}

// Activities tied to a single contact (client or prospect). Shows the
// open queue at the top, a collapsible history of resolved/past
// activities below it, and a "+ New activity" button pinned at the
// bottom. Shared by the client + prospect profiles. Spans the full
// grid width so it has room for the history feed.
export function ContactActivitiesCard({
  title,
  openActivities,
  resolvedActivities = [],
  emptyHint,
  onCreate,
  className,
}: {
  title: string;
  openActivities: import("@/types").Task[];
  resolvedActivities?: import("@/types").Task[];
  emptyHint: string;
  onCreate: () => void;
  // Optional extra grid classes from the caller (e.g. lg:row-span-2
  // so the card's bottom lines up with neighbouring cards).
  className?: string;
}) {
  const hasOpen = openActivities.length > 0;
  const hasResolved = resolvedActivities.length > 0;
  // Collapsed by default — the open queue is what matters day to day;
  // history expands on demand.
  const [showResolved, setShowResolved] = useState(false);
  return (
    <Card
      className={`flex flex-col ${hasOpen ? "border-indigo-200 bg-indigo-50/30" : ""} ${
        className ?? ""
      }`}
    >
      <CardHeader
        title={hasOpen ? `${title} · ${openActivities.length}` : title}
        subtitle="Open work up top, resolved history below. Click View to jump into any activity in the Activity Center."
      />
      {!hasOpen ? (
        <div className="text-sm text-ink-400 py-1">{emptyHint}</div>
      ) : (
        <ul className="divide-y divide-indigo-100 -mt-1">
          {openActivities.map((t) => (
            <ActivityRow key={t.id} task={t} />
          ))}
        </ul>
      )}

      {hasResolved && (
        <div className="mt-4 pt-3 border-t border-ink-100">
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
              Resolved activities · {resolvedActivities.length}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-ink-500">
              {showResolved ? "Hide" : "Show"}
              {showResolved ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </span>
          </button>
          {showResolved && (
            <ul
              className={`divide-y divide-ink-100 mt-1 ${
                resolvedActivities.length > 5 ? "max-h-72 dropdown-scroll-y" : ""
              }`}
            >
              {resolvedActivities.map((t) => (
                <ActivityRow key={t.id} task={t} resolved />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-ink-100">
        <Button variant="gold" size="sm" fullWidth onClick={onCreate}>
          <Plus className="h-4 w-4" /> New activity
        </Button>
      </div>
    </Card>
  );
}

// =====================================================================
// AI suggestions: what's still missing.
//
// The AI diffs the doc set carriers usually expect for each asset
// the customer owns against what's actually been uploaded. The
// agent gets a per-row "Upload now" CTA that pre-selects the
// missing type on the uploader directly below.
// =====================================================================

function AcordDocumentsAiPanel({
  customerId,
  tenantId,
  uploadedById,
  onFilled,
}: {
  customerId: string;
  tenantId: string;
  uploadedById: string;
  onFilled: () => void;
}) {
  const templates = api.documents
    .listTemplates(tenantId)
    .filter((document) => {
      const text = `${document.fileName} ${document.documentName ?? ""}`.toLowerCase();
      return document.fileType === "application/pdf" && text.includes("acord");
    })
    .sort((a, b) =>
      (a.documentName || a.fileName).localeCompare(b.documentName || b.fileName, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  const completedAcordDocs = api.documents
    .listByEntity({ customerId })
    .filter((document) => String(document.type).startsWith("completed_acord"));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const query = searchText.trim().toLowerCase();
  const filteredTemplates = query
    ? templates.filter((template) => {
        const number =
          template.documentName?.match(/\bACORD\s*0?(\d{1,4})\b/i)?.[1] ??
          template.fileName.match(/\bacord[-_\s]?0?(\d{1,4})\b/i)?.[1] ??
          "";
        return `${template.documentName ?? ""} ${template.fileName} ${number}`
          .toLowerCase()
          .includes(query);
      })
    : templates;

  useEffect(() => {
    const available = new Set(templates.map((template) => template.id));
    setSelectedIds((current) => current.filter((id) => available.has(id)));
  }, [templates.map((template) => template.id).join("|")]);

  function toggle(templateId: string) {
    setNotice(null);
    setError(null);
    setSelectedIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId]
    );
  }

  function selectAll() {
    setNotice(null);
    setError(null);
    setSelectedIds(templates.map((template) => template.id));
  }

  async function autofillSelected() {
    if (selectedIds.length === 0) {
      setError("Select at least one ACORD document first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = api.documents.autofillAcordForCustomer({
        tenantId,
        customerId,
        uploadedById,
        selectedAcordTemplateIds: selectedIds,
      });
      if (!result) {
        setError("The selected ACORD documents could not be prepared.");
        return;
      }
      setNotice(
        `${result.documents.length} completed ACORD PDF${
          result.documents.length === 1 ? "" : "s"
        } saved to this client's Documents.`
      );
      onFilled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-md border border-gold-100 bg-gold-50/30">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gold-800">
            <Sparkles className="h-3 w-3" /> ACORD AI autofill
          </span>
          <span className="mt-1 block truncate text-xs text-ink-600">
            {templates.length} embedded ACORD template{templates.length === 1 ? "" : "s"} -{" "}
            {completedAcordDocs.length} completed PDF{completedAcordDocs.length === 1 ? "" : "s"} on file
            {selectedIds.length > 0 ? ` - ${selectedIds.length} selected` : ""}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="btn-gold text-xs"
              onClick={autofillSelected}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Autofilling
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" /> Autofill
                </>
              )}
            </button>
          )}
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide" : "Choose forms"}
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-gold-100 px-3 py-3">
          {templates.length === 0 ? (
            <div className="rounded-md border border-dashed border-gold-200 bg-white/70 px-3 py-3 text-xs text-ink-500">
              No ACORD templates are available in the agency document library.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[16rem] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                  <input
                    className="input min-h-9 pl-8 text-sm"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder="Search ACORD forms..."
                    aria-label="Search ACORD forms"
                  />
                </div>
                <button type="button" className="btn-outline text-xs" onClick={selectAll}>
                  Select all
                </button>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => {
                    setSelectedIds([]);
                    setNotice(null);
                    setError(null);
                  }}
                  disabled={selectedIds.length === 0}
                >
                  Clear
                </button>
              </div>

              <div className="mt-3 max-h-80 overflow-y-auto pr-1 dropdown-scroll-y">
                <div className="grid gap-2 md:grid-cols-2">
                  {filteredTemplates.map((template) => {
                    const selected = selectedIds.includes(template.id);
                    return (
                      <button
                        key={template.id}
                        type="button"
                        className={`flex min-h-14 items-center gap-2 rounded-md border px-3 py-2 text-left transition ${
                          selected
                            ? "border-gold-400 bg-white shadow-sm"
                            : "border-gold-100 bg-white/70 hover:border-gold-300"
                        }`}
                        onClick={() => toggle(template.id)}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            selected ? "border-gold-600 bg-gold-600 text-white" : "border-ink-300 bg-white"
                          }`}
                        >
                          {selected && <CheckCircle2 className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink-900">
                            {template.documentName || template.fileName}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-ink-500">
                            {template.fileName}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {filteredTemplates.length === 0 && (
                <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-white px-3 py-4 text-center text-sm text-ink-500">
                  No matching ACORD forms.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {notice && (
        <div className="mx-3 mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="mx-3 mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}
    </div>
  );
}

function MissingDocsAi({
  customerId,
  tenantId,
  uploadedById,
  uploaderOpen,
  onUploaderOpenChange,
  onUploaded,
}: {
  customerId: string;
  tenantId: string;
  uploadedById: string;
  uploaderOpen: boolean;
  onUploaderOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState<{
    type: string;
    label: string;
    assetId: string;
    policyId?: string;
  } | null>(null);
  const [needsOpen, setNeedsOpen] = useState(false);
  const groups = api.documents.suggestMissingForCustomer(customerId);
  const missingCount = groups.reduce((total, group) => total + group.missing.length, 0);

  return (
    <div className="space-y-3 mb-3">
      {groups.length > 0 && (
        <div className="rounded-md border border-violet-100 bg-violet-50/70">
          <div className="flex items-center gap-1.5 px-3 pt-3 text-[11px] uppercase tracking-wider text-violet-700 font-semibold">
            <Sparkles className="h-3 w-3" /> AI — documents this client still needs
          </div>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-violet-800"
            onClick={() => setNeedsOpen((open) => !open)}
          >
            <span>
              {missingCount} item{missingCount === 1 ? "" : "s"} across {groups.length} policy area
              {groups.length === 1 ? "" : "s"}
            </span>
            {needsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {needsOpen && (
          <div className="space-y-3 border-t border-violet-100 px-3 py-3">
            {groups.map((g) => {
              const policy = g.policyId ? api.policies.get(g.policyId) : undefined;
              const carrier = policy?.carrierId ? api.carriers.get(policy.carrierId) : undefined;
              return (
              <div key={g.policyId ?? g.assetId}>
                <div className="text-xs text-violet-900 font-medium">
                  {policy ? fmt.policyRef(policy) : "No policy number on file"}{" "}
                  <span className="text-violet-600 font-normal">
                    - {g.assetLabel} ({api.helpers.assetTypeLabel(g.assetType)})
                    {carrier ? ` - ${carrier.name}` : ""}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {g.missing.map((m) => (
                    <li key={m.type} className="flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <span className="font-medium text-violet-900">{m.label}</span>
                        <div className="text-violet-700">{m.reason}</div>
                      </div>
                      <button
                        type="button"
                        className="btn-outline text-[11px] shrink-0"
                        onClick={() =>
                          setPickerOpen({
                            type: m.type,
                            label: m.label,
                            assetId: g.assetId,
                            policyId: g.policyId,
                          })
                        }
                      >
                        Upload now
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              );
            })}
          </div>
          )}
        </div>
      )}
      <div id="client-doc-uploader" className="rounded-md border border-ink-100 bg-ink-50/40">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onUploaderOpenChange(!uploaderOpen)}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-600">
              <FileText className="h-3 w-3" /> Upload center
            </span>
            <span className="mt-1 block text-xs text-ink-500">
              Add client, policy, appraisal, inspection, or proof documents.
            </span>
          </button>
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => onUploaderOpenChange(!uploaderOpen)}
          >
            {uploaderOpen ? "Hide" : "Upload document"}
            {uploaderOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
        {uploaderOpen && (
          <div className="border-t border-ink-100 bg-white px-3 py-3">
            <DocumentUploader
              tenantId={tenantId}
              uploadedById={uploadedById}
              customerId={customerId}
              showPolicySelector
              onUploaded={onUploaded}
            />
          </div>
        )}
      </div>
      <UploadPickerModal
        open={pickerOpen != null}
        onClose={() => setPickerOpen(null)}
        target={pickerOpen}
        tenantId={tenantId}
        customerId={customerId}
        uploadedById={uploadedById}
        onApplied={() => {
          setPickerOpen(null);
          onUploaded();
        }}
      />
    </div>
  );
}

// =====================================================================
// Filled-template preview. Lets the agent pick one of the agency's
// templates / forms and see it rendered as if filled in with this
// client's details (insured info, policies, assets, agent of record).
// They can print / save-as-PDF the preview or save a copy onto the
// client's Documents card.
// =====================================================================

function FilledTemplatePreviewModal({
  open,
  onClose,
  tenantId,
  customerId,
  uploadedById,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  customerId: string;
  uploadedById: string;
  onSaved: () => void;
}) {
  const templates = api.documents.listTemplates(tenantId);
  const [tplId, setTplId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) setTplId((cur) => cur ?? templates[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;

  const tpl = templates.find((t) => t.id === tplId) ?? null;
  const customer = api.customers.get(customerId);
  const policies = api.policies.listByCustomer(customerId);
  const assets = api.assets.listByCustomer(customerId);
  const agency = api.agencies.get(tenantId);
  const agentName = customer?.assignedAgentId
    ? api.users.get(customer.assignedAgentId)?.name ?? "—"
    : "Unassigned";

  function printPreview() {
    const node = previewRef.current;
    if (!node) return;
    const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
    if (!w) {
      alert("Pop-up blocked. Allow pop-ups to print / save the preview.");
      return;
    }
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"/><title>${
        tpl?.fileName ?? "Template"
      }</title><style>
        body{font-family:Georgia,serif;color:#1f2430;margin:36px;line-height:1.5;}
        h1{font-size:20px;margin:0 0 4px;} h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#b8923f;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin:18px 0 8px;}
        table{width:100%;border-collapse:collapse;font-size:12.5px;} th{text-align:left;color:#6b7280;font-weight:600;padding:3px 8px 3px 0;vertical-align:top;}
        td{padding:3px 0;}
        .grid th{background:#f6f3ec;font-size:10.5px;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid #e5e7eb;}
        .grid td{padding:6px 8px;border-bottom:1px solid #eef0f3;}
        .sig{margin-top:36px;display:flex;gap:48px;} .sig div{flex:1;border-top:1px solid #1f2430;padding-top:4px;font-size:11px;color:#6b7280;}
      </style></head><body>${node.innerHTML}</body></html>`
    );
    w.document.close();
    w.onload = () => {
      w.focus();
      w.print();
    };
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* closed */
      }
    }, 400);
  }

  function saveCopy() {
    if (!tpl) return;
    api.documents.applyTemplate(tpl.id, {
      customerId,
      type: "agency_template",
      uploadedById,
    });
    onSaved();
    onClose();
  }

  const today = fmt.date(new Date().toISOString());

  return (
    <Modal open onClose={onClose} title="Preview filled template" size="lg">
      <div className="space-y-4">
        {templates.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-4 py-6 text-sm text-ink-500 text-center">
            No agency templates yet. A manager can upload reusable forms under{" "}
            <Link to="/employee/documents" className="text-gold-700 hover:underline">
              Document review → Agency document library
            </Link>
            .
          </div>
        ) : (
          <>
            <div>
              <label className="label">Template</label>
              <select
                className="input text-sm"
                value={tplId ?? ""}
                onChange={(e) => setTplId(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.fileName}
                  </option>
                ))}
              </select>
            </div>

            {/* Rendered "filled in" preview */}
            <div
              ref={previewRef}
              className="rounded-lg border border-ink-200 bg-white p-6 max-h-[55vh] overflow-y-auto"
            >
              <h1 className="font-display text-xl">{tpl?.fileName ?? "Template"}</h1>
              <p className="text-xs text-ink-500 mb-2">
                {agency?.name ?? "Agency"} · Prepared {today}
              </p>

              <h2 className="text-[11px] uppercase tracking-wider text-gold-700 border-b border-ink-100 pb-1 mt-4 mb-2">
                Insured information
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  <PreviewRow label="Name" value={customer?.name} />
                  <PreviewRow label="Client code" value={api.helpers.clientCodeFor(customer)} />
                  <PreviewRow label="Email" value={customer?.email} />
                  <PreviewRow label="Phone" value={customer?.phone ?? "—"} />
                  <PreviewRow label="Mailing address" value={customer?.mailingAddress ?? "—"} />
                  <PreviewRow label="Agent of record" value={agentName} />
                </tbody>
              </table>

              <h2 className="text-[11px] uppercase tracking-wider text-gold-700 border-b border-ink-100 pb-1 mt-5 mb-2">
                Policies
              </h2>
              {policies.length === 0 ? (
                <p className="text-xs text-ink-400">No policies on file.</p>
              ) : (
                <table className="grid w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-100">
                      <th className="py-1.5 pr-3">Policy</th>
                      <th className="py-1.5 pr-3">Carrier</th>
                      <th className="py-1.5 pr-3">Line</th>
                      <th className="py-1.5 pr-3">Premium</th>
                      <th className="py-1.5">Renews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((p) => (
                      <tr key={p.id} className="border-b border-ink-50">
                        <td className="py-1.5 pr-3 font-mono">{fmt.policyRef(p)}</td>
                        <td className="py-1.5 pr-3">{api.carriers.get(p.carrierId)?.name ?? "—"}</td>
                        <td className="py-1.5 pr-3">{api.helpers.departmentLabel(p)}</td>
                        <td className="py-1.5 pr-3">
                          {fmt.money(p.finalPremium ?? p.premiumEstimate ?? 0)}
                        </td>
                        <td className="py-1.5">{fmt.date(p.renewalDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h2 className="text-[11px] uppercase tracking-wider text-gold-700 border-b border-ink-100 pb-1 mt-5 mb-2">
                Scheduled assets
              </h2>
              {assets.length === 0 ? (
                <p className="text-xs text-ink-400">No assets on file.</p>
              ) : (
                <table className="grid w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-100">
                      <th className="py-1.5 pr-3">Asset</th>
                      <th className="py-1.5 pr-3">Type</th>
                      <th className="py-1.5">Est. value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.id} className="border-b border-ink-50">
                        <td className="py-1.5 pr-3">{a.label}</td>
                        <td className="py-1.5 pr-3">{api.helpers.assetTypeLabel(a.type)}</td>
                        <td className="py-1.5">
                          {a.estimatedValue ? fmt.money(a.estimatedValue) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="sig mt-9 flex gap-12">
                <div className="flex-1 border-t border-ink-800 pt-1 text-[11px] text-ink-500">
                  Client signature — {customer?.name} · Date
                </div>
                <div className="flex-1 border-t border-ink-800 pt-1 text-[11px] text-ink-500">
                  Agent — {agentName} · Date
                </div>
              </div>
            </div>

            <p className="text-[11px] text-ink-400">
              Fields are merged from this client's record, populated into the agency form, and rendered to PDF.
            </p>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Close
          </button>
          {templates.length > 0 && (
            <>
              <button type="button" className="btn-outline text-sm" onClick={printPreview}>
                <Download className="h-3.5 w-3.5" /> Print / Save as PDF
              </button>
              <button type="button" className="btn-gold text-sm" onClick={saveCopy}>
                <Send className="h-3.5 w-3.5" /> Save copy to documents
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PreviewRow({ label, value }: { label: string; value?: string }) {
  return (
    <tr>
      <th className="text-left text-ink-500 font-medium w-44 align-top py-1 pr-3">{label}</th>
      <td className="text-ink-900 py-1">{value || "—"}</td>
    </tr>
  );
}

// =====================================================================
// Upload picker modal. Two paths to satisfy a missing-doc gap:
//
//   1. Send an agency template — pulls from the manager's
//      /employee/documents → "Agency templates & forms" library,
//      filtered to templates the agent can plausibly send for
//      this doc type. Clicking "Send to client" clones the
//      template into the client's Documents card as the chosen
//      type (customer-visible).
//
//   2. Upload a new file — the existing DocumentUploader with the
//      AI-suggested type pre-selected. Same outcome (a new doc
//      attached to this customer/asset/policy) but the agent
//      provides the bytes.
// =====================================================================

function UploadPickerModal({
  open,
  onClose,
  target,
  tenantId,
  customerId,
  uploadedById,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  target: { type: string; label: string; assetId: string; policyId?: string } | null;
  tenantId: string;
  customerId: string;
  uploadedById: string;
  onApplied: () => void;
}) {
  const [templatePreview, setTemplatePreview] = useState<{
    templateId: string;
    fileName: string;
    templateFields: TemplateFieldMap;
  } | null>(null);
  if (!target) return null;
  const activeTarget = target;
  const templates = api.documents.listTemplates(tenantId);
  // We naively offer every agency template here — managers
  // upload these specifically because they're forms the agent
  // sends to clients. A filename-match heuristic surfaces the
  // most relevant template first.
  const slug = activeTarget.type.replace(/_/g, " ").toLowerCase();
  const matched = templates
    .map((t) => ({
      tpl: t,
      relevance: t.fileName.toLowerCase().includes(slug) ? 1 : 0,
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .map((m) => m.tpl);

  function fieldsForTemplate(fileName: string): TemplateFieldMap {
    const agency = api.agencies.get(tenantId);
    const customer = api.customers.get(customerId);
    const asset = api.assets.get(activeTarget.assetId);
    const policy = activeTarget.policyId ? api.policies.get(activeTarget.policyId) : undefined;
    const carrier = policy?.carrierId ? api.carriers.get(policy.carrierId) : undefined;
    return buildDocumentTemplateFields({
      fileName,
      documentTypeLabel: documentTypeLabelForTemplate(activeTarget.type),
      visibilityLabel: "customer visible",
      statusLabel: "approved",
      agencyName: agency?.name,
      customerName: customer?.name,
      customerEmail: customer?.email,
      customerPhone: customer?.phone,
      assetLabel: asset?.label,
      assetValue: asset?.estimatedValue ? fmt.money(asset.estimatedValue) : undefined,
      policyNumber: policy?.policyNumber,
      carrierName: carrier?.name,
      premium: policy ? fmt.money(policy.finalPremium ?? policy.premiumEstimate ?? 0) : undefined,
      effectiveDate: policy?.effectiveDate ? fmt.date(policy.effectiveDate) : undefined,
      renewalDate: policy?.renewalDate ? fmt.date(policy.renewalDate) : undefined,
    });
  }

  function previewTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setTemplatePreview({
      templateId,
      fileName: template.fileName,
      templateFields: fieldsForTemplate(template.fileName),
    });
  }

  function sendTemplate() {
    if (!templatePreview) return;
    api.documents.applyTemplate(templatePreview.templateId, {
      customerId,
      assetId: activeTarget.assetId,
      policyId: activeTarget.policyId,
      type: activeTarget.type,
      uploadedById,
      fileName: templatePreview.fileName,
      templateFields: templatePreview.templateFields,
    });
    setTemplatePreview(null);
    onApplied();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Upload "${activeTarget.label}"`} size="lg">
      <div className="space-y-5">
        <p className="text-sm text-ink-600">
          Send one of your agency's templates to the client, or upload a new file directly. Either
          way it lands on this client's Documents with the right type tagged.
        </p>

        {/* Agency templates */}
        <section>
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-2 flex items-center gap-1.5">
            <FileText className="h-3 w-3" /> Agency templates ({matched.length})
          </div>
          {matched.length === 0 ? (
            <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-4 py-3 text-xs text-ink-500">
              No agency templates yet. A manager can upload reusable templates under{" "}
              <Link to="/employee/documents" className="text-gold-700 hover:underline">
                Document review → Agency templates & forms
              </Link>
              .
            </div>
          ) : (
            <ul className="divide-y divide-ink-100 rounded-md border border-ink-100">
              {matched.map((t) => (
                <li key={t.id} className="px-3 py-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-4 w-4 text-ink-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{t.fileName}</div>
                      <div className="text-[11px] text-ink-500">
                        Uploaded {fmt.date(t.uploadedAt)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => previewTemplate(t.id)}
                  >
                    <FileText className="h-3.5 w-3.5" /> Preview
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="text-[11px] text-ink-400 text-center">— or —</div>

        {/* AI-fill a template from source files */}
        <AiFillSection
          templates={matched}
          tenantId={tenantId}
          customerId={customerId}
          uploadedById={uploadedById}
          assetId={activeTarget.assetId}
          policyId={activeTarget.policyId}
          type={activeTarget.type}
          onFilled={onApplied}
        />

        <div className="text-[11px] text-ink-400 text-center">— or —</div>

        {/* Direct upload — uses the existing component */}
        <section>
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
            Upload a file directly
          </div>
          <DocumentUploader
            tenantId={tenantId}
            uploadedById={uploadedById}
            customerId={customerId}
            assetId={activeTarget.assetId}
            policyId={activeTarget.policyId}
            initialType={activeTarget.type}
            onUploaded={onApplied}
          />
        </section>
        <TemplateDocumentPreviewModal
          preview={templatePreview}
          title="Preview template before sending"
          confirmLabel="Confirm and save to client documents"
          onClose={() => setTemplatePreview(null)}
          onConfirm={sendTemplate}
          onChange={setTemplatePreview}
        />
      </div>
    </Modal>
  );
}

function TemplateDocumentPreviewModal({
  preview,
  title,
  confirmLabel,
  onClose,
  onConfirm,
  onChange,
}: {
  preview: {
    templateId: string;
    fileName: string;
    templateFields: TemplateFieldMap;
  } | null;
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  onChange: (preview: {
    templateId: string;
    fileName: string;
    templateFields: TemplateFieldMap;
  } | null) => void;
}) {
  if (!preview) return null;
  return (
    <Modal open onClose={onClose} title={title} size="xl">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Nothing is saved yet. Review the output file name and every merged field before
          confirming.
        </p>
        <div className="rounded-md border border-ink-200 bg-ink-50 p-3">
          <label className="label">Output file name</label>
          <input
            className="input text-sm font-mono"
            value={preview.fileName}
            onChange={(event) => {
              const fileName = event.target.value;
              onChange({
                ...preview,
                fileName,
                templateFields: { ...preview.templateFields, "File name": fileName },
              });
            }}
          />
        </div>
        <DocumentTemplateFieldsEditor
          fields={preview.templateFields}
          onChange={(templateFields) => onChange({ ...preview, templateFields })}
          title="Editable template fields"
        />
        <div className="flex items-center justify-end gap-2 border-t border-ink-100 pt-3">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-gold text-sm" onClick={onConfirm}>
            <Send className="h-3.5 w-3.5" /> {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// AI-fill section. Agent picks one of the agency templates,
// drops in any number of source files (e.g. existing dec page,
// inspection report, ID), and the AI extracts data from the
// sources, fills the template, and uploads the result as a new
// customer-visible doc tagged with the AI-suggested type.
//
// In production the file picker is wired to the document service
// + an LLM extraction pipeline. The local record stores inputs +
// synthesizes the output document so the audit trail is
// realistic and the UX is testable end-to-end.
// =====================================================================

function AiFillSection({
  templates,
  tenantId,
  customerId,
  uploadedById,
  assetId,
  policyId,
  type,
  onFilled,
}: {
  templates: { id: string; fileName: string; uploadedAt: string }[];
  tenantId: string;
  customerId: string;
  uploadedById: string;
  assetId?: string;
  policyId?: string;
  type: string;
  onFilled: () => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [files, setFiles] = useState<{ fileName: string; fileType?: string }[]>([]);
  const [preview, setPreview] = useState<{
    templateId: string;
    fileName: string;
    templateFields: TemplateFieldMap;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(fl: File[]) {
    if (fl.length === 0) return;
    const next = fl.map((f) => ({
      fileName: f.name,
      fileType: f.type || "application/octet-stream",
    }));
    setFiles((s) => [...s, ...next]);
  }

  function outputNameFor(templateFileName: string): string {
    const customer = api.customers.get(customerId);
    const stamp = new Date();
    const date =
      stamp.getFullYear().toString() +
      String(stamp.getMonth() + 1).padStart(2, "0") +
      String(stamp.getDate()).padStart(2, "0");
    const customerSlug = (customer?.name ?? "Client")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "");
    const base = templateFileName.replace(/\.[^.]+$/, "");
    const ext = templateFileName.match(/\.[^.]+$/)?.[0] ?? ".pdf";
    return `${base}-${customerSlug}-${date}-AI-filled${ext}`;
  }

  function fieldsForAiFill(fileName: string): TemplateFieldMap {
    const agency = api.agencies.get(tenantId);
    const customer = api.customers.get(customerId);
    const asset = assetId ? api.assets.get(assetId) : undefined;
    const policy = policyId ? api.policies.get(policyId) : undefined;
    const carrier = policy?.carrierId ? api.carriers.get(policy.carrierId) : undefined;
    return buildDocumentTemplateFields({
      fileName,
      documentTypeLabel: documentTypeLabelForTemplate(type),
      visibilityLabel: "customer visible",
      statusLabel: "approved",
      agencyName: agency?.name,
      customerName: customer?.name,
      customerEmail: customer?.email,
      customerPhone: customer?.phone,
      assetLabel: asset?.label,
      assetValue: asset?.estimatedValue ? fmt.money(asset.estimatedValue) : undefined,
      policyNumber: policy?.policyNumber,
      carrierName: carrier?.name,
      premium: policy ? fmt.money(policy.finalPremium ?? policy.premiumEstimate ?? 0) : undefined,
      effectiveDate: policy?.effectiveDate ? fmt.date(policy.effectiveDate) : undefined,
      renewalDate: policy?.renewalDate ? fmt.date(policy.renewalDate) : undefined,
      sourceFiles: files.map((file) => file.fileName),
    });
  }

  async function previewFill() {
    if (!pickedId) {
      setError("Pick a template first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // Faux AI latency so the busy state is visible — production
      // is a real LLM extraction round-trip.
      await new Promise((r) => setTimeout(r, 600));
      const template = templates.find((t) => t.id === pickedId);
      if (!template) {
        setError("Pick a template first.");
        return;
      }
      const fileName = outputNameFor(template.fileName);
      setPreview({
        templateId: pickedId,
        fileName,
        templateFields: fieldsForAiFill(fileName),
      });
    } finally {
      setBusy(false);
    }
  }

  function confirmFill() {
    if (!preview) return;
    api.documents.fillTemplateWithAi({
      templateId: preview.templateId,
      sourceFiles: files,
      customerId,
      assetId,
      policyId,
      type,
      uploadedById,
      outputFileName: preview.fileName,
      templateFields: preview.templateFields,
    });
    setPreview(null);
    onFilled();
  }

  return (
    <section>
      <div className="text-xs uppercase tracking-wider text-ink-500 mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-violet-500" /> AI-fill a template
      </div>
      <p className="text-[11px] text-ink-500 mb-3 leading-snug">
        Pick an agency template and attach the source files the AI should read (dec page,
        inspection report, customer's IDs, etc.). The AI extracts the relevant fields, fills the
        template, and uploads it to this client.
      </p>

      {/* Template radio picker */}
      {templates.length === 0 ? (
        <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-3 py-2 text-[11px] text-ink-500">
          No templates yet — manager uploads them under Document review.
        </div>
      ) : (
        <ul className="rounded-md border border-ink-100 divide-y divide-ink-100 mb-3">
          {templates.map((t) => (
            <li key={t.id} className="px-3 py-2">
              <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="ai-fill-template"
                  value={t.id}
                  checked={pickedId === t.id}
                  onChange={() => setPickedId(t.id)}
                />
                <FileText className="h-3.5 w-3.5 text-ink-400" />
                <span className="font-medium truncate flex-1">{t.fileName}</span>
                <span className="text-[11px] text-ink-400">{fmt.date(t.uploadedAt)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {/* Source-file uploader */}
      <FileDropZone
        title={files.length === 0 ? "Attach source files for the AI to read" : "Add more source files"}
        help="Drop PDFs, images, documents, or paste a copied screenshot. Files are stored before AI extraction so the source record stays attached to the client."
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt"
        multiple
        compact
        icon="ai"
        onFiles={addFiles}
      />
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-ink-50 border border-ink-100"
            >
              <span className="truncate">
                <FileText className="h-3 w-3 inline mr-1 text-ink-400" />
                {f.fileName}
              </span>
              <button
                type="button"
                className="text-ink-400 hover:text-rose-600 text-[11px]"
                onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-2 text-xs text-alert">{error}</div>}

      <button
        type="button"
        className="btn-primary text-xs mt-3"
        onClick={previewFill}
        disabled={busy || !pickedId}
      >
        {busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Filling with AI…
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" /> Preview AI-filled template
          </>
        )}
      </button>
      <TemplateDocumentPreviewModal
        preview={preview}
        title="Preview AI-filled template"
        confirmLabel="Confirm AI-filled upload"
        onClose={() => setPreview(null)}
        onConfirm={confirmFill}
        onChange={setPreview}
      />
    </section>
  );
}

// Collapsible wrapper around the client documents list. Renders
// nothing visible by default — just a header chip showing the
// document count and an Expand button. Tapping it reveals the
// existing DocumentList unmodified. Keeps the Documents card
// from dominating the page when a client has dozens of files.
function CollapsibleDocumentList({
  documents,
  policies,
  uploadedById,
  onChanged,
}: {
  documents: Document[];
  policies: Policy[];
  uploadedById?: string;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  function policyForDocument(document: Document): Policy | undefined {
    if (document.policyId) return api.policies.get(document.policyId);
    if (document.customerId && document.assetId) {
      return api.policies
        .listByCustomer(document.customerId)
        .find((policy) => policy.assetId === document.assetId);
    }
    return undefined;
  }

  function policyCurrentTermYear(policy?: Policy): number | undefined {
    const sourceDate = policy?.effectiveDate ?? policy?.renewalDate;
    if (!sourceDate) return undefined;
    const year = new Date(sourceDate).getUTCFullYear();
    if (!Number.isFinite(year)) return undefined;
    return policy?.effectiveDate ? year : year - 1;
  }

  function sourceTermYear(document: Document): number | undefined {
    return document.policyTermYear ?? policyCurrentTermYear(policyForDocument(document));
  }

  function latestTermYearForPolicy(policyId?: string): number | undefined {
    if (!policyId) return undefined;
    const policy = api.policies.get(policyId);
    return documents.reduce<number | undefined>((latest, document) => {
      const policy = policyForDocument(document);
      if (policy?.id !== policyId) return latest;
      const year = sourceTermYear(document);
      if (!year) return latest;
      return latest == null ? year : Math.max(latest, year);
    }, policyCurrentTermYear(policy));
  }

  function hasPublishedSuccessor(document: Document): boolean {
    const policy = policyForDocument(document);
    const documentYear = sourceTermYear(document);
    return documents.some((candidate) => {
      if (candidate.id === document.id || candidate.type !== document.type) return false;
      const candidatePolicy = policyForDocument(candidate);
      if (candidatePolicy?.id !== policy?.id) return false;
      const candidateYear = sourceTermYear(candidate);
      return (
        !!candidate.publishedAt &&
        candidate.status !== "rejected" &&
        (candidate.supersedesId === document.id ||
          (!!candidateYear && !!documentYear && candidateYear > documentYear))
      );
    });
  }

  function isCurrentTermDocument(document: Document): boolean {
    const policy = policyForDocument(document);
    if (hasPublishedSuccessor(document)) return false;
    if (!policy) return true;
    const year = sourceTermYear(document);
    const latestYear = latestTermYearForPolicy(policy.id);
    return !year || !latestYear || year >= latestYear;
  }

  const currentDocuments = documents.filter(isCurrentTermDocument);
  const groups = new Map<
    string,
    { key: string; title: string; subtitle: string; sortLabel: string; docs: Document[] }
  >();

  policies.forEach((policy) => {
    const carrier = policy.carrierId ? api.carriers.get(policy.carrierId) : undefined;
    const asset = policy.assetId ? api.assets.get(policy.assetId) : undefined;
    groups.set(policy.id, {
      key: policy.id,
      title: fmt.policyRef(policy),
      subtitle: `${carrier?.name ?? "Carrier pending"}${asset ? ` - ${asset.label}` : ""}`,
      sortLabel: policy.policyNumber ?? policy.id,
      docs: [],
    });
  });

  currentDocuments.forEach((document) => {
    const policy = policyForDocument(document);
    const carrier = policy?.carrierId ? api.carriers.get(policy.carrierId) : undefined;
    const asset = policy?.assetId
      ? api.assets.get(policy.assetId)
      : document.assetId
      ? api.assets.get(document.assetId)
      : undefined;
    const key = policy?.id ?? "client-level";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: policy ? fmt.policyRef(policy) : "Client-level documents",
        subtitle: policy
          ? `${carrier?.name ?? "Carrier pending"}${asset ? ` - ${asset.label}` : ""}`
          : "Documents not attached to a specific policy.",
        sortLabel: policy?.policyNumber ?? policy?.id ?? "zz-client",
        docs: [],
      });
    }
    groups.get(key)!.docs.push(document);
  });
  const groupEntries = Array.from(groups.values()).sort((a, b) =>
    a.sortLabel.localeCompare(b.sortLabel)
  );

  if (documents.length === 0 && policies.length === 0) {
    return <div className="text-sm text-ink-400">No documents on file yet.</div>;
  }
  if (currentDocuments.length === 0 && groupEntries.length === 0) {
    return (
      <div className="rounded-md border border-ink-100 bg-ink-50/50 px-3 py-3 text-sm text-ink-500">
        No current-term documents on file. Previous-term documents remain available from each
        policy detail page.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-ink-100 bg-ink-50/40 hover:bg-ink-50 text-sm"
      >
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-ink-500" />
          <span className="font-medium text-ink-800">
            {currentDocuments.length} current-term document{currentDocuments.length === 1 ? "" : "s"} on file
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-ink-500">
          {open ? "Hide" : "Show"}
          {open ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {open && (
        <div
          className={currentDocuments.length > 5 ? "max-h-[30rem] dropdown-scroll-y pr-1" : ""}
        >
          <div className="space-y-4">
            {groupEntries.map((group) => (
              <section key={group.key} className="rounded-md border border-ink-100 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold text-ink-900">{group.title}</div>
                    <div className="text-xs text-ink-500">{group.subtitle}</div>
                  </div>
                  <Badge tone="neutral">
                    {group.docs.length} file{group.docs.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="px-3">
                  {group.docs.length === 0 ? (
                    <div className="py-3 text-sm text-ink-400">
                      No current-term documents on file for this policy yet.
                    </div>
                  ) : (
                    <DocumentList
                      documents={group.docs}
                      uploadedById={uploadedById}
                      onChanged={onChanged}
                      showTermGroups={false}
                    />
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
