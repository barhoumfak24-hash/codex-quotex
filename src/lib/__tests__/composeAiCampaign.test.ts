// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Manager-only "compose new AI campaign" launcher.
//
// Promotional campaign blasts are fire-and-forget: the campaign + a
// launch status event are recorded, but NO per-recipient message rows
// are written (so they never clutter a contact's Messages thread).
// Campaigns can target email + SMS at once and any combination of all
// clients / all prospects / hand-picked recipients.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("marketing.composeAiCampaign", () => {
  it("records a campaign but writes NO per-recipient messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const beforeCampaigns = api.marketing.listCampaigns(agency.id).length;
    const clientCount = api.customers.list(agency.id).filter((c) => !c.archived).length;
    const beforeMessages = api.marketing.listMessages(agency.id).length;

    const out = api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Spring portfolio review",
      channels: ["email", "sms"],
      brief: "Reminder that our annual portfolio review window opens next month.",
      includeAllClients: true,
    });

    expect(out.campaign.name).toBe("Spring portfolio review");
    expect(out.campaign.channels).toEqual(["email", "sms"]);
    expect(out.campaign.status).toBe("active");
    expect(api.marketing.listCampaigns(agency.id).length).toBe(beforeCampaigns + 1);
    expect(out.messageCount).toBe(clientCount);
    // The whole point: no message rows are created for the blast.
    expect(api.marketing.listMessages(agency.id).length).toBe(beforeMessages);
    expect(
      api.marketing.listMessages(agency.id).filter((m) => m.campaignId === out.campaign.id).length
    ).toBe(0);
  });

  it("combines all clients + all prospects in the recipient count", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const clientCount = api.customers.list(agency.id).filter((c) => !c.archived).length;
    const prospectCount = api.prospects
      .listByTenant(agency.id)
      .filter((p) => !p.archived).length;

    const out = api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Everyone blast",
      channels: ["sms"],
      brief: "Big news for the whole book.",
      includeAllClients: true,
      includeAllProspects: true,
    });
    expect(out.messageCount).toBe(clientCount + prospectCount);
  });

  it("hand-picked recipients are counted (deduped) when not using 'all'", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const prospect = api.prospects.listByTenant(agency.id)[0];

    const out = api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Hand-picked outreach",
      channels: ["email"],
      brief: "Specific touch.",
      selectedCustomerIds: customer ? [customer.id, customer.id] : [],
      selectedProspectIds: prospect ? [prospect.id] : [],
    });
    const expected = (customer ? 1 : 0) + (prospect ? 1 : 0);
    expect(out.messageCount).toBe(expected);
  });

  it("scheduling for the future marks the campaign scheduled (still no messages)", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const out = api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Hurricane prep checklist",
      channels: ["email", "sms"],
      brief: "Pre-storm checklist for coastal homeowners.",
      includeAllClients: true,
      scheduledFor: future,
    });
    expect(out.campaign.status).toBe("scheduled");
    expect(out.campaign.scheduledFor).toBe(future);
    expect(
      api.marketing.listMessages(agency.id).filter((m) => m.campaignId === out.campaign.id).length
    ).toBe(0);
  });

  it("recurrence is persisted on the campaign row", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const out = api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Weekly market digest",
      channels: ["sms"],
      brief: "Weekly insurance market roundup.",
      includeAllClients: true,
      recurrence: "weekly",
    });
    expect(out.campaign.recurrence).toBe("weekly");
    expect(out.campaign.status).toBe("active");
  });

  it("writes one launch status event noting channels + that sends aren't logged", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const out = api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Inspection reminder",
      channels: ["email", "sms"],
      brief: "Wind mitigation re-inspection due.",
      includeAllClients: true,
      attachments: [
        {
          fileName: "Inspection-Checklist.pdf",
          fileType: "application/pdf",
          description: "Inspection checklist",
        },
      ],
    });
    const launchEvent = db
      .list("statusEvents")
      .find(
        (e) =>
          e.marketingCampaignId === out.campaign.id && e.message.startsWith("AI campaign")
      );
    expect(launchEvent).toBeTruthy();
    expect(launchEvent!.message).toContain("EMAIL + SMS");
    expect(launchEvent!.message).toContain("1 attachment");
    expect(launchEvent!.message).toMatch(/not individually logged/i);
  });
});