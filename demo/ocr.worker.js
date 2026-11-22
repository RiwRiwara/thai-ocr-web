// OCR runs here, off the UI thread.
//   in  {type:"init", backend, threads, modelBaseUrl}  out {type:"ready", backend, threads, ms}
//   in  {type:"read", id, image: ImageData}            out {type:"result", id, result, ms} | {type:"error", id, message}
import { createThaiOCR } from "../src/browser.js";

let ocr = null;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const t = performance.now();
      ocr = await createThaiOCR({
        backend: data.backend, threads: data.threads, modelBaseUrl: data.modelBaseUrl,
        wasmManifestUrl: data.wasmManifestUrl, // present after `npm run build` (split for Cloudflare's 25 MiB limit)
      });
      const threads = self.crossOriginIsolated ? data.threads : 1;
      self.postMessage({ type: "ready", backend: ocr.backend, threads, ms: performance.now() - t });
    } else if (data.type === "read") {
      const t = performance.now();
      const result = await ocr.read(data.image);
      self.postMessage({ type: "result", id: data.id, result, ms: performance.now() - t });
    }
  } catch (e) {
    self.postMessage({ type: "error", id: data.id, message: String((e && e.stack) || e) });
  }
};
