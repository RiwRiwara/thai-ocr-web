// Browser entry: wires up onnxruntime-web, the minimal OpenCV.js build and clipper-lib, loads the models
// (cached with the Cache API) and returns a ready LineOCR. Works on the main thread or in a Web Worker.
//
//   import { createThaiOCR } from "thai-ocr-web/browser";
//   const ocr = await createThaiOCR({ modelBaseUrl: "/models/", backend: "webgpu" });
//   const { text, lines } = await ocr.read(imageData);
import ClipperLib from "clipper-lib";
import cvReady from "../vendor/opencv/opencv-ocr.mjs";
import { LineOCR } from "./line-ocr.js";

export const MODEL_FILES = ["det.yml", "config.json", "rec_dict.txt", "det.onnx", "rec.onnx", "rec2.onnx"];

/**
 * @param {object} [o]
 * @param {string} [o.modelBaseUrl]  URL of the folder that holds the model files (MODEL_FILES). Default "models/".
 * @param {"webgpu"|"wasm"} [o.backend]  "webgpu" falls back to WASM when the device has no WebGPU. Default "wasm".
 * @param {number} [o.threads]  WASM threads; only used when the page is cross-origin isolated. Default min(4, cores).
 * @param {string|false} [o.cacheName]  Cache API bucket for the model files; false to skip caching.
 * @param {object} [o.overrides]  runtime config overrides, e.g. { join: { paragraphs: true } }.
 * @returns {Promise<LineOCR & { backend: "webgpu"|"wasm" }>}
 */
export async function createThaiOCR({
  modelBaseUrl = "models/",
  backend = "wasm",
  threads = Math.min(4, globalThis.navigator?.hardwareConcurrency || 1),
  cacheName = "thai-ocr-web-models-2.1.4",
  overrides = {},
} = {}) {
  // Only the chosen build is downloaded: WASM ~15 MB (~4 MB gzip), WebGPU ~29 MB (~7 MB gzip).
  const ort = backend === "webgpu" ? await import("onnxruntime-web/webgpu") : await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? threads : 1;
  const cv = await cvReady;
  const base = new URL(modelBaseUrl, globalThis.location?.href).href;
  const cache = cacheName && globalThis.caches ? await caches.open(cacheName).catch(() => null) : null;
  const loadFile = async (name) => {
    const url = new URL(name, base).href;
    let res = cache && (await cache.match(url));
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error(`thai-ocr-web: cannot load ${url} (${res.status})`);
      if (cache) await cache.put(url, res.clone());
    }
    return new Uint8Array(await res.arrayBuffer());
  };
  const make = (eps) => LineOCR.create({ ort, cv, ClipperLib, loadFile, executionProviders: eps, overrides });
  let ocr, used = backend;
  if (backend === "webgpu") {
    try {
      if (!globalThis.navigator?.gpu || !(await navigator.gpu.requestAdapter())) throw new Error("no WebGPU adapter");
      ocr = await make(["webgpu", "wasm"]);
    } catch {
      used = "wasm";
      ocr = await make(["wasm"]);
    }
  } else {
    ocr = await make(["wasm"]);
  }
  ocr.backend = used;
  return ocr;
}

export { LineOCR };
