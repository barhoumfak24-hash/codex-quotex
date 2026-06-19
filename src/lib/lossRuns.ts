import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Carrier, Claim, CustomerProfile, Policy } from "@/types";

export type LossRunAudience = "client" | "holders" | "carriers";

export interface LossRunRow {
  claim: Claim;
  policy?: Policy;
  carrier?: Carrier;
  assetLabel: string;
  policyRef: string;
  claimNumber: string;
  statusLabel: string;
  lossDescription: string;
  lossAmountLabel: string;
  openedDate: string;
  closedDate: string;
  lineOfBusiness: string;
}

export interface LossRunReport {
  customer: CustomerProfile;
  agencyName: string;
  generatedAt: string;
  rows: LossRunRow[];
  openCount: number;
  closedCount: number;
  inReviewCount: number;
}

export function buildLossRunReport(customerId: string): LossRunReport | null {
  const customer = api.customers.get(customerId);
  if (!customer) return null;
  const agencyName = api.agencies.get(customer.tenantId)?.name ?? "Agency";
  const claims = api.claims
    .listByCustomer(customerId)
    .slice()
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));

  const rows = claims.map((claim) => {
    const policy = api.policies.get(claim.policyId);
    const carrier = api.carriers.get(claim.carrierId);
    const asset = policy ? api.assets.get(policy.assetId) : undefined;
    return {
      claim,
      policy,
      carrier,
      assetLabel: asset?.label ?? "Not recorded",
      policyRef: fmt.policyRef(policy),
      claimNumber: claim.externalClaimNumber ?? claim.id,
      statusLabel: fmt.titleCase(claim.status.replace(/_/g, " ")),
      lossDescription: claim.lossDescription?.trim() || "No loss description recorded",
      lossAmountLabel:
        typeof claim.lossAmountUsd === "number" && Number.isFinite(claim.lossAmountUsd)
          ? fmt.money(claim.lossAmountUsd)
          : "Amount not recorded",
      openedDate: fmt.date(claim.openedAt),
      closedDate: claim.closedAt ? fmt.date(claim.closedAt) : "Open",
      lineOfBusiness: api.helpers.departmentLabel(policy),
    };
  });

  return {
    customer,
    agencyName,
    generatedAt: new Date().toISOString(),
    rows,
    openCount: rows.filter((row) => row.claim.status === "opened").length,
    closedCount: rows.filter((row) => row.claim.status === "closed").length,
    inReviewCount: rows.filter((row) => row.claim.status === "in_review").length,
  };
}

export function lossRunPdfFileName(report: LossRunReport): string {
  const name = report.customer.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${name || "client"}-loss-runs.pdf`;
}

export function lossRunAttachment(report: LossRunReport) {
  return {
    id: `lossrun_${report.customer.id}`,
    fileName: lossRunPdfFileName(report),
    fileType: "application/pdf",
    description: "Previous loss runs PDF",
  };
}

export function lossRunSubject(report: LossRunReport): string {
  return `Previous loss runs - ${report.customer.name}`;
}

export function buildLossRunEmailBody(report: LossRunReport, audience: LossRunAudience): string {
  const rows = report.rows.length
    ? report.rows.map((row, index) =>
        [
          `${index + 1}. ${row.claimNumber}`,
          `Policy: ${row.policyRef}`,
          `Carrier: ${row.carrier?.name ?? "Carrier not recorded"}`,
          `Asset: ${row.assetLabel}`,
          `Loss: ${row.lossDescription}`,
          `Amount: ${row.lossAmountLabel}`,
          `Opened: ${row.openedDate}`,
          `Status: ${row.statusLabel}`,
          `Closed: ${row.closedDate}`,
        ].join(" | ")
      )
    : ["No recorded claims or losses are currently on file for this client."];

  const opener =
    audience === "client"
      ? `Attached is the current previous loss-runs summary we have on file for you.`
      : audience === "holders"
      ? `Attached is the current previous loss-runs summary for ${report.customer.name}.`
      : `Attached is the current previous loss-runs summary for ${report.customer.name} for your carrier file.`;

  return [
    audience === "client" ? `Hi ${report.customer.name.split(/\s+/)[0] || report.customer.name},` : "Hello,",
    "",
    opener,
    "",
    `Client: ${report.customer.name}`,
    `Agency: ${report.agencyName}`,
    `Generated: ${fmt.dateTime(report.generatedAt)}`,
    `Total recorded claims: ${report.rows.length}`,
    `Open: ${report.openCount}`,
    `In review: ${report.inReviewCount}`,
    `Closed: ${report.closedCount}`,
    "",
    "Loss-run detail:",
    ...rows,
    "",
    "The attached PDF is generated from the agency record. Please reply if you need the official carrier-issued loss run or any additional claim documentation.",
    "",
    "Thank you.",
  ].join("\n");
}

export function downloadLossRunPdf(customerId: string): void {
  const report = buildLossRunReport(customerId);
  if (!report) return;
  openPrintWindow(buildLossRunPrintHtml(report));
}

export function buildLossRunPrintHtml(report: LossRunReport): string {
  const generated = fmt.dateTime(report.generatedAt);
  const rows = report.rows.length
    ? report.rows
        .map(
          (row) => `<tr>
            <td><strong>${esc(row.claimNumber)}</strong><span>${esc(row.statusLabel)}</span><span>${esc(row.lossDescription)}</span></td>
            <td>${esc(row.policyRef)}<span>${esc(row.lineOfBusiness)}</span></td>
            <td>${esc(row.carrier?.name ?? "Carrier not recorded")}<span>${esc(row.assetLabel)}</span><span>${esc(row.lossAmountLabel)}</span></td>
            <td>${esc(row.openedDate)}</td>
            <td>${esc(row.closedDate)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="empty">No recorded claims or losses are currently on file.</td></tr>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(lossRunSubject(report))}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f1eb; color: #17130f; font-family: Inter, Arial, sans-serif; }
    main { max-width: 980px; margin: 0 auto; min-height: 100vh; background: #fff; padding: 44px; }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #17130f; padding-bottom: 20px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: .01em; }
    .eyebrow { margin-bottom: 8px; color: #9a7828; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .sub { margin-top: 8px; color: #655f56; font-size: 13px; line-height: 1.5; }
    .meta { text-align: right; color: #655f56; font-size: 12px; line-height: 1.7; min-width: 210px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
    .stat { border: 1px solid #ded7cb; border-radius: 8px; padding: 12px; }
    .stat span { display: block; color: #655f56; font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .stat strong { display: block; margin-top: 6px; font-size: 24px; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #ded7cb; }
    th { background: #17130f; color: #fff; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; text-align: left; padding: 11px 12px; }
    td { border-top: 1px solid #e8e2d8; padding: 13px 12px; vertical-align: top; font-size: 13px; }
    td span { display: block; margin-top: 4px; color: #766f65; font-size: 11px; }
    .empty { color: #766f65; text-align: center; padding: 28px; }
    footer { margin-top: 28px; border-top: 1px solid #ded7cb; padding-top: 12px; color: #766f65; font-size: 11px; line-height: 1.5; }
    @media print {
      body { background: #fff; }
      main { max-width: none; padding: 24px; }
      .stat, table { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="eyebrow">Previous loss runs</div>
        <h1>${esc(report.customer.name)}</h1>
        <div class="sub">${esc(report.agencyName)} client loss history generated from recorded claim activity.</div>
      </div>
      <div class="meta">
        <div><strong>Generated</strong><br />${esc(generated)}</div>
        <div><strong>Client code</strong><br />${esc(api.helpers.clientCodeFor(report.customer))}</div>
      </div>
    </header>
    <section class="stats">
      <div class="stat"><span>Total</span><strong>${report.rows.length}</strong></div>
      <div class="stat"><span>Open</span><strong>${report.openCount}</strong></div>
      <div class="stat"><span>In review</span><strong>${report.inReviewCount}</strong></div>
      <div class="stat"><span>Closed</span><strong>${report.closedCount}</strong></div>
    </section>
    <table>
      <thead>
        <tr>
          <th>Claim</th>
          <th>Policy</th>
          <th>Carrier / Asset</th>
          <th>Opened</th>
          <th>Closed</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <footer>
      This report is generated from the agency system of record. Reconcile against official carrier-issued loss runs before external underwriting submission.
    </footer>
  </main>
</body>
</html>`;
}

function openPrintWindow(html: string): void {
  const w = window.open("", "_blank", "noopener,noreferrer,width=940,height=1000");
  if (!w) {
    alert("Pop-up blocked. Allow pop-ups for this site to download the loss-runs PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => {
    w.focus();
    w.print();
  };
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* user closed the print window */
    }
  }, 400);
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
