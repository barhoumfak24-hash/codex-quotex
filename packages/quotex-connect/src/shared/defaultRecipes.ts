import type { CarrierAutomationRecipe, CarrierRecipe } from "./types";

type RecipeSeed = {
  id: string;
  name: string;
  loginUrl: string;
  domainMatch: string;
  selectors?: CarrierRecipe["selectors"];
  postLoginSelector?: string;
  notes?: string;
  automation?: CarrierAutomationRecipe;
};

const NEEDS_SELECTORS =
  "Carrier portal is included in the launcher. Add verified login selectors before auto-fill is enabled for this carrier.";

function recipe(seed: RecipeSeed): CarrierRecipe {
  return {
    id: seed.id,
    name: seed.name,
    logoUrl: "",
    loginUrl: seed.loginUrl,
    domainMatch: seed.domainMatch,
    selectors: seed.selectors ?? {
      username: "",
      password: "",
      submit: ""
    },
    preSteps: [],
    postLoginSelector: seed.postLoginSelector ?? "",
    notes: seed.notes ?? NEEDS_SELECTORS,
    ...(seed.automation ? { automation: seed.automation } : {})
  };
}

export const DEFAULT_RECIPES: CarrierRecipe[] = [
  recipe({
    id: "carrier_chubb",
    name: "Chubb Masterpiece",
    loginUrl: "https://www.chubb.com/us-en/agents-brokers.html",
    domainMatch: "*://*.chubb.com/*"
  }),
  recipe({
    id: "carrier_pure",
    name: "PURE Insurance",
    loginUrl: "https://broker.pureinsurance.com/",
    domainMatch: "*://*.pureinsurance.com/*"
  }),
  recipe({
    id: "carrier_aig",
    name: "AIG Private Client Select",
    loginUrl: "https://www.aig.com/business/insurance/login",
    domainMatch: "*://*.aig.com/*"
  }),
  recipe({
    id: "carrier_cincinnati_home",
    name: "Cincinnati Insurance (HOME)",
    loginUrl: "https://www.cinfin.com/cincinnati-insurance-agents",
    domainMatch: "*://*.cinfin.com/*"
  }),
  recipe({
    id: "carrier_vault",
    name: "Vault Insurance",
    loginUrl: "https://www.vault.insurance/",
    domainMatch: "*://*.vault.insurance/*"
  }),
  recipe({
    id: "carrier_berkley_one",
    name: "Berkley One",
    loginUrl: "https://my.berkleyone.com/",
    domainMatch: "*://*.berkleyone.com/*"
  }),
  recipe({
    id: "carrier_crestbrook",
    name: "Crestbrook (Nationwide Private Client)",
    loginUrl: "https://www.agentcenter.nationwide.com",
    domainMatch: "*://*.agentcenter.nationwide.com/*",
    notes: "Crestbrook uses Nationwide Agent Center when the agency is appointed. Add verified selectors before auto-fill."
  }),
  recipe({
    id: "carrier_hagerty",
    name: "Hagerty",
    loginUrl: "https://www.hagertyagent.com/",
    domainMatch: "*://*.hagertyagent.com/*"
  }),
  recipe({
    id: "carrier_markel",
    name: "Markel Specialty",
    loginUrl: "https://magic.markelamerican.com/",
    domainMatch: "*://*.markelamerican.com/*"
  }),
  recipe({
    id: "carrier_natgen_premier",
    name: "National General Premier",
    loginUrl: "https://natgenagency.com/",
    domainMatch: "*://*.natgenagency.com/*"
  }),
  recipe({
    id: "carrier_travelers",
    name: "Travelers",
    loginUrl: "https://www.travelers.com/agents/login",
    domainMatch: "*://*.travelers.com/*"
  }),
  recipe({
    id: "carrier_liberty",
    name: "Liberty Mutual",
    loginUrl: "https://agents.libertymutual.com/",
    domainMatch: "*://*.libertymutual.com/*"
  }),
  recipe({
    id: "carrier_safeco",
    name: "Safeco (Liberty Mutual)",
    loginUrl: "https://agents.libertymutual.com/",
    domainMatch: "*://*.libertymutual.com/*",
    notes: "Safeco is routed through Liberty Mutual/Safeco agent access. Add verified selectors before auto-fill."
  }),
  recipe({
    id: "carrier_hartford",
    name: "The Hartford",
    loginUrl: "https://account.thehartford.com/agent/login",
    domainMatch: "*://*.thehartford.com/*"
  }),
  recipe({
    id: "carrier_nationwide",
    name: "Nationwide",
    loginUrl: "https://www.agentcenter.nationwide.com",
    domainMatch: "*://*.agentcenter.nationwide.com/*"
  }),
  recipe({
    id: "carrier_progressive",
    name: "Progressive",
    loginUrl: "https://www.foragentsonly.com/",
    domainMatch: "*://*.foragentsonly.com/*"
  }),
  recipe({
    id: "carrier_allstate",
    name: "Allstate",
    loginUrl: "https://agents.allstate.com",
    domainMatch: "*://*.allstate.com/*"
  }),
  recipe({
    id: "carrier_farmers",
    name: "Farmers",
    loginUrl: "https://agents.farmers.com",
    domainMatch: "*://*.farmers.com/*"
  }),
  recipe({
    id: "carrier_statefarm",
    name: "State Farm",
    loginUrl: "https://b2b.statefarm.com",
    domainMatch: "*://*.statefarm.com/*"
  }),
  recipe({
    id: "carrier_usaa",
    name: "USAA",
    loginUrl: "https://www.usaa.com/",
    domainMatch: "*://*.usaa.com/*",
    notes: "USAA is included for completeness, but no independent-agent auto-fill recipe is enabled unless the agency supplies an authorized portal workflow."
  }),
  recipe({
    id: "carrier_autoowners",
    name: "Auto-Owners Insurance",
    loginUrl: "https://www.auto-owners.com/",
    domainMatch: "*://*.auto-owners.com/*"
  }),
  recipe({
    id: "carrier_erie",
    name: "Erie Insurance",
    loginUrl: "https://www.agentexchange.com/",
    domainMatch: "*://*.agentexchange.com/*"
  }),
  recipe({
    id: "carrier_mercury",
    name: "Mercury Insurance",
    loginUrl: "https://www.mercuryinsurance.com/",
    domainMatch: "*://*.mercuryinsurance.com/*"
  }),
  recipe({
    id: "carrier_amfam",
    name: "American Family",
    loginUrl: "https://www.amfam.com/",
    domainMatch: "*://*.amfam.com/*"
  }),
  recipe({
    id: "carrier_foremost",
    name: "Foremost (Farmers Specialty)",
    loginUrl: "https://www.foremoststar.com/",
    domainMatch: "*://*.foremoststar.com/*"
  }),
  recipe({
    id: "carrier_stillwater",
    name: "Stillwater Insurance",
    loginUrl: "https://www.stillwater.com/",
    domainMatch: "*://*.stillwater.com/*"
  }),
  recipe({
    id: "carrier_plymouth_rock",
    name: "Plymouth Rock Assurance",
    loginUrl: "https://www.plymouthrock.com/",
    domainMatch: "*://*.plymouthrock.com/*"
  }),
  recipe({
    id: "carrier_kemper",
    name: "Kemper",
    loginUrl: "https://agents.kemper.com/",
    domainMatch: "*://*.kemper.com/*"
  }),
  recipe({
    id: "carrier_westfield",
    name: "Westfield Insurance",
    loginUrl: "https://www.westfieldinsurance.com/",
    domainMatch: "*://*.westfieldinsurance.com/*"
  }),
  recipe({
    id: "carrier_amtrust",
    name: "AmTrust Financial",
    loginUrl: "https://amtrustfinancial.com/",
    domainMatch: "*://*.amtrustfinancial.com/*"
  }),
  recipe({
    id: "carrier_auto_club_group",
    name: "Auto Club Group (AAA)",
    loginUrl: "https://www.aaa.com/insurance",
    domainMatch: "*://*.aaa.com/*"
  }),
  recipe({
    id: "carrier_michigan_farm_bureau",
    name: "Michigan Farm Bureau Insurance",
    loginUrl: "https://www.michfb.com/insurance",
    domainMatch: "*://*.michfb.com/*"
  }),
  recipe({
    id: "carrier_frankenmuth",
    name: "Frankenmuth Insurance",
    loginUrl: "https://www.fmins.com/agents",
    domainMatch: "*://*.fmins.com/*"
  }),
  recipe({
    id: "carrier_hanover_citizens",
    name: "Citizens / The Hanover",
    loginUrl: "https://www.hanover.com/agents",
    domainMatch: "*://*.hanover.com/*"
  }),
  recipe({
    id: "carrier_pioneer_state_mutual",
    name: "Pioneer State Mutual",
    loginUrl: "https://www.psmic.com",
    domainMatch: "*://*.psmic.com/*"
  }),
  recipe({
    id: "carrier_hastings_mutual",
    name: "Hastings Mutual Insurance",
    loginUrl: "https://www.hastingsmutual.com",
    domainMatch: "*://*.hastingsmutual.com/*"
  }),
  recipe({
    id: "carrier_fremont",
    name: "Fremont Insurance",
    loginUrl: "https://www.fmic.com",
    domainMatch: "*://*.fmic.com/*"
  }),
  recipe({
    id: "carrier_michigan_insurance_company",
    name: "Michigan Insurance Company",
    loginUrl: "https://www.michiganinsurance.com",
    domainMatch: "*://*.michiganinsurance.com/*"
  }),
  recipe({
    id: "carrier_secura",
    name: "SECURA Insurance",
    loginUrl: "https://www.secura.net/agents",
    domainMatch: "*://*.secura.net/*"
  }),
  recipe({
    id: "carrier_grange",
    name: "Grange Insurance",
    loginUrl: "https://www.grangeinsurance.com/agents",
    domainMatch: "*://*.grangeinsurance.com/*"
  }),
  recipe({
    id: "carrier_west_bend",
    name: "West Bend Insurance",
    loginUrl: "https://www.thesilverlining.com",
    domainMatch: "*://*.thesilverlining.com/*"
  }),
  recipe({
    id: "carrier_meemic",
    name: "MEEMIC Insurance",
    loginUrl: "https://www.meemic.com",
    domainMatch: "*://*.meemic.com/*"
  }),
  recipe({
    id: "carrier_insurance_agent_hub",
    name: "Insurance Agent Hub",
    loginUrl: "https://insurance-agent-hub.replit.app/sign-in",
    domainMatch: "*://*.insurance-agent-hub.replit.app/*",
    selectors: {
      username: "#username",
      password: "#password",
      submit: "[data-testid='button-signin']"
    },
    notes:
      "Agency-configured carrier portal. Save the authorized login locally in Quotex Connect before use.",
    automation: {
      capabilities: ["retrieve_quote"],
      allowedOrigins: ["https://insurance-agent-hub.replit.app"],
      submission: {
        adapter: "insurance_agent_hub_v1",
        createEndpoint: "/api/quotes",
        detailEndpointTemplate: "/api/quotes/{id}"
      },
      maxRunMs: 120_000
    }
  })
];

export const RECIPE_TEMPLATE: CarrierRecipe = {
  id: "carrier-id",
  name: "Carrier name",
  logoUrl: "",
  loginUrl: "https://carrier.example/login",
  domainMatch: "*://*.carrier.example/*",
  selectors: {
    username: "#username",
    password: "#password",
    submit: "button[type='submit']"
  },
  preSteps: [],
  postLoginSelector: "",
  notes: "Paste stable selectors captured from the carrier login page."
};
