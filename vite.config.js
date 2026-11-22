import { defineConfig } from "vite";

// COOP/COEP make the page cross-origin isolated, which onnxruntime-web needs for multi-threaded WASM.
// Set the same two headers on your host (Cloudflare Pages reads demo/public/_headers).
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  root: "demo",
  base: "./",
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 16000 },
});
