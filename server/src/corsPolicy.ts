const CHROMIUM_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

type OriginPolicyInput = {
  origin: string;
  requestPath: string;
  allowedFrontendOrigins: readonly string[];
  production: boolean;
};

export function isAllowedRequestOrigin({
  origin,
  requestPath,
  allowedFrontendOrigins,
  production,
}: OriginPolicyInput): boolean {
  if (!origin) return true;
  if (!production && allowedFrontendOrigins.length === 0) return true;
  if (allowedFrontendOrigins.includes(origin)) return true;
  return requestPath.startsWith("/api/connect/extension/") && CHROMIUM_EXTENSION_ORIGIN.test(origin);
}
