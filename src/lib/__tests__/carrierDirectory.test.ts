import { describe, expect, it } from "vitest";
import { CARRIER_DIRECTORY_PAYLOAD } from "../../../api/_carrierDirectoryPayload";
import { buildCarrierDirectory, domainMatchForUrl } from "../carrierDirectory";
import { SEED_CARRIERS } from "../seed";

describe("carrier directory", () => {
  it("exports every seeded carrier without requiring credentials or recipes", () => {
    const directory = buildCarrierDirectory(SEED_CARRIERS, "2026-07-04T00:00:00.000Z");

    expect(directory.count).toBe(SEED_CARRIERS.length);
    expect(directory.count).toBeGreaterThanOrEqual(40);
    expect(new Set(directory.carriers.map((carrier) => carrier.id)).size).toBe(SEED_CARRIERS.length);

    for (const carrier of SEED_CARRIERS) {
      const entry = directory.carriers.find((candidate) => candidate.id === carrier.id);
      expect(entry, carrier.name).toBeTruthy();
      expect(entry?.name).toBe(carrier.name);
      expect(entry?.preferredAssetTypes).toEqual(carrier.preferredAssetTypes);
      expect(entry?.stateAvailability).toEqual(carrier.stateAvailability);
    }
  });

  it("returns a launch URL for every carrier with any known carrier URL", () => {
    const directory = buildCarrierDirectory(SEED_CARRIERS, "2026-07-04T00:00:00.000Z");

    for (const carrier of directory.carriers) {
      expect(carrier.loginUrl, carrier.name).toMatch(/^https:\/\//);
      expect(carrier.domainMatch, carrier.name).toMatch(/^\*:\/\/\*\.[^/]+\/\*$/);
    }
  });

  it("derives Chrome host matches from launch URLs", () => {
    expect(domainMatchForUrl("https://www.chubb.com/us-en/agents-brokers.html")).toBe(
      "*://*.chubb.com/*"
    );
    expect(domainMatchForUrl("not a url")).toBeUndefined();
  });

  it("keeps the public API payload aligned with the seeded carrier catalog", () => {
    expect(CARRIER_DIRECTORY_PAYLOAD.count).toBe(SEED_CARRIERS.length);
    expect(CARRIER_DIRECTORY_PAYLOAD.carriers).toHaveLength(SEED_CARRIERS.length);
  });

  it("includes the agency-configured Insurance Agent Hub portal", () => {
    const carrier = SEED_CARRIERS.find(
      (candidate) => candidate.id === "carrier_insurance_agent_hub"
    );

    expect(carrier).toMatchObject({
      name: "Insurance Agent Hub",
      agentPortalUrl: "https://insurance-agent-hub.replit.app/sign-in",
      status: "active",
    });
  });
});
