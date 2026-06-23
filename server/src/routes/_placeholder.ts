import { Router, type Request, type Response } from "express";

// Reusable scaffold. Returns a route map at GET / so callers can introspect
// the surface area until handlers are wired to Prisma.
export function makePlaceholderRouter(name: string, endpoints: { method: string; path: string; description: string }[]) {
  const r = Router();
  const productionUnavailable = (_req: Request, res: Response) =>
    res.status(503).json({
      error: "production_route_not_configured",
      resource: name,
    });

  if (process.env.NODE_ENV === "production") {
    r.use(productionUnavailable);
    return r;
  }

  r.get("/", (_req, res) => res.json({ resource: name, endpoints }));
  for (const e of endpoints) {
    const method = e.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
    if (e.path === "/") continue;
    r[method](e.path, (_req, res) =>
      res.status(501).json({
        error: "not_implemented",
        resource: name,
        endpoint: `${e.method} ${e.path}`,
        description: e.description,
      })
    );
  }
  return r;
}
