// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("activity resolution notes", () => {
  it("resolves without a checklist gate and writes the resolution note to the client record", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const agent =
      api.users.list(agency.id).find((u) => u.id === customer.assignedAgentId) ??
      api.users.list(agency.id).find((u) => u.role === "agent")!;

    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Collect revised roof photos",
      customerId: customer.id,
      assignedToId: agent.id,
      createdById: agent.id,
      topic: "document_upload",
    });

    api.tasks.markInProgress(task.id, agent.id);
    const done = api.tasks.markComplete(task.id, agent.id, {
      resolutionNote:
        "Client confirmed the revised photos are uploaded and the carrier has what they need.",
    });

    expect(done?.status).toBe("resolved");
    expect(done?.resolutionNote).toContain("Client confirmed");
    expect(done?.resolutionNoteId).toBeTruthy();
    expect(done?.resolutionNoteAt).toBeTruthy();

    const notes = api.notes.listByCustomer(customer.id);
    expect(
      notes.some(
        (note) =>
          note.body.includes("Activity closed out with agent note attached") &&
          note.body.includes("Collect revised roof photos") &&
          note.body.includes("Client confirmed")
      )
    ).toBe(true);

    const timeline = api.status.listFor({ customerId: customer.id });
    expect(
      timeline.some((event) =>
        event.message.includes("Activity closed out with agent note attached")
      )
    ).toBe(true);
  });
});
