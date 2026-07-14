import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appSurface = env.VITE_APP_SURFACE || mode;
  const checkoutOnly = ["checkout", "transaction", "transactions"].includes(appSurface.toLowerCase());

  return {
    plugins: [
      react(),
      {
        name: "quotex-surface-entry",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            if (!checkoutOnly) return html;
            return html.replace("/src/main.tsx", "/src/main.checkout.tsx");
          },
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      __APP_SURFACE__: JSON.stringify(appSurface),
      __BUILD_SHA__: JSON.stringify(BUILD_SHA),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    },
    server: {
      port: 5173,
      host: "127.0.0.1",
      strictPort: true,
      proxy: {
        "/api/app/api": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/auth": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/ai": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/website": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/communications": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/mailboxes": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/signing-packets": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/state": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/smarty-autocomplete": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/google-places-autocomplete": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/google-place-details": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/photon-autocomplete": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/census-geocode": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
        "/api/smarty-validate": {
          target: "https://quotexinsurance.com",
          changeOrigin: true,
          secure: true,
        },
      },
    },
    test: {
      testTimeout: 20_000,
      hookTimeout: 30_000,
    },
  };
});
