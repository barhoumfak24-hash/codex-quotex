import { Badge } from "./Badge";
import type { PolicyStatus, ProspectStatus, RenewalStatus } from "@/types";
import {
  policyStatusLabel,
  policyStatusTone,
  prospectStatusLabel,
  prospectStatusTone,
  renewalStatusLabel,
} from "@/lib/format";

export function PolicyStatusBadge({ status }: { status: PolicyStatus }) {
  return <Badge tone={policyStatusTone(status)}>{policyStatusLabel[status]}</Badge>;
}

export function ProspectStatusBadge({ status }: { status: ProspectStatus }) {
  return <Badge tone={prospectStatusTone(status)}>{prospectStatusLabel[status]}</Badge>;
}

export function RenewalStatusBadge({ status }: { status: RenewalStatus }) {
  const tone =
    status === "renewed"
      ? "success"
      : status === "upcoming" || status === "waiting_on_customer"
      ? "warn"
      : status === "lost" || status === "not_renewed"
      ? "error"
      : "neutral";
  return <Badge tone={tone}>{renewalStatusLabel[status]}</Badge>;
}