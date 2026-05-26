import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Inject build metadata into the bundle so the runtime diagnostic
// can print which commit + when this artifact was built. Vercel
// exposes VERCEL_GIT_COMMIT_SHA at build time; we read it here.
const BUILD_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.COMMIT_REF ??
  process.env.GIT_COMMIT ??
  "local";
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  server: {
    port: 5173,
    host: true,
  },
});