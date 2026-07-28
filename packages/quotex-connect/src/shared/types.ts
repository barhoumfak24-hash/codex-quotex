export type FillState =
  | "never"
  | "filled"
  | "launch-only"
  | "needs-login"
  | "needs-recipe"
  | "login-page-not-detected"
  | "locked"
  | "error";

export type RecipePreStep = {
  selector: string;
  action: "click";
  delayMs?: number;
};

export type ConnectJobType =
  | "open_portal"
  | "retrieve_quote"
  | "retrieve_policy"
  | "retrieve_claim"
  | "retrieve_documents";

export type QuoteExtractionRecipe = {
  readySelector: string;
  fields: {
    annualPremium: string;
    carrierReference: string;
    effectiveDate?: string;
    expirationDate?: string;
    status?: string;
  };
};

export type CarrierQuoteSubmissionRecipe = {
  adapter: "insurance_agent_hub_v1";
  createEndpoint: string;
  detailEndpointTemplate: string;
};

export type CarrierAutomationRecipe = {
  capabilities: ConnectJobType[];
  allowedOrigins: string[];
  quote?: QuoteExtractionRecipe;
  submission?: CarrierQuoteSubmissionRecipe;
  maxRunMs?: number;
};

export type CarrierRecipe = {
  id: string;
  name: string;
  logoUrl: string;
  loginUrl: string;
  domainMatch: string;
  selectors: {
    username: string;
    password: string;
    submit: string;
    otp?: string;
    otpSubmit?: string;
  };
  preSteps: RecipePreStep[];
  postLoginSelector: string;
  notes: string;
  automation?: CarrierAutomationRecipe;
};

export type VaultEntry = {
  carrierId: string;
  username: string;
  ciphertext: string;
  iv: string;
  updatedAt: number;
};

export type KdfConfig = {
  salt: string;
  iters: number;
};

export type ExtensionConfig = {
  idleLockMinutes: number;
  emailCodeAutofillEnabled: boolean;
  kdf: KdfConfig | null;
  verifier: string;
  verifierIv: string;
  recipes: CarrierRecipe[];
  vault: VaultEntry[];
};

export type StatusRecord = {
  carrierId: string;
  state: FillState;
  message: string;
  updatedAt: number;
};

export type LauncherActivity = {
  favorites: string[];
  recent: string[];
  lastUsedCarrierId: string;
};

export type ConnectJobStatus =
  | "queued"
  | "claimed"
  | "opening_portal"
  | "waiting_for_login"
  | "waiting_for_mfa"
  | "running"
  | "completed"
  | "manual_required"
  | "failed"
  | "cancelled";

export type ConnectBridgeConfig = {
  apiBaseUrl: string;
  deviceId: string;
  deviceLabel: string;
  token: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  agencyName: string;
  pairedAt: number;
};

export type ConnectBridgeJob = {
  id: string;
  quoteSessionId: string | null;
  carrierId: string;
  carrierName: string;
  jobType: ConnectJobType;
  status: ConnectJobStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConnectBridgeRuntime = {
  activeJob: ConnectBridgeJob | null;
  activeTabId: number | null;
  lastPollAt: number;
  lastHeartbeatAt: number;
  lastError: string;
  emailCodeJobId: string;
  emailCodeMessageKey: string;
  emailCodeLastCheckedAt: number;
  emailCodeState: "idle" | "checking" | "filled" | "manual";
};

export type ConnectBridgeState = {
  paired: boolean;
  config: ConnectBridgeConfig | null;
  runtime: ConnectBridgeRuntime;
};

export type PopupState = {
  isSetup: boolean;
  locked: boolean;
  recipes: CarrierRecipe[];
  statuses: Record<string, StatusRecord>;
  activity: LauncherActivity;
  bridge: ConnectBridgeState;
};

export type OptionsState = PopupState & {
  config: ExtensionConfig;
};

export type FillPayload = {
  recipe: CarrierRecipe;
  username: string;
  password: string;
};

export type FillResult = {
  state: FillState;
  message: string;
};
