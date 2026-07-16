// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================================
// Manager-only "compose new AI campaign" launcher.
//
// Promotional campaign blasts record a campaign, a launch event, and
// per-recipient receipt rows used by client "campaigns received" logs.
// Campaigns target email and any combination of all
// clients / all prospects / hand-picked recipients.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            provider: "transactional",
            status: "sent",
            externalMessageId: "campaign_provider_message_1",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )
  );
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("marketing.composeAiCampaign", () => {
  it("blocks AI campaign launch without an approving staff user", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];

    await expect(
      api.marketing.composeAiCampaign({
        tenantId: agency.id,
        name: "Anonymous launch",
        channels: ["email"],
        brief: "This should not launch without approval.",
        includeAllClients: true,
      })
    ).rejects.toThrow(/approving staff user/i);
  });

  it("records a campaign and writes per-recipient receipt messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const beforeCampaigns = api.marketing.listCampaigns(agency.id).length;
    const clientCount = api.customers.list(agency.id).filter((c) => !c.archived).length;
    const beforeMessages = api.marketing.listMessages(agency.id).length;

    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Spring portfolio review",
      channels: ["email"],
      brief: "Reminder that our annual portfolio review window opens next month.",
      includeAllClients: true,
      actorId: "user_manager_pc",
    });

    expect(out.campaign.name).toBe("Spring portfolio review");
    expect(out.campaign.channels).toEqual(["email"]);
    expect(out.campaign.status).toBe("active");
    expect(api.marketing.listCampaigns(agency.id).length).toBe(beforeCampaigns + 1);
    expect(out.messageCount).toBe(clientCount);
    expect(api.marketing.listMessages(agency.id).length).toBe(beforeMessages + clientCount);
    expect(
      api.marketing.listMessages(agency.id).filter((m) => m.campaignId === out.campaign.id).length
    ).toBe(clientCount);
    expect(out.sentCount).toBe(clientCount);
    expect(out.failedCount).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(clientCount);
    const [, request] = vi.mocked(fetch).mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({
      senderMode: "agency_marketing",
      senderName: expect.any(String),
      replyTo: agency.contactEmail,
    });
    expect(payload.to).toHaveLength(1);
    expect(
      api.marketing
        .listMessages(agency.id)
        .filter((message) => message.campaignId === out.campaign.id)
        .every((message) => message.deliveryStatus === "sent" && !!message.providerMessageId)
    ).toBe(true);
  });

  it("combines all clients + all prospects in the recipient count", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const clientCount = api.customers.list(agency.id).filter((c) => !c.archived).length;
    const prospectCount = api.prospects
      .listByTenant(agency.id)
      .filter((p) => !p.archived).length;

    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Everyone blast",
      channels: ["email"],
      brief: "Big news for the whole book.",
      includeAllClients: true,
      includeAllProspects: true,
      actorId: "user_manager_pc",
    });
    expect(out.messageCount).toBe(clientCount + prospectCount);
  });

  it("hand-picked recipients are counted (deduped) when not using 'all'", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const prospect = api.prospects.listByTenant(agency.id)[0];

    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Hand-picked outreach",
      channels: ["email"],
      brief: "Specific touch.",
      selectedCustomerIds: customer ? [customer.id, customer.id] : [],
      selectedProspectIds: prospect ? [prospect.id] : [],
      actorId: "user_manager_pc",
    });
    const expected = (customer ? 1 : 0) + (prospect ? 1 : 0);
    expect(out.messageCount).toBe(expected);
  });

  it("scheduling for the future marks the campaign scheduled with queued receipts", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Hurricane prep checklist",
      channels: ["email"],
      brief: "Pre-storm checklist for coastal homeowners.",
      includeAllClients: true,
      scheduledFor: future,
      actorId: "user_manager_pc",
    });
    expect(out.campaign.status).toBe("scheduled");
    expect(out.campaign.scheduledFor).toBe(future);
    const receipts = api.marketing.listMessages(agency.id).filter((m) => m.campaignId === out.campaign.id);
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.every((m) => m.deliveryStatus === "queued")).toBe(true);
    expect(out.sentCount).toBe(0);
    expect(out.failedCount).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks rejected recipients failed instead of pretending the campaign was sent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, message: "Email provider rejected the campaign." }),
        { status: 502, headers: { "content-type": "application/json" } }
      )
    );
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];

    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Provider rejection test",
      channels: ["email"],
      brief: "This message must not be marked sent when delivery fails.",
      selectedCustomerIds: [customer.id],
      actorId: "user_manager_pc",
    });

    expect(out.sentCount).toBe(0);
    expect(out.failedCount).toBe(1);
    const receipt = api.marketing
      .listMessages(agency.id)
      .find((message) => message.campaignId === out.campaign.id);
    expect(receipt).toMatchObject({
      deliveryStatus: "failed",
      deliveryError: "Email provider rejected the campaign.",
    });
    expect(receipt?.sentAt).toBeUndefined();
  });

  it("recurrence is persisted on the campaign row", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Weekly market digest",
      channels: ["email"],
      brief: "Weekly insurance market roundup.",
      includeAllClients: true,
      recurrence: "weekly",
      actorId: "user_manager_pc",
    });
    expect(out.campaign.recurrence).toBe("weekly");
    expect(out.campaign.status).toBe("active");
  });

  it("writes one launch status event noting channels + receipt logging", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Inspection reminder",
      channels: ["email"],
      brief: "Wind mitigation re-inspection due.",
      includeAllClients: true,
      actorId: "user_manager_pc",
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
    expect(launchEvent!.message).toContain("EMAIL");
    expect(launchEvent!.message).toContain("1 attachment");
    expect(launchEvent!.message).toMatch(/provider-accepted/i);
  });

  it("stores a personalized full pamphlet message with a smart contact CTA", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const firstName = customer?.name.split(/\s+/)[0] ?? "";

    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Coastal home readiness",
      channels: ["email"],
      brief: "Audit copy for the campaign record.",
      emailSubject: "Review your coastal home protection",
      emailBody: "Hi {first_name},\n\nWe prepared a short coastal home coverage check-in.\n\nBest,\nPalm Coast Private Client",
      heroImageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1800",
      heroImageAlt: "Coastal home",
      pamphlet: {
        eyebrow: "Private client renewal",
        headline: "A clearer renewal before terms are finalized",
        subheadline: "Review the home details before the carrier sets final terms.",
        intro: "This pamphlet organizes the renewal decisions that matter most before pricing is finalized.",
        highlightsTitle: "What we will check",
        highlights: [
          "Confirm the dwelling limit still matches the property profile.",
          "Review wind, flood, and roof details before underwriting.",
          "Prepare the file before carrier terms become urgent.",
        ],
      },
      includeAllClients: false,
      selectedCustomerIds: customer ? [customer.id] : [],
      appOrigin: "https://agency.example",
      actorId: "user_manager_pc",
    });

    const message = api.marketing
      .listMessages(agency.id)
      .find((row) => row.campaignId === out.campaign.id && row.customerId === customer?.id);

    expect(message?.subject).toBe("Review your coastal home protection");
    expect(message?.content).toContain(`Hi ${firstName},`);
    expect(message?.content).not.toContain("{first_name}");
    const emailBodyIndex = message?.content.indexOf("[[quotex:marketing-email-body]]") ?? -1;
    const pamphletIndex = message?.content.indexOf("[[quotex:marketing-pamphlet]]") ?? -1;
    expect(emailBodyIndex).toBeGreaterThanOrEqual(0);
    expect(pamphletIndex).toBeGreaterThan(emailBodyIndex);
    expect(message?.content).toContain("![Coastal home](https://images.unsplash.com");
    expect(message?.content).toContain("# A clearer renewal before terms are finalized");
    expect(message?.content).toContain("This pamphlet organizes the renewal decisions");
    expect(message?.content).toContain("- Confirm the dwelling limit still matches the property profile.");
    expect(message?.content).not.toContain("Advisor note");
    expect(message?.content).toContain("[Get in touch](https://agency.example/marketing/contact?");
    expect(message?.content).toContain(`customer=${encodeURIComponent(customer?.id ?? "")}`);
    expect(message?.content).toContain("Best,\nPalm Coast Private Client");
  });
});
