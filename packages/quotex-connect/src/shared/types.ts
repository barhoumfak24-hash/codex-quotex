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
  };
  preSteps: RecipePreStep[];
  postLoginSelector: string;
  notes: string;
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

export type PopupState = {
  isSetup: boolean;
  locked: boolean;
  recipes: CarrierRecipe[];
  statuses: Record<string, StatusRecord>;
  activity: LauncherActivity;
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
