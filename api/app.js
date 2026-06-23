import app from "../server/dist/app.js";

export const config = {
  maxDuration: 60,
};

export default function handler(req, res) {
  const originalUrl = String(req.url ?? "");
  const rewrittenPath = pathFromRewrite(req);

  if (rewrittenPath) {
    const parsed = new URL(originalUrl, "http://quotex.internal");
    parsed.searchParams.delete("path");
    const query = parsed.searchParams.toString();
    req.url = `/${rewrittenPath.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
  } else {
    req.url = originalUrl.replace(/^\/api\/app(?=\/|$)/, "") || "/";
  }

  return app(req, res);
}

function pathFromRewrite(req) {
  const value = req.query?.path;
  if (Array.isArray(value)) return value.join("/");
  if (typeof value === "string") return value;
  return "";
}
