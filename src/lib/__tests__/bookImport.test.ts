// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { api } from "../api";
import { stageBookImport, importBookImportBatch } from "../bookImport";
import { db } from "../db";

beforeEach(() => {
  window.localStorage.clear();
  db.reset();
});

describe("book-of-business import", () => {
  it("stages real CSV rows with field mapping and no fabricated counts", async () => {
    const agency = api.agencies.list()[0];
    const user = api.users.list(agency.id)[0];
    const csv = [
      "Name,Email,Phone,Policy Number,Carrier,Renewal Date,Asset Type",
      "Maya Stone,maya@example.com,555-0100,HO-1001,Chubb Masterpiece,2026-12-01,Home",
      "No Email Client,,555-0101,PA-2002,Travelers,,Auto",
    ].join("\n");
    const file = new File([csv], "book.csv", { type: "text/csv" });

    const batch = await stageBookImport({
      files: [file],
      agency,
      uploadedById: user.id,
      sourceLabel: "Test CSV",
    });

    expect(batch.files[0].records).toBe(2);
    expect(batch.records).toHaveLength(2);
    expect(batch.columnMappings.some((mapping) => mapping.header === "Policy Number" && mapping.targetField === "policyNumber")).toBe(true);
    expect(batch.records[1].email).toBeUndefined();
  });

  it("imports a portal-less client, creates a renewal policy, and supports explicit undo", async () => {
    const agency = api.agencies.list()[0];
    const user = api.users.list(agency.id).find((candidate) => candidate.role === "manager") ?? api.users.list(agency.id)[0];
    const csv = [
      "Name,Phone,Policy Number,Carrier,Renewal Date,Asset Type",
      "Portal Less Client,555-0102,HOME-3003,Example Imported Carrier,2026-12-01,Home",
    ].join("\n");
    const file = new File([csv], "portal-less.csv", { type: "text/csv" });
    const staged = await stageBookImport({
      files: [file],
      agency,
      uploadedById: user.id,
      sourceLabel: "Portal-less CSV",
    });
    api.importBatches.upsert(staged);

    const imported = await importBookImportBatch({
      batch: staged,
      agency,
      currentUserId: user.id,
    });

    expect(imported.status).toBe("imported");
    const customer = api.customers.list(agency.id, { includeArchived: true }).find((row) => row.name === "Portal Less Client");
    expect(customer).toBeTruthy();
    expect(customer?.email).toBe("");
    expect(customer?.userId).toBe("");
    expect(api.policies.listByCustomer(customer!.id)).toHaveLength(1);
    expect(api.renewals.listByTenant(agency.id).some((renewal) => renewal.importBatchId === staged.id)).toBe(true);

    const undone = api.importBatches.undo(staged.id, user.id);
    expect(undone?.status).toBe("undone");
    expect(api.customers.list(agency.id, { includeArchived: true }).some((row) => row.name === "Portal Less Client")).toBe(false);
  });
});
