import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_RECIPES } from "../src/shared/defaultRecipes";

type ExtensionManifest = {
  host_permissions: string[];
  content_scripts: { matches: string[] }[];
};

const manifest = JSON.parse(
  readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8")
) as ExtensionManifest;

describe("carrier directory", () => {
  it("contains the complete 42-carrier launcher directory", () => {
    expect(DEFAULT_RECIPES).toHaveLength(42);
    expect(new Set(DEFAULT_RECIPES.map((recipe) => recipe.id)).size).toBe(42);

    for (const recipe of DEFAULT_RECIPES) {
      expect(recipe.id).toMatch(/^carrier_/);
      expect(recipe.name.trim()).not.toBe("");
      expect(() => new URL(recipe.loginUrl)).not.toThrow();
      expect(recipe.domainMatch).toMatch(/^\*:\/\/\*\.[^/]+\/\*$/);
    }
  });

  it("keeps manifest permissions synchronized with the directory", () => {
    const directoryDomains = [...new Set(DEFAULT_RECIPES.map((recipe) => recipe.domainMatch))].sort();
    const hostPermissions = [...manifest.host_permissions].sort();
    const contentScriptMatches = [...(manifest.content_scripts[0]?.matches ?? [])].sort();

    expect(hostPermissions).toEqual(directoryDomains);
    expect(contentScriptMatches).toEqual(directoryDomains);
  });
});
