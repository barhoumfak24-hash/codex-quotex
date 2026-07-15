// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { Document } from "@/types";
import {
  DocumentViewerModal,
  FilledAcordDocumentPreview,
} from "../DocumentViewerModal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
  vi.restoreAllMocks();
});

function mockPdfFetch(fileName = "ACORD-125.pdf") {
  const bytes = readFileSync(`public/acord/${fileName}`);
  global.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })) as unknown as typeof fetch;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:filled-acord"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
}

async function flushAsyncEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function makeCompletedAcordDocument(): Document {
  return {
    id: "doc_completed_acord",
    tenantId: "agency_palmcoast",
    uploadedById: "user_agent_pc",
    fileName: "ACORD-125-Alexandra-Whitford-completed.pdf",
    fileType: "application/pdf",
    documentName: "Completed ACORD 125 - Commercial Insurance Application",
    type: "completed_acord_application",
    visibility: "employee_only",
    status: "approved",
    storagePath: "s3://placeholder/agency_palmcoast/completed-acord.pdf",
    uploadedAt: "2026-06-15T17:00:00.000Z",
    lastChangeAction: "uploaded",
    lastChangeAt: "2026-06-15T17:00:00.000Z",
    templateFields: {
      "ACORD form number": "ACORD 125",
      "Form name": "ACORD 125 - Commercial Insurance Application",
      "Source ACORD template ID": "doc_acord_agency_palmcoast_125",
      "Source ACORD file": "ACORD-125.pdf",
      "Completed packet type": "Carrier application",
      "Completed by": "Quotex AI fill workflow",
      "Completed field count": "5",
      "Missing field count": "0",
      "ACORD PDF fill status": "Filled from available agency, public-record, and questionnaire data",
      "Legal business name": "Alexandra Whitford Design LLC",
      "Description of operations": "Interior design and coastal property consulting",
      "Annual revenue": "$1,250,000",
      "Producer": "Palm Coast Private Client",
    },
  };
}

describe("DocumentViewerModal completed ACORD preview", () => {
  it("renders the native filled ACORD PDF instead of overlay boxes or a custom copy", async () => {
    mockPdfFetch();

    act(() => {
      root.render(
        <DocumentViewerModal
          document={makeCompletedAcordDocument()}
          open
          onClose={() => undefined}
        />
      );
    });
    await flushAsyncEffects();
    await flushAsyncEffects();

    expect(container.textContent).toContain("Original editable ACORD PDF filled through");
    expect(container.innerHTML).toContain("blob:filled-acord");
    expect(container.innerHTML).not.toContain("document-template-filled-pdf-value");
    expect(container.innerHTML).not.toContain("bg-white/70");
    expect(container.innerHTML).not.toContain("shadow-[0_0_0_1px");
    expect(container.textContent).not.toContain("Filled ACORD copy");
    expect(container.textContent).not.toContain("Template fields");
    expect(container.textContent).not.toContain("Completed field count");
    expect(container.textContent).not.toContain("Source ACORD template ID");
  });
});

const previewDocument: Document = {
  id: "completed_acord_preview",
  tenantId: "agency_test",
  uploadedById: "agent_test",
  fileName: "source-packet.pdf",
  fileType: "application/pdf",
  documentName: "Source packet",
  type: "completed_packet",
  visibility: "employee_only",
  status: "approved",
  storagePath: "",
  downloadUrl: "/acord/source-packet.pdf",
  uploadedAt: "2026-07-15T12:00:00.000Z",
};

describe("FilledAcordDocumentPreview missing-field overlays", () => {
  it("renders missing-field coordinates through DocumentTemplateFieldOverlay", () => {
    act(() => {
      root.render(
        <FilledAcordDocumentPreview
          document={{
            ...previewDocument,
            templateFieldLayout: [
              {
                label: "Named insured",
                page: 1,
                x: 10,
                y: 14,
                width: 38,
                height: 5,
                kind: "text",
                source: "detected",
                required: true,
              },
            ],
          }}
          fields={{ "Named insured": "" }}
          filledAcroPdf={{ status: "no_fields" }}
          highlightFieldLabels={["Named insured"]}
        />
      );
    });

    expect(container.textContent).toContain("Required missing ACORD fields");
    expect(container.querySelector('object[aria-label^="Original PDF"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Named insured: "]')).toBeTruthy();
  });

  it("shows the original PDF when field coordinates are unavailable", () => {
    act(() => {
      root.render(
        <FilledAcordDocumentPreview
          document={{ ...previewDocument, templateFieldLayout: [] }}
          fields={{ "Named insured": "" }}
          filledAcroPdf={{ status: "no_fields" }}
          highlightFieldLabels={["Named insured"]}
        />
      );
    });

    expect(container.textContent).toContain("does not include detected field positions");
    expect(container.querySelector('iframe[title^="Selected source-packet.pdf"]')).toBeTruthy();
  });
});
