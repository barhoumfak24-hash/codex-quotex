type FillState = "filled" | "needs-recipe" | "login-page-not-detected" | "error";

type FillResult = {
  state: FillState;
  message: string;
};

type FillMessage = {
  type: "quotex-connect.fill-login";
  payload: {
    recipe: {
      id: string;
      domainMatch: string;
      selectors: {
        username: string;
        password: string;
        submit: string;
      };
      preSteps?: { selector: string; action: "click"; delayMs?: number }[];
    };
    username: string;
    password: string;
  };
};

chrome.runtime.onMessage.addListener((message: FillMessage, _sender: unknown, sendResponse: any) => {
  if (message?.type !== "quotex-connect.fill-login") return false;
  fillLogin(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        state: "error",
        message: error instanceof Error ? error.message : "Unable to fill login form."
      } satisfies FillResult);
    });
  return true;
});

async function fillLogin(message: FillMessage): Promise<FillResult> {
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
