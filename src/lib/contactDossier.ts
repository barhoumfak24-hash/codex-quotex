import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

// =====================================================================
// Contact dossier export.
//
// Compiles everything on file for a client or prospect — profile,
// assets, policies, claims, documents, messages (email + SMS),
// timeline + remarks, and open/closed activities — into a clean,
// print-ready HTML document and opens the browser print dialog so the
// user can save it as a PDF. Dependency-free (no jsPDF): the browser's
// "Save as PDF" target produces the file.
// =====================================================================

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function row(label: string, value: string): string {
  return `<tr><th>${esc(label)}</th><td>${value || "—"}</td></tr>`;
}

function section(title: string, inner: string): string {
  return `<section><h2>${esc(title)}</h2>${inner}</section>`;
}

function emptyNote(text: string): string {
  return `<p class="empty">${esc(text)}</p>`;
}

export function downloadContactDossier(input: {
  kind: "client" | "prospect";
  id: string;
}): void {
  const html =
    input.kind === "client"
      ? buildClientDossier(input.id)
      : buildProspectDossier(input.id);
  if (!html) return;
  openPrintWindow(html);
}

function agentName(id?: string): string {
  if (!id) return "—";
  return api.users.get(id)?.name ?? "—";
}

function buildClientDossier(customerId: string): string | null {
  const c = api.customers.get(customerId);
  if (!c) return null;
  const agency = api.agencies.get(c.tenantId);
  const assets = api.assets.listByCustomer(c.id);
  const policies = api.policies.listByCustomer(c.id);
  const claims = api.claims.listByCustomer(c.id);
  const documents = api.documents.listByEntity({ customerId: c.id });
  const comms = api.communications
    .listByCustomer(c.id)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const marketing = api.marketing
    .listMessages(c.tenantId)
    .filter((m) => m.customerId === c.id);
  const events = api.status
    .listFor({ customerId: c.id })
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const notes = api.notes.listByCustomer(c.id);
  const activities = api.tasks
    .listByTenant(c.tenantId)
    .filter((t) => t.customerId === c.id);

  const additional = (c.additionalAgentIds ?? [])
    .filter((id) => id !== c.assignedAgentId)
    .map(agentName)
    .join(", ");

  const profile = `<table class="kv">
    ${row("Client code", esc(api.helpers.clientCodeFor(c)))}
    ${row("Name", esc(c.name))}
    ${row("Email", esc(c.email))}
    ${row("Phone", esc(c.phone ?? "—"))}
    ${row("Joined", esc(fmt.date(c.createdAt)))}
    ${row("Managed by", esc(agentName(c.assignedAgentId)))}
    ${additional ? row("Co-managed by", esc(additional)) : ""}
  </table>`;

  const assetsTable = assets.length
    ? table(
        ["Asset", "Type", "Est. value", "Status"],
        assets.map((a) => [
          esc(a.label),
          esc(api.helpers.assetTypeLabel(a.type)),
          a.estimatedValue ? esc(fmt.money(a.estimatedValue)) : "—",
          esc(fmt.titleCase(a.status)),
        ])
      )
    : emptyNote("No assets on file.");

  const policiesTable = policies.length
    ? table(
        ["Policy", "Carrier", "Line", "Status", "Premium", "Renews"],
        policies.map((p) => [
          esc(fmt.policyRef(p)),
          esc(api.carriers.get(p.carrierId)?.name ?? "—"),
          esc(api.helpers.departmentLabel(p)),
          esc(fmt.titleCase(p.status.replace(/_/g, " "))),
          esc(
            p.finalPremium
              ? fmt.money(p.finalPremium)
              : p.premiumEstimate
              ? fmt.money(p.premiumEstimate)
              : "—"
          ),
          esc(fmt.date(p.renewalDate)),
        ])
      )
    : emptyNote("No policies on file.");

  const claimsTable = claims.length
    ? table(
        ["Claim #", "Status", "Opened", "Closed"],
        claims.map((cl) => [
          esc(cl.externalClaimNumber ?? cl.id),
          esc(fmt.titleCase(cl.status.replace(/_/g, " "))),
          esc(fmt.date(cl.openedAt)),
          esc(cl.closedAt ? fmt.date(cl.closedAt) : "—"),
        ])
      )
    : emptyNote("No claims on file.");

  const docsTable = documents.length
    ? table(
        ["File", "Type", "Visibility", "Status", "Uploaded"],
        documents.map((d) => [
          esc(d.fileName),
          esc(api.helpers.documentTypeLabel(d.type as string)),
          esc(d.visibility.replace(/_/g, " ")),
          esc(fmt.titleCase(d.status)),
          esc(fmt.date(d.uploadedAt)),
        ])
      )
    : emptyNote("No documents on file.");

  const messages = renderMessages(comms, marketing);
  const timeline = renderTimeline(events, notes);
  const activitiesBlock = renderActivities(activities);

  const body = [
    section("Client profile", profile),
    section("Assets", assetsTable),
    section("Policies", policiesTable),
    section("Claims", claimsTable),
    section("Documents on file", docsTable),
    section("Messages", messages),
    section("Timeline & remarks", timeline),
    section("Activities", activitiesBlock),
  ].join("");

  return wrap({
    title: `Client dossier — ${c.name}`,
    heading: c.name,
    sub: `Client · ${agency?.name ?? ""}`,
    body,
  });
}

function buildProspectDossier(prospectId: string): string | null {
  const p = api.prospects.get(prospectId);
  if (!p) return null;
  const agency = api.agencies.get(p.tenantId);
  const comms = api.communications
    .listByTenant(p.tenantId)
    .filter((c) => c.prospectId === p.id)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const marketing = api.marketing
    .listMessages(p.tenantId)
    .filter((m) => m.prospectId === p.id);
  const events = api.status
    .listFor({ prospectId: p.id })
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const notes = api.notes.listByProspect(p.id);
  const activities = api.tasks
    .listByTenant(p.tenantId)
    .filter((t) => t.prospectId === p.id);

  const profile = `<table class="kv">
    ${row("Name", esc(p.name))}
    ${row("Email", esc(p.email))}
    ${row("Phone", esc(p.phone ?? "—"))}
    ${row("Interest", esc(api.helpers.assetTypeLabel(p.assetType)))}
    ${row("Estimated value", p.estimatedValue ? esc(fmt.money(p.estimatedValue)) : "—")}
    ${row("Status", esc(fmt.titleCase(p.status.replace(/_/g, " "))))}
    ${row("Marketing", esc(p.marketingStatus))}
    ${row("Managed by", esc(agentName(p.assignedAgentId)))}
    ${row("Last activity", esc(fmt.dateTime(p.lastActivityAt)))}
  </table>`;

  const aiSummary = p.aiSummary
    ? `<p>${esc(p.aiSummary)}</p>`
    : emptyNote("No AI summary.");

  const body = [
    section("Prospect profile", profile),
    section("AI summary", aiSummary),
    section("Messages", renderMessages(comms, marketing)),
    section("Timeline & remarks", renderTimeline(events, notes)),
    section("Activities", renderActivities(activities)),
  ].join("");

  return wrap({
    title: `Prospect dossier — ${p.name}`,
    heading: p.name,
    sub: `Prospect · ${agency?.name ?? ""}`,
    body,
  });
}

// ---- shared renderers ------------------------------------------------

function table(headers: string[], rows: string[][]): string {
  return `<table class="grid">
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
      .join("")}</tbody>
  </table>`;
}

function renderMessages(
  comms: { channel: string; direction: string; subject?: string; body: string; createdAt: string }[],
  marketing: { channel: string; subject?: string; content: string; sentAt?: string; createdAt: string }[]
): string {
  const rows = [
    ...comms.map((c) => ({
      at: c.createdAt,
      channel: String(c.channel).toUpperCase(),
      who: c.direction === "inbound" ? "Inbound" : "Outbound",
      subject: c.subject ?? "",
      body: c.body,
    })),
    ...marketing.map((m) => ({
      at: m.sentAt ?? m.createdAt,
      channel: String(m.channel).toUpperCase(),
      who: "AI send",
      subject: m.subject ?? "",
      body: m.content,
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
  if (rows.length === 0) return emptyNote("No messages on file.");
  return rows
    .map(
      (r) => `<div class="msg">
        <div class="msg-meta">${esc(r.channel)} · ${esc(r.who)} · ${esc(fmt.dateTime(r.at))}</div>
        ${r.subject ? `<div class="msg-subject">${esc(r.subject)}</div>` : ""}
        <div class="msg-body">${esc(r.body)}</div>
      </div>`
    )
    .join("");
}

function renderTimeline(
  events: { message: string; createdAt: string; source: string; createdById?: string }[],
  notes: { body: string; createdAt: string; authorId: string }[]
): string {
  const rows = [
    ...events.map((e) => ({
      at: e.createdAt,
      who: e.createdById ? api.users.get(e.createdById)?.name ?? e.source : e.source,
      text: e.message,
    })),
    ...notes.map((n) => ({
      at: n.createdAt,
      who: api.users.get(n.authorId)?.name ?? "Remark",
      text: n.body,
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
  if (rows.length === 0) return emptyNote("No timeline activity on file.");
  return `<ul class="timeline">${rows
    .map(
      (r) =>
        `<li><span class="ts">${esc(fmt.dateTime(r.at))}</span> <span class="who">${esc(
          r.who
        )}</span><div>${esc(r.text)}</div></li>`
    )
    .join("")}</ul>`;
}

function renderActivities(
  activities: { title: string; description?: string; status?: string; completedAt?: string; createdAt: string }[]
): string {
  if (activities.length === 0) return emptyNote("No activities on file.");
  return table(
    ["Activity", "Status", "Created"],
    activities.map((t) => [
      esc(t.title) + (t.description ? `<div class="muted">${esc(t.description)}</div>` : ""),
      esc(t.completedAt ? "Resolved" : fmt.titleCase((t.status ?? "open").replace(/_/g, " "))),
      esc(fmt.date(t.createdAt)),
    ])
  );
}

// ---- document shell + print -----------------------------------------

function wrap(input: {
  title: string;
  heading: string;
  sub: string;
  body: string;
}): string {
  const generated = fmt.dateTime(new Date().toISOString());
  return `<!doctype html><html><head><meta charset="utf-8" />
  <title>${esc(input.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Georgia, "Times New Roman", serif; color: #1f2430; margin: 40px; line-height: 1.5; }
    header { border-bottom: 3px solid #b8923f; padding-bottom: 14px; margin-bottom: 24px; }
    header h1 { font-size: 26px; margin: 0 0 4px; }
    header .sub { color: #6b7280; font-size: 13px; }
    header .gen { color: #9ca3af; font-size: 11px; margin-top: 6px; }
    section { margin: 0 0 22px; page-break-inside: avoid; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: #b8923f; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    table.kv th { text-align: left; width: 180px; color: #6b7280; font-weight: 600; vertical-align: top; padding: 4px 8px 4px 0; }
    table.kv td { padding: 4px 0; }
    table.grid th { text-align: left; background: #f6f3ec; color: #6b7280; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
    table.grid td { padding: 6px 8px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
    .muted { color: #9ca3af; font-size: 11px; margin-top: 2px; }
    .empty { color: #9ca3af; font-style: italic; font-size: 12.5px; }
    .msg { border: 1px solid #eef0f3; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
    .msg-meta { color: #9ca3af; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; }
    .msg-subject { font-weight: 700; margin: 2px 0; }
    .msg-body { white-space: pre-wrap; font-size: 12.5px; }
    ul.timeline { list-style: none; padding: 0; margin: 0; }
    ul.timeline li { padding: 6px 0; border-bottom: 1px solid #eef0f3; font-size: 12.5px; }
    ul.timeline .ts { color: #9ca3af; font-size: 11px; margin-right: 8px; }
    ul.timeline .who { color: #b8923f; font-weight: 600; font-size: 11px; }
    @media print { body { margin: 18px; } }
  </style></head>
  <body>
    <header>
      <h1>${esc(input.heading)}</h1>
      <div class="sub">${esc(input.sub)}</div>
      <div class="gen">Generated ${esc(generated)} · Quotex</div>
    </header>
    ${input.body}
  </body></html>`;
}

function openPrintWindow(html: string): void {
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
  if (!w) {
    alert("Pop-up blocked. Allow pop-ups for this site to download the dossier.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give the new document a tick to lay out before invoking print.
  w.onload = () => {
    w.focus();
    w.print();
  };
  // Fallback if onload doesn't fire (already-complete documents).
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* user closed the window */
    }
  }, 400);
}
