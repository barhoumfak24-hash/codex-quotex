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
    // Promotional auto-outreach is SMS-only now.
    expect(sent.channel).toBe("sms");
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
    // Auto-outreach is an SMS now; concise style uses the short hook.
    expect(messages[0].channel).toBe("sms");
    expect(messages[0].content).toMatch(/ready to wrap up your quote\?/i);
  });

  it("an SMS auto-send appends only SMS-tagged attachments (email-only ones are skipped)", async () => {
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
    // Email-only attachment must NOT appear in the SMS body.
    expect(msg.content).not.toMatch(/About our agency/);
  });
});