// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// AI inbound triage — auto-creating activities from incoming messages.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("aiClassifyInboundForActivity", () => {
  it("ignores pure acknowledgements", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    expect(aiClassifyInboundForActivity({ body: "thanks!" }).warrants).toBe(false);
    expect(aiClassifyInboundForActivity({ body: "Got it 👍" }).warrants).toBe(false);
  });

  it("flags an add-a-vehicle request as a coverage change", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({
      body: "Can you add a new vehicle to my policy?",
      contactName: "Alexandra",
    });
    expect(out.warrants).toBe(true);
    expect(out.topic).toBe("coverage_change");
    expect(out.title).toMatch(/Alexandra/);
  });

  it("flags a loss/accident as an urgent claim", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({ body: "I was in a car accident yesterday." });
    expect(out.warrants).toBe(true);
    expect(out.topic).toBe("claim_filed");
    expect(out.severity).toBe("urgent");
  });

  it("treats a general question as a notification, not a full activity", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({ body: "When does my coverage start?" });
    expect(out.disposition).toBe("notification");
    expect(out.warrants).toBe(false);
  });

  it("keeps routine document/payment/renewal updates notification-only", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    expect(aiClassifyInboundForActivity({ body: "I uploaded the signed form." }).disposition).toBe(
      "notification"
    );
    expect(aiClassifyInboundForActivity({ body: "The invoice was paid today." }).disposition).toBe(
      "notification"
    );
    expect(aiClassifyInboundForActivity({ body: "Renewal packet received." }).disposition).toBe(
      "notification"
    );
  });

  it("recognizes a certificate request as a draftable service intent", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({
      subject: "Certificate request",
      body: "Can you please send me a certificate of insurance?",
      contactKind: "client",
    });
    expect(out.disposition).toBe("notification");
    expect(out.serviceIntent).toBe("certificate_of_insurance");
  });

  it("recognizes a vehicle quote request and asks only for missing intake details", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const missingBoth = aiClassifyInboundForActivity({
      subject: "Need quote for my truck",
      body: "I need a quote for my new Ford F150.",
      contactKind: "client",
    });
    expect(missingBoth.disposition).toBe("notification");
    expect(missingBoth.serviceIntent).toBe("vehicle_quote_intake");
    expect(missingBoth.serviceQuestions).toEqual(["vin", "policy_line"]);

    const missingLineOnly = aiClassifyInboundForActivity({
      subject: "Need quote for my truck",
      body: "Please quote my Ford F-150. VIN 1HGCM82633A004352.",
      contactKind: "client",
    });
    expect(missingLineOnly.serviceIntent).toBe("vehicle_quote_intake");
    expect(missingLineOnly.serviceQuestions).toEqual(["policy_line"]);

    const complete = aiClassifyInboundForActivity({
      subject: "Personal auto quote",
      body: "Please quote my Ford F-150 on a personal policy. VIN 1HGCM82633A004352.",
      contactKind: "client",
    });
    expect(complete.disposition).toBe("activity");
    expect(complete.serviceIntent).toBeUndefined();
    expect(complete.serviceQuestions).toBeUndefined();
  });

  it("still opens activities for failed payments and carrier supplementals", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    expect(
      aiClassifyInboundForActivity({ body: "The card was declined and the policy is past due." })
        .disposition
    ).toBe("activity");
    expect(
      aiClassifyInboundForActivity({
        body: "Carrier needs a supplemental before binding.",
        contactKind: "carrier",
      }).disposition
    ).toBe("activity");
  });

  it("classifies only the newest message and ignores claim language in quoted history", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({
      body: "Thank you!\n\nOn Tue, Jul 21, 2026 at 9:12 AM Agent wrote:\nPlease file a claim for the accident.",
      contactKind: "client",
    });
    expect(out.disposition).toBe("ignore");
    expect(out.evidence).toContain("newest_message:acknowledgement");
  });

  it("excludes bulk marketing email from workflow automation", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({
      subject: "New listing and price cut",
      body: "See the latest homes in your area. Unsubscribe from these alerts.",
      contactKind: "client",
    });
    expect(out.disposition).toBe("ignore");
    expect(out.evidence).toContain("message_pattern:bulk_marketing");
  });

  it("does not treat an informational claim mention as a reported loss", async () => {
    const { aiClassifyInboundForActivity } = await import("../ai");
    const out = aiClassifyInboundForActivity({
      body: "Our website has a new article about industry claim trends.",
      contactKind: "client",
    });
    expect(out.topic).not.toBe("claim_filed");
    expect(out.disposition).toBe("ignore");
  });
});

describe("communications.sweepInboundForActivities", () => {
  it("auto-creates an activity for an inbound message that needs follow-up + links it", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const comm = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "Please add a new vehicle to my policy.",
    });
    const created = api.communications.sweepInboundForActivities(agency.id);
    expect(created.length).toBeGreaterThanOrEqual(1);
    const fresh = api.communications.listByCustomer(customer.id).find((c) => c.id === comm.id)!;
    expect(fresh.aiActivityScannedAt).toBeTruthy();
    expect(fresh.aiActivityTaskId).toBeTruthy();
    const task = api.tasks.listByTenant(agency.id).find((t) => t.id === fresh.aiActivityTaskId)!;
    expect(task).toBeTruthy();
    expect(task.assignedToId).toBe(customer.assignedAgentId);
    expect(task.messageId).toBe(comm.id);
  });

  it("creates only one activity when the same email is mirrored into multiple staff mailboxes", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const sharedMessageId = "<same-real-email@example.com>";
    const first = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Please cancel my policy",
      body: "Please cancel my policy at the end of this month.",
      mailboxOrigin: "provider_sync",
      mailboxProvider: "gmail",
      mailboxAccount: "agent.one@example.com",
      externalMessageId: "gmail-copy-one",
      messageIdHeader: sharedMessageId,
    });
    const second = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Please cancel my policy",
      body: "Please cancel my policy at the end of this month.",
      mailboxOrigin: "provider_sync",
      mailboxProvider: "gmail",
      mailboxAccount: "agent.two@example.com",
      externalMessageId: "gmail-copy-two",
      messageIdHeader: sharedMessageId,
    });

    api.communications.sweepInboundForActivities(agency.id);

    const activeEmailTasks = api.tasks
      .listByTenant(agency.id)
      .filter(
        (task) =>
          [first.id, second.id].includes(task.messageId ?? "") &&
          task.status !== "resolved" &&
          !task.completedAt
      );
    expect(activeEmailTasks).toHaveLength(1);
    expect(activeEmailTasks[0].activityKey).toBe(
      "inbound-email:message:same-real-email@example.com"
    );

    const freshFirst = api.communications
      .listByCustomer(customer.id)
      .find((row) => row.id === first.id)!;
    const freshSecond = api.communications
      .listByCustomer(customer.id)
      .find((row) => row.id === second.id)!;
    expect(freshFirst.aiActivityTaskId).toBe(activeEmailTasks[0].id);
    expect(freshSecond.aiActivityTaskId).toBe(activeEmailTasks[0].id);
    const inboundRemarks = api.customers
      .fullHistory(customer.id)
      .filter(
        (event) =>
          event.inboundEmailIdentity === "message:same-real-email@example.com"
      );
    expect(inboundRemarks).toHaveLength(1);
    expect(inboundRemarks[0]).toEqual(
      expect.objectContaining({
        message: "Inbound email remark: Please cancel my policy.",
        taskId: activeEmailTasks[0].id,
      })
    );
    expect([first.id, second.id]).toContain(inboundRemarks[0].communicationId);
  });

  it("creates one draft and one notification when a quote request exists in multiple mailboxes", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const sharedMessageId = "<same-vehicle-request@example.com>";
    const first = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Need quote for my truck",
      body: "I need a quote for my new Ford F150.",
      mailboxOrigin: "provider_sync",
      mailboxProvider: "gmail",
      mailboxAccount: "agent.one@example.com",
      externalMessageId: "gmail-vehicle-copy-one",
      messageIdHeader: sharedMessageId,
    });
    const second = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Need quote for my truck",
      body: "I need a quote for my new Ford F150.",
      mailboxOrigin: "provider_sync",
      mailboxProvider: "gmail",
      mailboxAccount: "agent.two@example.com",
      externalMessageId: "gmail-vehicle-copy-two",
      messageIdHeader: sharedMessageId,
    });

    api.communications.sweepInboundForActivities(agency.id);

    const fresh = api.communications
      .listByCustomer(customer.id)
      .filter((row) => [first.id, second.id].includes(row.id));
    expect(fresh).toHaveLength(2);
    expect(fresh[0].aiActivityScannedAt).toBeTruthy();
    expect(fresh[1].aiActivityScannedAt).toBe(fresh[0].aiActivityScannedAt);
    expect(fresh[1].aiActivityTaskId).toBe(fresh[0].aiActivityTaskId);
    expect(fresh[1].aiReplyDraftId).toBe(fresh[0].aiReplyDraftId);
    expect(fresh[1].aiActivityNotificationId).toBe(
      fresh[0].aiActivityNotificationId
    );

    const sourceIds = new Set([first.id, second.id]);
    const drafts = api.communications
      .listByCustomer(customer.id)
      .filter(
        (row) =>
          row.deliveryStatus === "draft" &&
          row.aiServiceIntent === "vehicle_quote_intake" &&
          sourceIds.has(row.aiDraftSourceCommunicationId ?? "")
      );
    expect(drafts).toHaveLength(1);

    const notifications = api.aiNotifications
      .listByTenant(agency.id)
      .filter(
        (row) =>
          row.eventKey ===
          "inbound-notification:message:same-vehicle-request@example.com:vehicle-quote-draft"
      );
    expect(notifications).toHaveLength(1);

    const tasks = api.tasks
      .listByTenant(agency.id)
      .filter(
        (task) =>
          task.activityKey ===
          "inbound-email:message:same-vehicle-request@example.com"
      );
    expect(tasks).toHaveLength(1);
  });

  it("propagates completed automation metadata to a mailbox copy that arrives later", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const sharedMessageId = "<late-mailbox-copy@example.com>";
    const first = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Document received",
      body: "I uploaded the signed form.",
      mailboxOrigin: "provider_sync",
      mailboxProvider: "gmail",
      mailboxAccount: "agent.one@example.com",
      externalMessageId: "gmail-late-copy-one",
      messageIdHeader: sharedMessageId,
    });

    api.communications.sweepInboundForActivities(agency.id);
    const scannedFirst = api.communications
      .listByCustomer(customer.id)
      .find((row) => row.id === first.id)!;
    expect(scannedFirst.aiActivityScannedAt).toBeTruthy();

    const second = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Document received",
      body: "I uploaded the signed form.",
      mailboxOrigin: "provider_sync",
      mailboxProvider: "gmail",
      mailboxAccount: "agent.two@example.com",
      externalMessageId: "gmail-late-copy-two",
      messageIdHeader: sharedMessageId,
    });

    expect(api.communications.sweepInboundForActivities(agency.id)).toHaveLength(0);
    const freshSecond = api.communications
      .listByCustomer(customer.id)
      .find((row) => row.id === second.id)!;
    expect(freshSecond.aiActivityScannedAt).toBe(
      scannedFirst.aiActivityScannedAt
    );
    expect(freshSecond.aiActivityNotificationId).toBe(
      scannedFirst.aiActivityNotificationId
    );
    expect(freshSecond.aiTriageVersion).toBe(scannedFirst.aiTriageVersion);

    const matching = api.aiNotifications
      .listByTenant(agency.id)
      .filter(
        (row) =>
          row.eventKey ===
          "inbound-notification:message:late-mailbox-copy@example.com:informational"
      );
    expect(matching).toHaveLength(1);
  });

  it("consolidates existing duplicate email activities without deleting their history", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const first = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "Thank you.",
      messageIdHeader: "<existing-duplicate@example.com>",
      mailboxOrigin: "provider_sync",
      mailboxAccount: "agent.one@example.com",
      aiActivityScannedAt: "2026-07-24T12:00:00.000Z",
      aiTriageVersion: "legacy",
    });
    const second = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "Thank you.",
      messageIdHeader: "<existing-duplicate@example.com>",
      mailboxOrigin: "provider_sync",
      mailboxAccount: "agent.two@example.com",
      aiActivityScannedAt: "2026-07-24T12:00:00.000Z",
      aiTriageVersion: "legacy",
    });
    db.insert("tasks", {
      id: "task_duplicate_first",
      tenantId: agency.id,
      title: "First copy",
      messageId: first.id,
      activityKey: `legacy:${first.id}`,
      source: "ai_notification",
      status: "open",
      createdAt: "2026-07-24T12:00:00.000Z",
    });
    db.insert("tasks", {
      id: "task_duplicate_second",
      tenantId: agency.id,
      title: "Second copy",
      messageId: second.id,
      activityKey: `legacy:${second.id}`,
      source: "ai_notification",
      status: "open",
      createdAt: "2026-07-24T12:01:00.000Z",
    });

    api.communications.sweepInboundForActivities(agency.id);

    const matchingTasks = api.tasks
      .listByTenant(agency.id)
      .filter((task) => [first.id, second.id].includes(task.messageId ?? ""));
    expect(matchingTasks).toHaveLength(2);
    expect(
      matchingTasks.filter((task) => task.status !== "resolved" && !task.completedAt)
    ).toHaveLength(1);
    expect(matchingTasks.find((task) => task.status === "resolved")).toEqual(
      expect.objectContaining({
        resolutionNote:
          "Automatically consolidated with the single activity for this inbound email.",
      })
    );
    expect(
      matchingTasks.find((task) => task.status !== "resolved")?.activityKey
    ).toBe("inbound-email:message:existing-duplicate@example.com");
  });

  it("does not create an activity for an acknowledgement, and is idempotent", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const acknowledgement = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Thank you",
      body: "Thank you so much!",
      messageIdHeader: "<acknowledgement@example.com>",
    });
    const before = api.tasks.listByTenant(agency.id).length;
    api.communications.sweepInboundForActivities(agency.id);
    expect(api.tasks.listByTenant(agency.id).length).toBe(before);
    // Second sweep is a no-op (already scanned).
    expect(api.communications.sweepInboundForActivities(agency.id).length).toBe(0);
    expect(
      api.customers
        .fullHistory(customer.id)
        .filter(
          (event) =>
            event.inboundEmailIdentity === "message:acknowledgement@example.com"
        )
    ).toEqual([
      expect.objectContaining({
        communicationId: acknowledgement.id,
        message: "Inbound email remark: Thank you.",
        taskId: undefined,
      }),
    ]);
  });

  it("logs a notification instead of an activity for informational inbound messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const comm = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "I uploaded the signed form.",
    });
    const created = api.communications.sweepInboundForActivities(agency.id);
    expect(created).toHaveLength(1);
    expect(created[0].task).toBeUndefined();
    expect(created[0].notification?.kind).toBe("inbound_notice");
    const fresh = api.communications.listByCustomer(customer.id).find((c) => c.id === comm.id)!;
    expect(fresh.aiActivityScannedAt).toBeTruthy();
    expect(fresh.aiActivityTaskId).toBeUndefined();
    expect(fresh.aiActivityNotificationId).toBeTruthy();
    expect(
      api.tasks.listByTenant(agency.id).some((t) => t.messageId === comm.id)
    ).toBe(false);
  });

  it("prepares an unsent COI reply draft with the approved document attached", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const ownerId = customer.assignedAgentId!;
    api.documents.create({
      tenantId: agency.id,
      uploadedById: ownerId,
      fileName: "Alexandra-Whitford-COI.pdf",
      fileType: "application/pdf",
      documentName: "Certificate of insurance",
      type: "proof_of_insurance",
      visibility: "employee_only",
      status: "approved",
      customerId: customer.id,
      downloadUrl: "data:application/pdf;base64,JVBERi0xLjQK",
    });
    const beforeOutbox = api.mailboxOutbox.listByTenant(agency.id).length;
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Need a COI",
      body: "Please email me a certificate of insurance.",
    });

    const created = api.communications.sweepInboundForActivities(agency.id);
    expect(created).toHaveLength(1);
    expect(created[0].task).toEqual(
      expect.objectContaining({
        customerId: customer.id,
        messageId: inbound.id,
        topic: "document_upload",
        status: "open",
        assignedToId: ownerId,
      })
    );
    const fresh = api.communications.listByCustomer(customer.id).find((row) => row.id === inbound.id)!;
    expect(fresh.aiTriageDisposition).toBe("activity");
    expect(fresh.aiServiceIntent).toBe("certificate_of_insurance");
    expect(fresh.aiReplyDraftId).toBeTruthy();
    expect(fresh.aiActivityTaskId).toBe(created[0].task!.id);
    const draft = api.communications
      .listByCustomer(customer.id)
      .find((row) => row.id === fresh.aiReplyDraftId)!;
    expect(draft.deliveryStatus).toBe("draft");
    expect(draft.createdById).toBe(ownerId);
    expect(draft.replyToId).toBe(inbound.id);
    expect(draft.attachments).toHaveLength(1);
    const attachedDocument = api.documents.get(draft.attachments![0].documentId!)!;
    expect(attachedDocument).toEqual(
      expect.objectContaining({ status: "approved", type: "proof_of_insurance" })
    );
    expect(
      attachedDocument.customerId === customer.id ||
        api.policies.get(attachedDocument.policyId ?? "")?.customerId === customer.id
    ).toBe(true);
    expect(draft.outboxJobId).toBeUndefined();
    expect(api.mailboxOutbox.listByTenant(agency.id)).toHaveLength(beforeOutbox);
    expect(created[0].notification).toEqual(
      expect.objectContaining({
        messageId: draft.id,
        documentId: attachedDocument.id,
        assignedToId: ownerId,
      })
    );
    expect(api.communications.sweepInboundForActivities(agency.id)).toHaveLength(0);
    expect(
      api.tasks.listByTenant(agency.id).filter((task) => task.messageId === inbound.id)
    ).toHaveLength(1);
    expect(
      api.communications
        .listByCustomer(customer.id)
        .filter((row) => row.aiDraftSourceCommunicationId === inbound.id)
    ).toHaveLength(1);
  });

  it("prepares one unsent vehicle-quote intake draft for the exact inbound email", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const ownerId = customer.assignedAgentId!;
    const beforeOutbox = api.mailboxOutbox.listByTenant(agency.id).length;
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Need quote for my truck",
      body: "I need a quote for my new Ford F150.",
    });

    const created = api.communications.sweepInboundForActivities(agency.id);
    expect(created).toHaveLength(1);
    expect(created[0].task).toEqual(
      expect.objectContaining({
        customerId: customer.id,
        messageId: inbound.id,
        topic: "coverage_change",
        status: "open",
        assignedToId: ownerId,
      })
    );
    const fresh = api.communications.listByCustomer(customer.id).find((row) => row.id === inbound.id)!;
    expect(fresh.aiTriageDisposition).toBe("activity");
    expect(fresh.aiServiceIntent).toBe("vehicle_quote_intake");
    expect(fresh.aiDraftMissingFields).toEqual(["vin", "policy_line"]);
    expect(fresh.aiReplyDraftId).toBeTruthy();
    expect(fresh.aiActivityTaskId).toBe(created[0].task!.id);
    const draft = api.communications
      .listByCustomer(customer.id)
      .find((row) => row.id === fresh.aiReplyDraftId)!;
    expect(draft).toEqual(
      expect.objectContaining({
        deliveryStatus: "draft",
        createdById: ownerId,
        replyToId: inbound.id,
        aiDraftSourceCommunicationId: inbound.id,
        aiServiceIntent: "vehicle_quote_intake",
        aiDraftMissingFields: ["vin", "policy_line"],
      })
    );
    expect(draft.body).toMatch(/17-character VIN/i);
    expect(draft.body).toMatch(/personal or commercial policy/i);
    expect(draft.attachments).toBeUndefined();
    expect(draft.outboxJobId).toBeUndefined();
    expect(api.mailboxOutbox.listByTenant(agency.id)).toHaveLength(beforeOutbox);
    expect(created[0].notification).toEqual(
      expect.objectContaining({
        messageId: draft.id,
        communicationId: inbound.id,
        assignedToId: ownerId,
      })
    );
    expect(api.communications.sweepInboundForActivities(agency.id)).toHaveLength(0);
    expect(
      api.tasks.listByTenant(agency.id).filter((task) => task.messageId === inbound.id)
    ).toHaveLength(1);
    expect(
      api.communications
        .listByCustomer(customer.id)
        .filter((row) => row.aiDraftSourceCommunicationId === inbound.id)
    ).toHaveLength(1);
  });

  it("does not turn a previously scanned email into new work after a triage update", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "Need quote for my truck",
      body: "I need a quote for my new Ford F150.",
    });
    db.update("communications", inbound.id, {
      aiActivityScannedAt: "2026-07-21T12:00:00.000Z",
      aiTriageVersion: "2026-07-22-v2",
      aiTriageDisposition: "activity",
      aiTriageTopic: "coverage_change",
    });

    const created = api.communications.sweepInboundForActivities(agency.id);
    expect(created).toHaveLength(0);
    const fresh = api.communications.listByCustomer(customer.id).find((row) => row.id === inbound.id)!;
    expect(fresh.aiTriageVersion).toBe("2026-07-22-v2");
    expect(fresh.aiReplyDraftId).toBeUndefined();
    expect(
      api.tasks.listByTenant(agency.id).filter((task) => task.messageId === inbound.id)
    ).toHaveLength(0);
  });

  it("reuses the same notification when a mailbox retry loses scan metadata", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "I uploaded the signed form.",
      messageIdHeader: "<durable-notification@example.com>",
    });

    const first = api.communications.sweepInboundForActivities(agency.id);
    const notification = first[0]?.notification;
    expect(notification?.eventKey).toBe(
      "inbound-notification:message:durable-notification@example.com:informational"
    );
    api.aiNotifications.dismiss(notification!.id, customer.assignedAgentId);
    const eventKey = notification!.eventKey;
    db.update("aiNotifications", notification!.id, { eventKey: undefined });

    db.update("communications", inbound.id, {
      aiActivityScannedAt: undefined,
      aiActivityNotificationId: undefined,
      aiTriageVersion: undefined,
    });

    api.communications.sweepInboundForActivities(agency.id);
    const matching = api.aiNotifications
      .listByTenant(agency.id)
      .filter((row) => row.eventKey === eventKey);
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe(notification!.id);
    expect(matching[0].acknowledgedAt).toBeTruthy();
  });

  it("opens a review activity instead of drafting when no approved document exists", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.documents
      .listByEntity({ customerId: customer.id })
      .filter((document) => document.type === "insurance_id_card")
      .forEach((document) => db.remove("documents", document.id));
    const inbound = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      subject: "ID card",
      body: "Please send me my insurance ID card.",
    });

    const created = api.communications.sweepInboundForActivities(agency.id);
    expect(created).toHaveLength(1);
    expect(created[0].task?.topic).toBe("document_upload");
    expect(created[0].notification).toBeUndefined();
    const fresh = api.communications.listByCustomer(customer.id).find((row) => row.id === inbound.id)!;
    expect(fresh.aiTriageDisposition).toBe("activity");
    expect(fresh.aiReplyDraftId).toBeUndefined();
  });

  it("permanently removes an inbound communication and its notification", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const comm = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "The requested form was uploaded.",
    });
    const created = api.communications.sweepInboundForActivities(agency.id);
    const notificationId = created[0]?.notification?.id;
    expect(notificationId).toBeTruthy();

    expect(api.communications.remove(comm.id)).toBe(true);
    if (notificationId) expect(api.aiNotifications.remove(notificationId)).toBe(true);

    expect(api.communications.listByCustomer(customer.id)).not.toContainEqual(
      expect.objectContaining({ id: comm.id })
    );
    expect(api.aiNotifications.listByTenant(agency.id)).not.toContainEqual(
      expect.objectContaining({ id: notificationId })
    );
  });

  it("skips AI-authored inbound and outbound messages", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "I need to file a claim",
      createdById: "ai",
    });
    expect(api.communications.sweepInboundForActivities(agency.id).length).toBe(0);
  });

  it("hides and does not automate a legacy provider email from an unknown sender", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const comm = api.communications.create({
      tenantId: agency.id,
      channel: "email",
      direction: "inbound",
      body: "Please cancel my policy.",
      externalRecipientEmail: "unknown.sender@example.com",
      mailboxOrigin: "provider_sync",
    });

    expect(api.communications.sweepInboundForActivities(agency.id)).toHaveLength(0);
    expect(api.communications.listByTenant(agency.id)).not.toContainEqual(
      expect.objectContaining({ id: comm.id })
    );
    expect(db.list("communications").find((row) => row.id === comm.id)).toMatchObject({
      aiTriageDisposition: "ignore",
      aiTriageEvidence: ["tenant_contact_match:none"],
    });
  });
});
