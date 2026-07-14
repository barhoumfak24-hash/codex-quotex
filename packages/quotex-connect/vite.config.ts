import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, "popup.html"),
        options: path.resolve(__dirname, "options.html"),
        background: path.resolve(__dirname, "src/background.ts"),
        contentScript: path.resolve(__dirname, "src/contentScript.ts")
      },
      output: {
        entryFileNames(chunk) {
          if (chunk.name === "background" || chunk.name === "contentScript") {
            return "[name].js";
          }
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
