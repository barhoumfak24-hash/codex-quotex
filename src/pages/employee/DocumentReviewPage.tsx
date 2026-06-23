import { useState } from "react";
import { Search, X as XIcon } from "lucide-react";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { ElectronicSignatureCard } from "@/components/esign/ElectronicSignatureCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { DocumentList } from "@/components/ui/DocumentList";
import { DocumentUploader } from "@/components/ui/DocumentUploader";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import type { Document } from "@/types";

export function DocumentReviewPage() {
  const { agency } = useTenant();
  const { user, refreshUser } = useAuth();
  const [, setRev] = useState(0);
  const [templateSearch, setTemplateSearch] = useState("");

  if (!agency || !user) return null;

  const isManager = user.role === "manager";
  const liveUser = api.users.get(user.id) ?? user;
  const templates = api.documents.listTemplates(agency.id);
  const templateSearchQuery = templateSearch.trim().toLowerCase();
  const filteredTemplates = templates.filter(
    (document) =>
      !templateSearchQuery ||
      documentSearchText(document).toLowerCase().includes(templateSearchQuery)
  );
  const refresh = () => setRev((r) => r + 1);

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div>
        <h1 className="font-display text-3xl">Document review</h1>
        <p className="mt-1 text-sm text-ink-500">
          Manage reusable agency templates, forms, packets, and checklists.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Agency document template library"
          subtitle={
            isManager
              ? "Locked by row. Edit settings beside a template before changing required or e-sign rules."
              : "Upload and search blank templates. Managers control required and e-sign rules."
          }
        />

        <div className="mb-4 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs leading-relaxed text-gold-900">
          ACORD templates use the agency's uploaded PDF library. View opens the PDF inline and
          Download returns the actual PDF file.
        </div>

        {isManager && (
          <div className="mb-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Upload template
            </div>
            <DocumentUploader
              tenantId={agency.id}
              uploadedById={user.id}
              agencyId={agency.id}
              initialType="agency_template"
              hideVisibility
              showLineOfBusinessSelector
              onUploaded={refresh}
            />
          </div>
        )}

        <div className="relative mb-4 w-full">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-9 pr-10 text-sm"
            value={templateSearch}
            onChange={(event) => setTemplateSearch(event.target.value)}
            placeholder="Search templates by file, form name, line, type, required status..."
          />
          {templateSearch && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
              onClick={() => setTemplateSearch("")}
              aria-label="Clear template search"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {templateSearchQuery && (
          <div className="mb-3 text-xs text-ink-500">
            {filteredTemplates.length} template result
            {filteredTemplates.length === 1 ? "" : "s"} for "{templateSearch.trim()}"
          </div>
        )}

        {filteredTemplates.length === 0 ? (
          <div className="text-sm text-ink-400">
            {templateSearchQuery
              ? "No templates match this search."
              : "No reusable templates yet. Upload blank agency forms, packets, or checklists above."}
          </div>
        ) : (
          <DocumentList
            documents={filteredTemplates}
            uploadedById={user.id}
            onChanged={refresh}
            requirementControls
            canEditRequirements={isManager}
            esignRequirementControls
            canEditEsignRequirements={isManager}
            perRowRequirementEditing={isManager}
            showTermGroups={false}
            showLineOfBusinessLabels
          />
        )}
      </Card>

      <ElectronicSignatureCard
        user={liveUser}
        onSaved={() => {
          refreshUser();
          refresh();
        }}
      />
    </div>
  );
}

function documentSearchText(document: Document): string {
  const uploadedBy = api.users.get(document.uploadedById);
  const typeLabel = api.helpers.documentDisplayName({
    type: String(document.type),
    documentName: document.documentName,
  });
  const requirementText = document.required ? ["required"] : ["not required"];
  const signatureText = [
    document.customerEsignRequired ? "customer e-sign customer signature required" : "",
    document.agentEsignRequired ? "agent e-sign agent signature required" : "",
    document.customerEsignRequired && document.agentEsignRequired ? "both signatures required" : "",
  ];
  const lineLabel =
    document.lineOfBusiness === "personal"
      ? "personal lines"
      : document.lineOfBusiness === "commercial"
      ? "commercial lines"
      : "all staff all lines";

  return [
    document.fileName,
    document.documentName,
    typeLabel,
    String(document.type),
    document.fileType,
    document.status,
    fmt.titleCase(document.status),
    document.visibility,
    document.visibility.replace("_", " "),
    lineLabel,
    document.lineOfBusiness,
    ...Object.values(document.templateFields ?? {}),
    fmt.date(document.uploadedAt),
    fmt.dateTime(document.uploadedAt),
    fmt.relative(document.uploadedAt),
    uploadedBy?.name,
    ...requirementText,
    ...signatureText,
  ]
    .filter(Boolean)
    .join(" ");
}
