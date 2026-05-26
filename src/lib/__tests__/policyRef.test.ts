import { describe, expect, it } from "vitest";
import { fmt } from "../format";

describe("fmt.policyRef", () => {
  it("renders 'Policy #X' when a policy with policyNumber is passed", () => {
    expect(fmt.policyRef({ policyNumber: "QC-12345" })).toBe("Policy #QC-12345");
  });

  it("falls back to a trimmed id when policyNumber is missing", () => {
    expect(fmt.policyRef({ id: "policy_abcdef123456" })).toBe("Policy #123456");
  });

  it("accepts a bare string and prefixes it", () => {
    expect(fmt.policyRef("QC-555")).toBe("Policy #QC-555");
  });

  it("renders 'Policy pending' for undefined / null / empty", () => {
    expect(fmt.policyRef(undefined)).toBe("Policy pending");
    expect(fmt.policyRef(null)).toBe("Policy pending");
    expect(fmt.policyRef("")).toBe("Policy pending");
    expect(fmt.policyRef({})).toBe("Policy pending");
  });

  it("trims whitespace-only policyNumber and falls through to id", () => {
    expect(fmt.policyRef({ policyNumber: "   ", id: "policy_xyz789" })).toBe("Policy #XYZ789");
  });
});