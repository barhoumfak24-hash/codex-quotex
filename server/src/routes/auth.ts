import { makePlaceholderRouter } from "./_placeholder.js";

export const authRoutes = makePlaceholderRouter("auth", [
  { method: "POST", path: "/google/callback", description: "Exchange Google id_token → session" },
  { method: "POST", path: "/email/send-link", description: "Send magic link to customer email" },
  { method: "POST", path: "/email/verify", description: "Verify magic link token, create session" },
  { method: "POST", path: "/employee/login", description: "Agency user login (email+password+MFA)" },
  { method: "POST", path: "/master/login", description: "Master admin login (SSO + hardware MFA required)" },
  { method: "POST", path: "/logout", description: "Invalidate session" },
  { method: "GET", path: "/me", description: "Return current session user" },
]);