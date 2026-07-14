import { describe, expect, it } from "vitest";
import {
  CARRIER_PORTAL_PLAYBOOKS,
  CARRIER_RUNNER_FORBIDDEN_ACTIONS,
  CARRIER_RUNNER_STOP_CONDITIONS,
  carrierPortalRunnerStatus,
} from "../carrierPortalPlaybooks";
import { SEED_CARRIERS } from "../seed";

describe("carrier portal playbooks", () => {
  it("enriches every seeded carrier with an explicit portal playbook", () => {
    expect(SEED_CARRIERS.length).toBeGreaterThan(0);
    for (const carrier of SEED_CARRIERS) {
      expect(carrier.portalPlaybook, carrier.name).toBeTruthy();
      expect(CARRIER_PORTAL_PLAYBOOKS[carrier.id], carrier.name).toBeTruthy();
    }
  });

  it("never treats unsupported or unverified portals as runner-ready", () => {
    for (const carrier of SEED_CARRIERS) {
      const status = carrierPortalRunnerStatus(carrier);
      if (carrier.portalPlaybook?.status !== "configured") {
        expect(status.canAttempt, carrier.name).toBe(false);
      }
    }
  });

  it("keeps stop conditions and forbidden actions attached to configured runners", () => {
    for (const carrier of SEED_CARRIERS) {
      const playbook = carrier.portalPlaybook!;
      expect(playbook.stopConditions).toEqual(CARRIER_RUNNER_STOP_CONDITIONS);
      expect(playbook.forbiddenActions).toEqual(CARRIER_RUNNER_FORBIDDEN_ACTIONS);
      if (playbook.status === "configured") {
        expect(playbook.agentPortalUrl, carrier.name).toMatch(/^https:\/\//);
        expect(playbook.quotes.length, carrier.name).toBeGreaterThan(0);
        expect(playbook.documents.length, carrier.name).toBeGreaterThan(0);
        expect(playbook.claims.length, carrier.name).toBeGreaterThan(0);
      }
    }
  });
});
