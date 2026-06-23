import fs from "node:fs";
import path from "node:path";
import { timestampSlug } from "./lib/backup-env.mjs";

const args = parseArgs(process.argv.slice(2));
const reportedAt = args.reportedAt || new Date().toISOString();
const agencyId = args.agencyId || "";
const agencyName = args.agency || "";
const incidentSlug = safeSegment(
  [timestampSlug(new Date()), agencyId || agencyName || "agency-unknown"].filter(Boolean).join("-")
);
const incidentRoot = path.resolve(process.cwd(), "artifacts", "disaster-recovery", incidentSlug);

fs.mkdirSync(incidentRoot, { recursive: true });
fs.mkdirSync(path.join(incidentRoot, "evidence"), { recursive: true });
fs.mkdirSync(path.join(incidentRoot, "snapshots"), { recursive: true });

const incident = {
  id: incidentSlug,
  status: "triage",
  reportedAt,
  agencyId,
  agencyName,
  summary: args.summary || "",
  lastKnownGoodAt: args.lastKnownGood || "",
  suspectedLossWindowStart: "",
  suspectedLossWindowEnd: "",
  affectedAreas: [],
  decisionLog: [],
};

writeJson("incident.json", incident);
writeText("timeline.md", timelineTemplate(incident));
writeText("triage-checklist.md", triageChecklistTemplate(incident));
writeText("restore-plan.md", restorePlanTemplate(incident));
writeText("commands.md", commandsTemplate(incident));

console.log(`Created disaster-recovery incident packet: ${incidentRoot}`);

function timelineTemplate(input) {
  return `# Disaster Recovery Timeline

- Reported: ${input.reportedAt}
- Agency ID: ${input.agencyId || "unknown"}
- Agency: ${input.agencyName || "unknown"}
- Summary: ${input.summary || "TBD"}

## Timeline

| Time | Event | Evidence |
| --- | --- | --- |
| ${input.reportedAt} | Incident reported | Initial report |

## Decisions

| Time | Decision | Reason | Owner |
| --- | --- | --- | --- |
`;
}

function triageChecklistTemplate(input) {
  return `# Triage Checklist

## First 15 Minutes

- [ ] Confirm the affected agency and tenant ID: \`${input.agencyId || "TBD"}\`
- [ ] Freeze risky writes if corruption/deletion is suspected.
- [ ] Capture screenshots or exact user reports in \`evidence/\`.
- [ ] Run \`pnpm run dr:live-check\`.
- [ ] Confirm whether data is truly missing, hidden by filters, blocked by permissions, archived, or failing to load.
- [ ] Identify last known good timestamp.
- [ ] Check audit logs for deletes, imports, syncs, migrations, or automation runs.

## Scope

- [ ] Customers affected
- [ ] Policies affected
- [ ] Documents/files affected
- [ ] Messages affected
- [ ] Quotes/workflows affected
- [ ] Users/permissions affected

## Safety Gates

- [ ] No direct production restore until the isolated recovery environment is validated.
- [ ] No cross-tenant data movement.
- [ ] No sensitive export committed to Git.
- [ ] Credentials rotated if credential exposure is suspected.
`;
}

function restorePlanTemplate(input) {
  return `# Restore Plan

## Recovery Point

- Target tenant: \`${input.agencyId || "TBD"}\`
- Last known good: ${input.lastKnownGoodAt || "TBD"}
- Preferred recovery source: Supabase PITR if enabled and inside the recovery window.

## Procedure

1. Restore database to an isolated Supabase recovery project.
2. Restore matching private storage bucket objects into the isolated recovery project.
3. Validate tenant isolation in the restored environment.
4. Export the affected tenant from the isolated recovery project.
5. Reinsert only missing/corrupted records into production after a written approval checkpoint.
6. Validate customer/profile/policy/message/document screens in production.
7. Resume writes.

## Validation

- [ ] Agency can see its recovered data.
- [ ] Other agencies cannot see this tenant's data.
- [ ] Documents open through authenticated flows.
- [ ] Activity/message timeline reflects the recovery action.
- [ ] The incident timeline is complete.
`;
}

function commandsTemplate(input) {
  const tenant = input.agencyId || "<tenant-id>";
  return `# Commands

Run from the project root.

\`\`\`powershell
$env:PATH='C:\\Users\\barho\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\bin;C:\\Users\\barho\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin;C:\\Users\\barho\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies;' + $env:PATH
pnpm run dr:live-check
pnpm run dr:check
node scripts/dr-export-tenant-snapshot.mjs --tenant-id ${tenant} --output-dir "${incidentRoot.replace(/\\/g, "\\\\")}\\snapshots\\current-production"
\`\`\`

For a restored isolated database, point \`DATABASE_URL\` and \`DIRECT_URL\` at the recovery project before exporting the tenant snapshot.
`;
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1] ?? "";
    if (arg === "--agency-id") {
      parsed.agencyId = next;
      index += 1;
    } else if (arg.startsWith("--agency-id=")) {
      parsed.agencyId = arg.slice("--agency-id=".length);
    } else if (arg === "--agency") {
      parsed.agency = next;
      index += 1;
    } else if (arg.startsWith("--agency=")) {
      parsed.agency = arg.slice("--agency=".length);
    } else if (arg === "--reported-at") {
      parsed.reportedAt = next;
      index += 1;
    } else if (arg.startsWith("--reported-at=")) {
      parsed.reportedAt = arg.slice("--reported-at=".length);
    } else if (arg === "--last-known-good") {
      parsed.lastKnownGood = next;
      index += 1;
    } else if (arg.startsWith("--last-known-good=")) {
      parsed.lastKnownGood = arg.slice("--last-known-good=".length);
    } else if (arg === "--summary") {
      parsed.summary = next;
      index += 1;
    } else if (arg.startsWith("--summary=")) {
      parsed.summary = arg.slice("--summary=".length);
    }
  }
  return parsed;
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(incidentRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(relativePath, value) {
  fs.writeFileSync(path.join(incidentRoot, relativePath), value);
}

function safeSegment(value) {
  return String(value)
    .replace(/[^a-z0-9_.-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
}
