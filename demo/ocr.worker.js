// OCR runs here, off the UI thread.
//   in  {type:"init", backend, threads, modelBaseUrl}  out {type:"ready", backend, threads, ms}
//   in  {type:"read", id, image: ImageData}            out {type:"result", id, result, ms} | {type:"error", id, message}
import { createThaiOCR, isAppleMobile } from "../src/browser.js";

let ocr = null;

// Install the handler once, even if a browser evaluates this module twice, and never in onnxruntime-web's
// WASM thread workers: they load this same bundle and install their own handler.
if (!self.__thaiOcrWorker && !String(self.name || "").startsWith("em-pthread")) {
  self.__thaiOcrWorker = true;
  self.onmessage = onMessage;
}

async function onMessage({ data }) {
  try {
    if (data.type === "init") {
      const t = performance.now();
      const threads = isAppleMobile() ? 1 : data.threads;
      ocr = await createThaiOCR({
        backend: data.backend, threads, modelBaseUrl: data.modelBaseUrl,
        wasmManifestUrl: data.wasmManifestUrl, // present after `npm run build` (split for Cloudflare's 25 MiB limit)
      });
      self.postMessage({ type: "ready", backend: ocr.backend, threads: self.crossOriginIsolated ? threads : 1, ms: performance.now() - t });
    } else if (data.type === "read") {
      const t = performance.now();
      const result = await ocr.read(data.image);
      self.postMessage({ type: "result", id: data.id, result, ms: performance.now() - t });
    }
  } catch (e) {
    // onnxruntime-web sometimes throws an Error with an empty message (or a bare number from WASM)
    const message = e instanceof Error ? (e.message || e.name || "Error") + (e.stack ? "\n" + e.stack : "") : String(e);
    self.postMessage({ type: data.type === "init" ? "init-error" : "error", id: data.id, message });
  }
}
