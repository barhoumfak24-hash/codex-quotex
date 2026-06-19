import { describe, expect, it } from "vitest";
import {
  splitIvansList,
  validateIvansConnectionDraft,
  type IvansConnectionDraft,
} from "../ivansConnection";

const completeDraft: IvansConnectionDraft = {
  enabled: true,
  method: "ivans_exchange",
  agencyAccount: "PCPC-IVANS",
  mailboxId: "PCPC-MAILBOX",
  receiverCode: "QUOTEX-PCPC",
  credentialReference: "secret://ivans/pcpc",
  lines: ["personal", "commercial"],
  feeds: ["policy", "renewal", "billing", "edocs"],
  tradingPartnerIds: ["CHUBB-NAIC-10052", "PURE-NAIC-13186"],
  fileFormats: ["acord_al3", "pdf_edoc"],
  pollingSchedule: "hourly",
  inboundPath: "ivans://exchange/pcpc/inbound",
  archivePath: "ivans://exchange/pcpc/archive",
  errorAlertEmails: ["downloads@palmcoastpc.example"],
  contactEmail: "downloads@palmcoastpc.example",
  contactPhone: "+1 (555) 312-0099",
  testFileReceivedAt: "2026-06-09T14:00",
  lastTestStatus: "passed",
  lastTestMessage: "Matched renewal test file.",
};

describe("IVANS connection validation", () => {
  it("splits comma, semicolon, and newline lists into unique values", () => {
    expect(splitIvansList("A, B\nA;C")).toEqual(["A", "B", "C"]);
  });

  it("marks a complete, tested configuration ready", () => {
    const result = validateIvansConnectionDraft(completeDraft);
    expect(result.ready).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.missing).toEqual([]);
  });

  it("keeps enabled configurations pending until a test file passes", () => {
    const result = validateIvansConnectionDraft({
      ...completeDraft,
      testFileReceivedAt: "",
      lastTestStatus: "not_tested",
    });
    expect(result.ready).toBe(false);
    expect(result.status).toBe("pending_setup");
    expect(result.missing).toContain("Passed IVANS test file received by Quotex");
  });

  it("marks failed test configurations as error", () => {
    const result = validateIvansConnectionDraft({
      ...completeDraft,
      lastTestStatus: "failed",
      lastTestMessage: "Carrier sender ID did not match this agency.",
    });
    expect(result.ready).toBe(false);
    expect(result.status).toBe("error");
  });

  it("requires routing, credentials, formats, alerts, and contact data", () => {
    const result = validateIvansConnectionDraft({
      ...completeDraft,
      agencyAccount: "",
      mailboxId: "",
      receiverCode: "",
      credentialReference: "",
      lines: [],
      feeds: [],
      tradingPartnerIds: [],
      fileFormats: [],
      errorAlertEmails: [],
      contactEmail: "",
    });
    expect(result.status).toBe("pending_setup");
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "IVANS agency account / Y-account",
        "IVANS mailbox ID",
        "Receiver / vendor code",
        "Secret-managed credential reference",
        "At least one line of business",
        "At least one download feed",
        "Authorized carrier sender IDs / NAIC codes",
        "Accepted file formats",
        "Failure alert recipient",
        "Agency download contact email",
      ])
    );
  });
});
