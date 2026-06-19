import { Button } from "@/components/ui/Button";
import type { Policy } from "@/types";

// Row-level policy action. Category tables stay intentionally quiet:
// open the policy first, then use the full detail page's header
// controls for carrier links, downloads, edits, and document actions.
export function PolicyActions({
  policy,
  size = "sm",
}: {
  policy: Policy;
  size?: "sm" | "xs";
}) {
  return (
    <div className="flex justify-end">
      <Button size={size} to={`/employee/policies/${policy.id}`} title="Open policy details">
        Open
      </Button>
    </div>
  );
}
