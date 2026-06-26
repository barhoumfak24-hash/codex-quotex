import { describe, expect, it } from "vitest";
import { isContactProfileActivity, isRoutingAssignmentTask } from "../taskFilters";

describe("task profile filters", () => {
  it("keeps routing handoff tasks out of client and prospect profile activity counts", () => {
    expect(
      isRoutingAssignmentTask({
        title: "New client assigned: Alexandra Whitford",
        source: "ai_notification",
      })
    ).toBe(true);
    expect(
      isRoutingAssignmentTask({
        title: "New prospect assigned: Jenkins Household",
        source: "ai_notification",
      })
    ).toBe(true);

    expect(
      isContactProfileActivity({
        title: "New client assigned: Alexandra Whitford",
        source: "ai_notification",
      })
    ).toBe(false);
    expect(
      isContactProfileActivity({
        title: "New prospect assigned: Jenkins Household",
        source: "ai_notification",
      })
    ).toBe(false);
  });

  it("does not hide manual activities just because the title has routing words", () => {
    expect(
      isContactProfileActivity({
        title: "New client assigned: follow-up from Daniel",
        source: "manual",
      })
    ).toBe(true);
    expect(
      isContactProfileActivity({
        title: "New prospect assigned: confirm producer split",
        source: "manual",
      })
    ).toBe(true);
  });

  it("keeps manager-routing requests out of contact profile activity counts", () => {
    expect(
      isContactProfileActivity({
        title: "Route client requested: Alexandra Whitford",
        source: "manual",
        awaitingManagerAssignment: true,
        routeRequestKind: "client",
      })
    ).toBe(false);
    expect(
      isContactProfileActivity({
        title: "Send to manager for assignment",
        source: "manual",
        awaitingManagerAssignment: true,
      })
    ).toBe(false);
  });

  it("still allows real activity and quote-flow tasks to appear on contact profiles", () => {
    expect(
      isContactProfileActivity({
        title: "Policy edit request - Alexandra Whitford",
        source: "manual",
      })
    ).toBe(true);
    expect(
      isContactProfileActivity({
        title: "Commercial quote questionnaire submitted",
        source: "ai_notification",
      })
    ).toBe(true);
    expect(
      isContactProfileActivity({
        title: "Quote flow needs carrier follow-up",
        source: "manual",
      })
    ).toBe(true);
  });
});
