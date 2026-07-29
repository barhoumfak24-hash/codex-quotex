import { describe, expect, it } from "vitest";
import { DEFAULT_RECIPES } from "../src/shared/defaultRecipes";
import { normalizeCarrierRecipe } from "../src/shared/recipes";
import type { CarrierRecipe } from "../src/shared/types";
import { MOCK_CARRIER_RECIPE } from "./fixtures/mockCarrier";

describe("normalizeCarrierRecipe", () => {
  it("ships the test carrier with a usable sign-in recipe", () => {
    const recipe = DEFAULT_RECIPES.find(
      (item) => item.id === "carrier_insurance_agent_hub"
    );

    expect(recipe?.selectors).toEqual({
      username: "#username",
      password: "#password",
      submit: "[data-testid='button-signin']"
    });
  });

  it("preserves a valid bounded quote automation recipe", () => {
    const normalized = normalizeCarrierRecipe(structuredClone(MOCK_CARRIER_RECIPE));

    expect(normalized.automation).toEqual(MOCK_CARRIER_RECIPE.automation);
    expect(normalized.automation?.quote?.fields.annualPremium).toBe(
      MOCK_CARRIER_RECIPE.automation?.quote?.fields.annualPremium
    );
  });

  it("drops unsafe origins and malformed quote extraction rules", () => {
    const recipe: CarrierRecipe = {
      ...structuredClone(MOCK_CARRIER_RECIPE),
      automation: {
        capabilities: ["retrieve_quote"],
        allowedOrigins: [
          "http://carrier.example",
          "javascript:alert(1)",
          "https://carrier.example/path"
        ],
        quote: {
          readySelector: "",
          fields: {
            annualPremium: ".premium",
            carrierReference: ".reference"
          }
        },
        maxRunMs: 900_000
      }
    };

    const normalized = normalizeCarrierRecipe(recipe);

    expect(normalized.automation?.allowedOrigins).toEqual(["https://carrier.example"]);
    expect(normalized.automation?.quote).toBeUndefined();
    expect(normalized.automation?.maxRunMs).toBe(120_000);
  });

  it("does not retain unsupported capabilities", () => {
    const recipe = structuredClone(MOCK_CARRIER_RECIPE) as CarrierRecipe & {
      automation: { capabilities: string[] };
    };
    recipe.automation.capabilities.push("execute_javascript");

    const normalized = normalizeCarrierRecipe(recipe as CarrierRecipe);

    expect(normalized.automation?.capabilities).toEqual(["retrieve_quote"]);
  });

  it("preserves only the approved bounded carrier submission adapter", () => {
    const recipe: CarrierRecipe = {
      ...structuredClone(MOCK_CARRIER_RECIPE),
      automation: {
        capabilities: ["retrieve_quote"],
        allowedOrigins: ["https://insurance-agent-hub.replit.app"],
        submission: {
          adapter: "insurance_agent_hub_v1",
          createEndpoint: "/api/quotes",
          detailEndpointTemplate: "/api/quotes/{id}"
        }
      }
    };

    expect(normalizeCarrierRecipe(recipe).automation?.submission).toEqual(
      recipe.automation?.submission
    );
    expect(
      normalizeCarrierRecipe({
        ...recipe,
        automation: {
          ...recipe.automation!,
          submission: {
            ...recipe.automation!.submission!,
            createEndpoint: "https://evil.example/api/quotes"
          }
        }
      }).automation?.submission
    ).toBeUndefined();
  });
});
