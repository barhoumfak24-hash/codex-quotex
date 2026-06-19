// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Marketing configuration + AI auto-send on new prospects.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("marketing.getConfig", () => {
  it("returns a sane default on first access — concierge style, auto-send on", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const cfg = api.marketing.getConfig(agency.id);
    expect(cfg.messageStyle).toBe("concierge");
    expect(cfg.autoSendOnNewProspect).toBe(true);
    expect(cfg.followUpCadenceDays).toBe(3);
    expect(cfg.autoMessageRules).toHaveLength(1);
    expect(cfg.autoMessageRules[0]).toMatchObject({
      enabled: true,
      trigger: "new_prospect",
      messageType: "quote_intake",
      audience: "new_prospects",
      approvalMode: "auto_send",
    });
    expect(cfg.attachments).toEqual([]);
    expect(cfg.senderName).toContain(agency.name);
  });

  it("updateConfig persists style + signOff + custom blurb", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.marketing.updateConfig(agency.id, {
      messageStyle: "friendly",
      signOff: "Cheers,\nThe team",
      customBlurb: "All quotes honored within 30 days.",
    });
    const cfg = api.marketing.getConfig(agency.id);
    expect(cfg.messageStyle).toBe("friendly");
    expect(cfg.signOff).toBe("Cheers,\nThe team");
    expect(cfg.customBlurb).toBe("All quotes honored within 30 days.");
  });

  it("keeps pamphlet branding owned by agency setup, not marketing config", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.agencies.update(agency.id, { logoUrl: "data:image/png;base64,agency-logo" });
    api.marketing.updateConfig(agency.id, {
      agencyLogo: {
        fileName: "legacy-pamphlet-logo.png",
        dataUrl: "data:image/png;base64,legacy",
        uploadedAt: "2026-06-04T12:00:00.000Z",
      },
    } as never);
    const cfg = api.marketing.getConfig(agency.id);
    expect(Object.prototype.hasOwnProperty.call(cfg, "agencyLogo")).toBe(false);
    expect(api.agencies.get(agency.id)?.logoUrl).toContain("data:image/png");
  });

  it("persists advanced AI auto-message rules", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const cfg = api.marketing.getConfig(agency.id);
    api.marketing.updateConfig(agency.id, {
      autoMessageRules: [
        {
          ...cfg.autoMessageRules[0],
          name: "Draft-only renewal nudge",
          enabled: true,
          trigger: "renewal_due",
          messageType: "retention",
          audience: "renewal_clients",
          approvalMode: "draft_for_review",
          timing: "delay",
          delayAmount: 5,
          delayUnit: "days",
          channels: ["email"],
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const updated = api.marketing.getConfig(agency.id);
    expect(updated.autoMessageRules[0]).toMatchObject({
      name: "Draft-only renewal nudge",
      trigger: "renewal_due",
      approvalMode: "draft_for_review",
      delayAmount: 5,
      channels: ["email"],
    });
  });
});

describe("marketing attachments", () => {
  it("addAttachment adds a row + removeAttachment removes it", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const updated = api.marketing.addAttachment(agency.id, {
      fileName: "Welcome-Packet.pdf",
      fileType: "application/pdf",
      description: "Welcome packet",
      channels: ["email"],
    });
    expect(updated.attachments.length).toBe(1);
    const attId = updated.attachments[0].id;
    const removed = api.marketing.removeAttachment(agency.id, attId);
    expect(removed.attachments.length).toBe(0);
  });
});

describe("marketing.autoSendProspectOutreach", () => {
  it("auto-fires on api.prospects.create when autoSendOnNewProspect is on", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const beforeMessages = api.marketing.listMessages(agency.id).length;

    api.prospects.create({
      tenantId: agency.id,
      name: "New Prospect",
      email: "new@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });

    const messages = api.marketing.listMessages(agency.id);
    expect(messages.length).toBe(beforeMessages + 1);
    const sent = messages[messages.length - 1];
    expect(sent.deliveryStatus).toBe("sent");
    expect(sent.channel).toBe("email");
    expect(sent.sentAt).toBeTruthy();
  });

  it("respects autoSendOnNewProspect=false — no auto-message fires", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.marketing.updateConfig(agency.id, { autoSendOnNewProspect: false });
    const beforeMessages = api.marketing.listMessages(agency.id).length;
    api.prospects.create({
      tenantId: agency.id,
      name: "Manual Prospect",
      email: "manual@example.com",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    expect(api.marketing.listMessages(agency.id).length).toBe(beforeMessages);
  });

  it("respects disabled new-prospect auto-message rule", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const cfg = api.marketing.getConfig(agency.id);
    api.marketing.updateConfig(agency.id, {
      autoSendOnNewProspect: true,
      autoMessageRules: cfg.autoMessageRules.map((rule) =>
        rule.trigger === "new_prospect" ? { ...rule, enabled: false } : rule
      ),
    });
    const beforeMessages = api.marketing.listMessages(agency.id).length;
    api.prospects.create({
      tenantId: agency.id,
      name: "Rule Disabled",
      email: "disabled@example.com",
      assetType: "luxury_vehicle",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    expect(api.marketing.listMessages(agency.id).length).toBe(beforeMessages);
  });

  it("the auto-send body reflects the configured style", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.marketing.updateConfig(agency.id, { messageStyle: "concise" });
    const p = api.prospects.create({
      tenantId: agency.id,
      name: "Concise Carla",
      email: "concise@example.com",
      assetType: "yacht",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    const messages = api.marketing.messagesForProspect(p.id);
    expect(messages.length).toBe(1);
    expect(messages[0].channel).toBe("email");
    expect(messages[0].content).toMatch(/ready to wrap up your quote\?/i);
  });

  it("an email auto-send appends email-tagged attachments", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    api.marketing.addAttachment(agency.id, {
      fileName: "About-Us.pdf",
      description: "About our agency",
      fileType: "application/pdf",
      channels: ["email"],
    });
    const p = api.prospects.create({
      tenantId: agency.id,
      name: "Attached Adam",
      email: "att@example.com",
      assetType: "coastal_home",
      aiSummary: "x",
      lastAction: "x",
      lastActivityAt: new Date().toISOString(),
      recommendedFollowUp: "x",
      marketingStatus: "none",
      status: "new",
    });
    const msg = api.marketing.messagesForProspect(p.id)[0];
    expect(msg.content).toMatch(/About our agency/);
  });
});
