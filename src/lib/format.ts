import type { PolicyStatus, ProspectStatus, RenewalStatus } from "@/types";

export const fmt = {
  money(n: number, currency = "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  },
  date(iso?: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  },
  dateTime(iso?: string) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  },
  relative(iso?: string) {
    if (!iso) return "—";
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    const past = diff >= 0;
    const abs = Math.abs(diff);
    const units: [number, string][] = [
      [60, "s"],
      [60, "m"],
      [24, "h"],
      [7, "d"],
      [4.345, "w"],
      [12, "mo"],
      [Infinity, "y"],
    ];
    let v = abs;
    for (const [size, label] of units) {
      if (v < size) return past ? `${Math.floor(v)}${label} ago` : `in ${Math.floor(v)}${label}`;
      v = v / size;
    }
    return "";
  },
  titleCase(s: string) {
    return s
      .split(/[\s_]+/)
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(" ");
  },
  // Canonical "Policy #X" rendering. Used wherever a policy is
  // referenced so the label stays consistent across portals and
  // status timelines. Accepts the policy object, just the number,
  // or undefined — undefined renders "Policy pending" so we never
  // surface a bare id or em-dash without context.
  policyRef(p?: { policyNumber?: string; id?: string } | string | null): string {
    if (!p) return "Policy pending";
    if (typeof p === "string") return p.trim() ? `Policy #${p}` : "Policy pending";
    if (p.policyNumber && p.policyNumber.trim()) return `Policy #${p.policyNumber}`;
    if (p.id) return `Policy #${p.id.slice(-6).toUpperCase()}`;
    return "Policy pending";
  },
};

export const policyStatusLabel: Record<PolicyStatus, string> = {
  quote_started: "Quote Started",
  documents_needed: "Documents Needed",
  submitted_to_agent: "Submitted to Agent",
  under_agent_review: "Under Agent Review",
  submitted_to_carrier: "Submitted to Carrier",
  carrier_reviewing: "Carrier Reviewing",
  approved: "Approved",
  bound: "Bound",
  declined: "Declined",
  deposit_paid: "Deposit Paid",
  deposit_refunded: "Deposit Refunded",
  renewal_upcoming: "Renewal Upcoming",
  renewed: "Renewed",
  claim_opened: "Claim Opened",
  claim_closed: "Claim Closed",
};

export const prospectStatusLabel: Record<ProspectStatus, string> = {
  new: "New",
  contacted: "Contacted",
  quote_in_progress: "Quote In Progress",
  abandoned: "Abandoned",
  nurturing: "Nurturing",
  converted: "Converted",
  lost: "Lost",
};

export const renewalStatusLabel: Record<RenewalStatus, string> = {
  not_due: "Not Due",
  upcoming: "Upcoming",
  customer_notified: "Customer Notified",
  agent_notified: "Agent Notified",
  waiting_on_customer: "Waiting on Customer",
  submitted_for_renewal: "Submitted",
  renewed: "Renewed",
  not_renewed: "Not Renewed",
  lost: "Lost",
};

export function policyStatusTone(s: PolicyStatus): "neutral" | "info" | "success" | "warn" | "error" {
  if (s === "bound" || s === "approved" || s === "renewed") return "success";
  if (s === "declined" || s === "deposit_refunded") return "error";
  if (s === "renewal_upcoming" || s === "documents_needed") return "warn";
  if (s === "quote_started") return "neutral";
  return "info";
}

export function prospectStatusTone(s: ProspectStatus): "neutral" | "info" | "success" | "warn" | "error" {
  if (s === "converted") return "success";
  if (s === "lost") return "error";
  if (s === "abandoned") return "warn";
  if (s === "new") return "info";
  return "neutral";
}