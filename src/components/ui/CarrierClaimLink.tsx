import { ExternalLink, LifeBuoy } from "lucide-react";
import { api } from "@/lib/api";

// =====================================================================
// One-stop "File a claim" link to a carrier's external claims page.
//
// Renders an actual <a target="_blank" rel="noopener noreferrer">
// instead of a button → demo-notice modal, so the customer goes
// straight to the carrier's secure claims intake when they click.
//
// Two side effects on click, both kicked off in parallel with the
// navigation (the <a> handles the actual hop, so an audit failure
// can never block the customer's intent):
//
//   1. Customer-visible "Opened intake" status crumb on the
//      timeline so both portals share the same audit trail.
//
//   2. AI-staged follow-up: api.claims.draftClaimFollowUp fires an
//      internal status event for the agent / manager ("X opened
//      <Carrier>'s claim intake for <Asset> (Policy #Y). AI
//      staged a follow-up email") and drafts a customer-facing
//      email pre-filled with the policy reference, the affected
//      asset, the assigned agent, and a "reply to your agent"
//      call-out. The draft lands in the AI marketing queue for
//      review + approval — nothing is sent without staff sign-off.
// =====================================================================

interface Props {
  tenantId: string;
  customerId: string;
  carrierId: string;
  carrierName: string;
  claimsUrl: string;
  // Optional context attached to the status event.
  policyId?: string;
  assetId?: string;
  // Visual variant. Default = primary "File a claim" button; "inline"
  // is a compact text-link variant for use inside a row.
  variant?: "primary" | "outline" | "compact";
  // Override the button copy ("File a claim", "File a claim with Chubb", "File").
  label?: string;
  // Optional className passthrough.
  className?: string;
}

export function CarrierClaimLink({
  tenantId,
  customerId,
  carrierId,
  carrierName,
  claimsUrl,
  policyId,
  assetId,
  variant = "primary",
  label,
  className,
}: Props) {
  const display = label ?? `File a claim with ${carrierName}`;
  function logOpen() {
    try {
      // 1) Customer-visible audit crumb — same row both sides see.
      api.status.create({
        tenantId,
        source: "customer",
        message: `Opened ${carrierName}'s claim intake (${claimsUrl}).`,
        visibility: "customer_visible",
        customerId,
        policyId,
        assetId,
      });
      // 2) Agent-side internal notification + AI-drafted email
      // pre-filled with policy + asset + contact agent. Surfaces
      // on the AI marketing drafts queue for approval.
      api.claims.draftClaimFollowUp({
        tenantId,
        customerId,
        carrierId,
        carrierName,
        claimsUrl,
        policyId,
        assetId,
      });
    } catch {
      // Never block the navigation on a logging failure.
    }
  }

  const baseClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "outline"
      ? "btn-outline"
      : "inline-flex items-center gap-1 text-xs text-gold-700 hover:text-gold-600";

  return (
    <a
      href={claimsUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={logOpen}
      onAuxClick={(e) => {
        // Middle-click / right-click "Open in new tab" still counts
        // as an audit-worthy action — log it the same way.
        if (e.button === 1) logOpen();
      }}
      className={`${baseClass} ${className ?? ""}`.trim()}
      title={`Opens ${claimsUrl} in a new tab`}
      data-carrier-id={carrierId}
    >
      {variant === "compact" ? (
        <ExternalLink className="h-3.5 w-3.5" />
      ) : (
        <LifeBuoy className="h-4 w-4" />
      )}
      {display}
    </a>
  );
}