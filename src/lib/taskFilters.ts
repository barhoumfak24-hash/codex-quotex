import type { Task } from "@/types";

export function isRoutingAssignmentTask(
  task: Pick<
    Task,
    "title" | "source" | "activityKey" | "awaitingManagerAssignment" | "routeRequestKind"
  >
): boolean {
  if (task.awaitingManagerAssignment || task.routeRequestKind) return true;
  if (task.activityKey?.startsWith("routing_assignment:")) return true;
  if (task.source !== "ai_notification") return false;

  return (
    task.title.startsWith("New client assigned:") ||
    task.title.startsWith("New prospect assigned:")
  );
}

export function isContactProfileActivity(
  task: Pick<
    Task,
    "title" | "source" | "activityKey" | "awaitingManagerAssignment" | "routeRequestKind"
  >
): boolean {
  return !isRoutingAssignmentTask(task);
}
