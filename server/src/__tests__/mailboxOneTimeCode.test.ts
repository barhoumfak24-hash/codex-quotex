import { describe, expect, it } from "vitest";
import {
  extractOneTimeCodes,
  messageMatchesCarrier,
} from "../services/mailboxOneTimeCode.js";

describe("mailbox one-time code extraction", () => {
  it("extracts a numeric code after a verification phrase", () => {
    expect(extractOneTimeCodes("Your verification code is 123456.")).toEqual(["123456"]);
  });

  it("extracts an alphanumeric one-time passcode", () => {
    expect(extractOneTimeCodes("Your one-time passcode: A1B2C3")).toEqual(["A1B2C3"]);
  });

  it("extracts a code immediately before the verification phrase", () => {
    expect(extractOneTimeCodes("Use 849201 as your login code.")).toEqual(["849201"]);
  });

  it("does not treat unrelated numbers as verification codes", () => {
    expect(
      extractOneTimeCodes(
        "Policy 123456 was updated. Contact support if you have questions about this policy."
      )
    ).toEqual([]);
  });

  it("selects only the code nearest the verification phrase", () => {
    expect(
      extractOneTimeCodes(
        "Order 778899 is ready. Your security code is 482731. It expires in 10 minutes."
      )
    ).toEqual(["482731"]);
  });
});

describe("mailbox carrier matching", () => {
  it("matches a carrier sender or subject", () => {
    expect(
      messageMatchesCarrier(
        { from: "security@travelers.com", subject: "Your portal verification code" },
        "Travelers",
        "https://agent.travelers.com/login"
      )
    ).toBe(true);
  });

  it("rejects mail from an unrelated provider", () => {
    expect(
      messageMatchesCarrier(
        { from: "alerts@example.com", subject: "Your portal verification code" },
        "Travelers",
        "https://agent.travelers.com/login"
      )
    ).toBe(false);
  });
});
