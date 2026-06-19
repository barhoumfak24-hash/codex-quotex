// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { Document } from "@/types";
import { api } from "@/lib/api";
import { DocumentList } from "../DocumentList";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function makeDocument(overrides: Partial<Document>): Document {
  return {
    id: "doc",
    tenantId: "agency_palmcoast",
    uploadedById: "user_agent_pc",
    fileName: "Document.pdf",
    fileType: "application/pdf",
    type: "declarations_page",
    visibility: "customer_visible",
    status: "approved",
    storagePath: "s3://placeholder/document.pdf",
    uploadedAt: "2026-04-01T12:00:00.000Z",
    policyId: "policy_home",
    customerId: "customer_demo",
    ...overrides,
  };
}

describe("DocumentList renewal grouping", () => {
  it("moves an unlinked current-term document into previous documents when a later published same-type version exists", () => {
    const currentTerm = makeDocument({
      id: "doc_home_dec_current",
      fileName: "Whitford-Chubb-Masterpiece-Declarations.pdf",
    });
    const renewalTerm = makeDocument({
      id: "doc_home_dec_2027",
      fileName: "Whitford-Chubb-Masterpiece-Declarations-2027.pdf",
      policyTermYear: 2027,
      publishedAt: "2026-06-02T12:00:00.000Z",
      uploadedAt: "2026-06-02T12:00:00.000Z",
    });

    act(() => {
      root.render(
        <DocumentList
          documents={[currentTerm, renewalTerm]}
          collapsePreviousTerms
        />
      );
    });

    expect(container.textContent).toContain("Policy term 2027");
    expect(container.textContent).toContain("Show previous term documents (1)");
    expect(container.textContent).not.toContain("Current term");
  });

  it("moves all unflagged current-term policy documents into previous documents once that policy has a newer term", () => {
    const homePolicyYear = new Date(api.policies.get("policy_home")!.effectiveDate!).getFullYear();
    const booklet = makeDocument({
      id: "doc_home_booklet",
      fileName: "Chubb-Masterpiece-Homeowners-Booklet.pdf",
      type: "policy_booklet",
    });
    const inspection = makeDocument({
      id: "doc_home_inspection",
      fileName: "4-Point-Inspection-2024.pdf",
      type: "inspection_report",
    });
    const renewedDeclaration = makeDocument({
      id: "doc_home_dec_2027",
      fileName: "Whitford-Chubb-Masterpiece-Declarations-2027.pdf",
      type: "declarations_page",
      policyTermYear: 2027,
      publishedAt: "2026-06-02T12:00:00.000Z",
      uploadedAt: "2026-06-02T12:00:00.000Z",
    });

    act(() => {
      root.render(
        <DocumentList
          documents={[booklet, inspection, renewedDeclaration]}
          collapsePreviousTerms
        />
      );
    });

    expect(container.textContent).toContain("Policy term 2027");
    expect(container.textContent).toContain("Show previous term documents (2)");

    const toggle = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Show previous term documents (2)")
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain(`Policy term ${homePolicyYear}`);
    expect(container.textContent).toContain(`Term ${homePolicyYear}`);
    expect(container.textContent).toContain("Renewed Jun 2, 2026");
    expect(container.textContent).not.toContain("Current term");
  });

  it("labels regular current documents by the upload action instead of a generic publish action", () => {
    const currentDoc = makeDocument({
      id: "doc_home_current_upload",
      fileName: "Chubb-Masterpiece-Homeowners-Booklet.pdf",
      uploadedAt: "2026-04-04T12:00:00.000Z",
    });

    act(() => {
      root.render(<DocumentList documents={[currentDoc]} />);
    });

    expect(container.textContent).toContain("Uploaded Apr 4, 2026");
    expect(container.textContent).not.toContain("Published Apr 4, 2026");
  });

  it("uses the stored document change action when a document was edited", () => {
    const editedDoc = makeDocument({
      id: "doc_home_edited",
      fileName: "Whitford-Chubb-Masterpiece-Declarations.pdf",
      lastChangeAction: "edited",
      lastChangeAt: "2026-06-09T12:00:00.000Z",
    });

    act(() => {
      root.render(<DocumentList documents={[editedDoc]} />);
    });

    expect(container.textContent).toContain("Edited Jun 9, 2026");
  });

  it("does not move current-term documents because a different policy has a newer term", () => {
    const autoPolicyYear = new Date(api.policies.get("policy_vehicle")!.effectiveDate!).getFullYear();
    const autoBooklet = makeDocument({
      id: "doc_auto_booklet",
      policyId: "policy_vehicle",
      fileName: "PURE-Auto-Coverage-Forms.pdf",
      type: "policy_booklet",
    });
    const homeRenewedDeclaration = makeDocument({
      id: "doc_home_dec_2027",
      policyId: "policy_home",
      fileName: "Whitford-Chubb-Masterpiece-Declarations-2027.pdf",
      type: "declarations_page",
      policyTermYear: 2027,
      publishedAt: "2026-06-02T12:00:00.000Z",
      uploadedAt: "2026-06-02T12:00:00.000Z",
    });

    act(() => {
      root.render(
        <DocumentList
          documents={[autoBooklet, homeRenewedDeclaration]}
          collapsePreviousTerms
        />
      );
    });

    expect(container.textContent).toContain(`Policy term ${autoPolicyYear}`);
    expect(container.textContent).toContain(`Term ${autoPolicyYear}`);
    expect(container.textContent).not.toContain("Show previous documents");
  });
});

describe("DocumentList requirement controls", () => {
  it("keeps manager requirement buttons disabled while settings are locked", () => {
    const template = makeDocument({
      id: "doc_template_locked",
      policyId: undefined,
      customerId: undefined,
      type: "agency_template",
      fileName: "Client-Change-Request.pdf",
      required: false,
      customerEsignRequired: true,
      agentEsignRequired: false,
    });

    act(() => {
      root.render(
        <DocumentList
          documents={[template]}
          requirementControls
          canEditRequirements
          requirementsLocked
          esignRequirementControls
          canEditEsignRequirements
          esignRequirementsLocked
          showTermGroups={false}
        />
      );
    });

    const requiredButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Not required")
    ) as HTMLButtonElement;
    const customerButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Customer")
    ) as HTMLButtonElement;
    const agentButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Agent")
    ) as HTMLButtonElement;

    expect(requiredButton?.disabled).toBe(true);
    expect(customerButton?.disabled).toBe(true);
    expect(agentButton?.disabled).toBe(true);
  });

  it("unlocks a single row from the inline edit settings button", () => {
    const template = makeDocument({
      id: "doc_template_row_lock",
      policyId: undefined,
      customerId: undefined,
      type: "agency_template",
      fileName: "ACORD-025-Certificate-of-Liability.pdf",
      required: false,
      customerEsignRequired: false,
      agentEsignRequired: false,
    });

    act(() => {
      root.render(
        <DocumentList
          documents={[template]}
          requirementControls
          canEditRequirements
          esignRequirementControls
          canEditEsignRequirements
          perRowRequirementEditing
          showTermGroups={false}
        />
      );
    });

    const lockedRequiredButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Not required")
    ) as HTMLButtonElement;
    expect(lockedRequiredButton?.disabled).toBe(true);

    const editButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Edit settings")
    ) as HTMLButtonElement;
    expect(editButton).toBeTruthy();

    act(() => {
      editButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const unlockedRequiredButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Not required")
    ) as HTMLButtonElement;
    expect(unlockedRequiredButton?.disabled).toBe(false);
    expect(container.textContent).toContain("Save");
  });
});
