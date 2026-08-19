import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const monacoRoot = path.resolve(root, "node_modules/monaco-editor");

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  clearScreen: false,
  resolve: {
    dedupe: ["monaco-editor"],
    alias: {
      // Package "exports" map forces "./*" -> "./esm/vs/*.js", which breaks CSS imports.
      "monaco-editor/min/vs/editor/editor.main.css": path.join(
        monacoRoot,
        "min/vs/editor/editor.main.css",
      ),
    },
  },
  optimizeDeps: {
    include: [
      "monaco-editor/editor/editor.api.js",
      "vscode-textmate",
      "vscode-oniguruma",
      "pdfjs-dist",
      "fflate",
    ],
  },
  build: {
    chunkSizeWarningLimit: 5000,
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  worker: {
    format: "es",
  },
}));
