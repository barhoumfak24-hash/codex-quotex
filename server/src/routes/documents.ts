import { makePlaceholderRouter } from "./_placeholder.js";

// Real impl:
// - POST /upload-url returns a presigned S3 PUT URL scoped to the tenant
// - GET /:id/download returns a signed GET URL valid for short window
// - Visibility controls enforced server-side
export const documentsRoutes = makePlaceholderRouter("documents", [
  { method: "POST", path: "/upload-url", description: "Issue presigned upload URL (server signs S3)" },
  { method: "POST", path: "/", description: "Register uploaded document metadata" },
  { method: "GET", path: "/", description: "List documents (filtered by entity)" },
  { method: "GET", path: "/:id/download", description: "Return signed download URL" },
  { method: "PATCH", path: "/:id", description: "Update document status (approve/reject)" },
]);