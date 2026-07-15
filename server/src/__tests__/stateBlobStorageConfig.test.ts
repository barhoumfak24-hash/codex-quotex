import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("state blob storage setup", () => {
  it("forces the state blob bucket private even when it already exists", () => {
    const sql = readFileSync(join(process.cwd(), "docs", "supabase-state-sync.sql"), "utf8");
    const bucketBlock = sql.slice(sql.indexOf("insert into storage.buckets"));

    expect(bucketBlock).toContain("values ('quotex-app-blobs', 'quotex-app-blobs', false)");
    expect(bucketBlock).toMatch(/on conflict \(id\) do update\s+set public = excluded\.public;/i);
  });
});
