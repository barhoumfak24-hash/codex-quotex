import type { CarrierRecipe } from "../../src/shared/types";

export const MOCK_CARRIER_RECIPE: CarrierRecipe = {
  id: "quotex-mock-carrier",
  name: "Quotex Mock Carrier",
  logoUrl: "",
  loginUrl: "https://mock-carrier.quotex.test/?state=login",
  domainMatch: "https://mock-carrier.quotex.test/*",
  selectors: {
    username: "#username",
    password: "#password",
    submit: "#login-submit",
    otp: "#mfa-code",
    otpSubmit: "#mfa-submit"
  },
  preSteps: [],
  postLoginSelector: "#quote-panel",
  notes: "Synthetic carrier used only for deterministic runner validation.",
  automation: {
    capabilities: ["retrieve_quote"],
    allowedOrigins: ["https://mock-carrier.quotex.test"],
    maxRunMs: 15_000,
    quote: {
      readySelector: "#quote-ready",
      fields: {
        annualPremium: "#annual-premium",
        carrierReference: "#quote-reference",
        effectiveDate: "#effective-date",
        status: "#quote-status"
      }
    }
  }
};
