import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Vercel production rewrites", () => {
  it("routes browser AI calls to the bundled server app", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      rewrites?: Array<{ source?: string; destination?: string }>;
    };

    expect(config.rewrites).toContainEqual({
      source: "/api/ai/:path*",
      destination: "/api/app?path=api/ai/:path*",
    });
  });

  it("routes live mailbox calls to the bundled server app", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      rewrites?: Array<{ source?: string; destination?: string }>;
    };

    expect(config.rewrites).toContainEqual({
      source: "/api/mailboxes/:path*",
      destination: "/api/app?path=api/mailboxes/:path*",
    });
  });

  it("proxies live mailbox calls during local Vite development", () => {
    const viteConfig = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

    expect(viteConfig).toContain('"/api/mailboxes"');
    expect(viteConfig).toContain('target: "https://quotexinsurance.com"');
  });
});
