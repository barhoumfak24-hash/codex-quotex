type FillState = "filled" | "needs-recipe" | "login-page-not-detected" | "error";

type FillResult = {
  state: FillState;
  message: string;
};

type LoginFillMessage = {
  type: "quotex-connect.fill-login";
  payload: {
    recipe: {
      id: string;
      domainMatch: string;
      selectors: {
        username: string;
        password: string;
        submit: string;
        otp?: string;
        otpSubmit?: string;
      };
      preSteps?: { selector: string; action: "click"; delayMs?: number }[];
    };
    username: string;
    password: string;
  };
};

type EmailCodeFillMessage = {
  type: "quotex-connect.fill-email-code";
  payload: {
    recipe: LoginFillMessage["payload"]["recipe"];
    code: string;
  };
};

type QuoteExtractionMessage = {
  type: "quotex-connect.extract-quote";
  payload: {
    domainMatch: string;
    readySelector: string;
    fields: Record<string, string | undefined>;
    timeoutMs: number;
  };
};

type FillMessage = LoginFillMessage | EmailCodeFillMessage | QuoteExtractionMessage;

chrome.runtime.onMessage.addListener((message: FillMessage, _sender: unknown, sendResponse: any) => {
  if (
    !["quotex-connect.fill-login", "quotex-connect.fill-email-code", "quotex-connect.extract-quote"].includes(
      message?.type
    )
  ) return false;
  const operation =
    message.type === "quotex-connect.fill-login"
      ? fillLogin(message)
      : message.type === "quotex-connect.fill-email-code"
        ? fillEmailCode(message)
        : extractQuote(message);
  operation
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        state: "error",
        message: error instanceof Error ? error.message : "Unable to fill login form."
      } satisfies FillResult);
    });
  return true;
});

async function extractQuote(message: QuoteExtractionMessage): Promise<{
  state: "extracted" | "not-ready" | "error";
  fields?: Record<string, { value: string; selector: string }>;
  message: string;
}> {
  const { domainMatch, readySelector, fields, timeoutMs } = message.payload;
  if (!urlMatchesPattern(window.location.href, domainMatch)) {
    return { state: "error", message: "Current page does not match the carrier recipe domain." };
  }
  if (!readySelector.trim()) return { state: "error", message: "Quote readiness selector is missing." };
  const ready = await waitForElement(readySelector, Math.min(Math.max(timeoutMs, 1_000), 120_000));
  if (!ready) return { state: "not-ready", message: "The carrier quote result did not become ready." };

  const extracted: Record<string, { value: string; selector: string }> = {};
  for (const [field, selector] of Object.entries(fields)) {
    if (!selector?.trim()) continue;
    const element = document.querySelector(selector);
    const value = readElementValue(element);
    if (value) extracted[field] = { value, selector };
  }
  return { state: "extracted", fields: extracted, message: "Carrier quote fields extracted." };
}

async function fillLogin(message: LoginFillMessage): Promise<FillResult> {
  const { recipe, username, password } = message.payload;

  if (!urlMatchesPattern(window.location.href, recipe.domainMatch)) {
    return {
      state: "login-page-not-detected",
      message: "Current page does not match the carrier recipe domain."
    };
  }

  if (!recipe.selectors.username || !recipe.selectors.password || !recipe.selectors.submit) {
    return {
      state: "needs-recipe",
      message: "Recipe selectors are not configured."
    };
  }

  for (const step of recipe.preSteps ?? []) {
    if (step.action === "click" && step.selector) {
      const target = await waitForElement(step.selector, 5_000);
      if (target instanceof HTMLElement) {
        target.click();
        await sleep(step.delayMs ?? 250);
      }
    }
  }

  const usernameField = await waitForElement(recipe.selectors.username, 10_000);
  const passwordField = await waitForElement(recipe.selectors.password, 10_000);
  const submitButton = await waitForElement(recipe.selectors.submit, 10_000);

  if (!usernameField || !passwordField || !submitButton) {
    return {
      state: "login-page-not-detected",
      message: "Login form fields were not found on this page."
    };
  }

  setFieldValue(usernameField, username);
  setFieldValue(passwordField, password);

  if (submitButton instanceof HTMLElement) {
    submitButton.click();
  } else {
    return {
      state: "login-page-not-detected",
      message: "Submit control was not clickable."
    };
  }

  chrome.runtime.sendMessage({
    type: "quotex-connect.fill-status-from-content",
    carrierId: recipe.id,
    state: "filled",
    message: "Username and password were submitted. Complete MFA manually if required."
  });

  return {
    state: "filled",
    message: "Username and password were submitted. Complete MFA manually if required."
  };
}

async function fillEmailCode(message: EmailCodeFillMessage): Promise<FillResult> {
  const { recipe, code } = message.payload;
  if (!urlMatchesPattern(window.location.href, recipe.domainMatch)) {
    return {
      state: "login-page-not-detected",
      message: "Current page does not match the carrier recipe domain."
    };
  }
  if (!/^[A-Z0-9]{4,8}$/i.test(code)) {
    return { state: "error", message: "The verification code format was not accepted." };
  }

  const explicit = recipe.selectors.otp ? await waitForElement(recipe.selectors.otp, 2_500) : null;
  const field = explicit ?? findOneTimeCodeField();
  if (field) {
    setFieldValue(field, code);
  } else if (!fillSegmentedCode(code)) {
    return {
      state: "login-page-not-detected",
      message: "A verification-code field was not found on the carrier page."
    };
  }

  const submit =
    (recipe.selectors.otpSubmit ? await waitForElement(recipe.selectors.otpSubmit, 1_500) : null) ??
    findVerificationSubmit(field);
  if (submit instanceof HTMLElement) {
    submit.click();
  }
  return {
    state: "filled",
    message: submit ? "Email verification code submitted." : "Email verification code filled."
  };
}

function findOneTimeCodeField(): HTMLInputElement | null {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(isUsableTextInput);
  return (
    inputs.find((input) => input.autocomplete === "one-time-code") ??
    inputs.find((input) =>
      /(^|[\s_-])(otp|mfa|2fa|verification|security|passcode|one.?time|auth.?code)([\s_-]|$)/i.test(
        [input.name, input.id, input.getAttribute("aria-label"), input.placeholder].filter(Boolean).join(" ")
      )
    ) ??
    null
  );
}

function fillSegmentedCode(code: string): boolean {
  const fields = [...document.querySelectorAll<HTMLInputElement>("input")]
    .filter(isUsableTextInput)
    .filter((input) => input.maxLength === 1)
    .slice(0, 8);
  if (fields.length !== code.length || fields.length < 4) return false;
  fields.forEach((field, index) => setFieldValue(field, code[index] ?? ""));
  return true;
}

function isUsableTextInput(input: HTMLInputElement): boolean {
  const type = (input.type || "text").toLowerCase();
  return !input.disabled && !input.readOnly && input.offsetParent !== null &&
    !["hidden", "password", "email", "checkbox", "radio", "submit", "button"].includes(type);
}

function findVerificationSubmit(field: Element | null): HTMLElement | null {
  const scope = field?.closest("form") ?? document;
  const controls = [...scope.querySelectorAll<HTMLElement>("button, input[type='submit']")].filter(
    (element) =>
      element.offsetParent !== null &&
      !(
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        element.disabled
      )
  );
  const matching = controls.filter((element) =>
    /verify|continue|submit|confirm|sign in|next/i.test(
      `${element.textContent ?? ""} ${element.getAttribute("value") ?? ""} ${element.getAttribute("aria-label") ?? ""}`
    )
  );
  return matching.length === 1 ? matching[0] ?? null : null;
}

function setFieldValue(element: Element, value: string): void {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error("Configured selector does not target an editable text field.");
  }

  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function readElementValue(element: Element | null): string {
  if (!element) return "";
  const raw =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : element.getAttribute("data-value") ?? element.textContent ?? "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}

function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const found = document.querySelector(selector);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, 250);
    };
    tick();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function urlMatchesPattern(url: string, pattern: string): boolean {
  try {
    return wildcardToRegExp(pattern).test(url);
  } catch {
    return false;
  }
}
